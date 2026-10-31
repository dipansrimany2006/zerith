import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { encodeFunctionData, isAddress, zeroAddress, type Address } from 'viem'
import { usePublicClient, useWriteContract } from 'wagmi'
import { ArrowRight, Check, ExternalLink, X } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID, MAX_WITHDRAW_BATCH, MULTICALL3, POOL_ADDRESS, multicallAbi, poolAbi } from '@/lib/pool'
import { CHAIN_NAME } from '@/lib/chain'
import { leavesFor, type DepositLog } from '@/lib/scan'
import { proveWithdraw, type WithdrawProof } from '@/lib/prover'
import { useShielded, type OwnedNote } from '@/lib/shielded-context'
import { useChainGuard } from '@/lib/use-chain-guard'
import { friendlyError, shortHash, usdcText } from '@/lib/format'
import { DURATION, SPRING, STAGGER } from '@/lib/motion'
import { Notice, Row, Spinner, Stepper, SuccessMark } from '@/components/ui'

type Mode = 'relayer' | 'self'
type Stage = 'idle' | 'running' | 'done'
type NoteStatus = 'pending' | 'proving' | 'submitting' | 'done' | 'error'

interface NoteState {
  status: NoteStatus
  hash?: `0x${string}`
}

interface RelayerInfo {
  relayer: Address
  minFee: string
  extraFee?: string
  maxBatch?: number
}

const FRESH_NOTE_SECONDS = 15 * 60
const RATE_LIMIT_WAIT_MS = 15_000 // the relayer allows a burst per minute; wait and retry when it says so
const RATE_LIMIT_RETRIES = 8

const idOf = (n: OwnedNote) => n.commitment.toString()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Relayer fee for one batch: the base fee plus a per-note extra for each note after the first. */
const batchFee = (count: number, minFee: bigint, extraFee: bigint) => minFee + extraFee * BigInt(Math.max(0, count - 1))

/**
 * Splits a batch fee across its notes, largest notes first, so no note's fee exceeds its value.
 * Every proof binds its own share; the relayer checks that the shares add up to the batch fee.
 */
function allocateFee(values: bigint[], total: bigint): bigint[] {
  const fees = values.map(() => 0n)
  let left = total
  for (const i of values.map((_, k) => k).sort((x, y) => (values[y] > values[x] ? 1 : -1))) {
    const take = left < values[i] ? left : values[i]
    fees[i] = take
    left -= take
    if (left === 0n) break
  }
  return fees
}

class RateLimited extends Error {}

async function postRelayer(path: string, body: unknown): Promise<`0x${string}`> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = (await res.json()) as { txHash?: `0x${string}`; error?: string }
  if (res.status === 429) throw new RateLimited(json.error ?? 'Too many requests')
  if (!res.ok || !json.txHash) throw new Error(json.error ?? 'The relayer could not submit this withdrawal')
  return json.txHash
}

const proofFields = (n: OwnedNote, p: WithdrawProof, fee: bigint) => ({
  denomIndex: n.denomIndex,
  proof: p.proof.map(String),
  root: p.root,
  nullifierHash: p.nullifierHash,
  fee: fee.toString(),
})

/**
 * Withdraws one note, or several at once ("Withdraw all"). Several notes go out in one atomic
 * transaction per batch of up to 20, through Multicall3: the relayer submits it for one batch fee,
 * or the wallet confirms it once.
 */
export function WithdrawSheet({ notes, onClose }: { notes: OwnedNote[]; onClose: () => void }) {
  const { keys, denominations, refresh } = useShielded()
  const { wrongChain, ensureChain } = useChainGuard()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()

  const many = notes.length > 1
  const [destination, setDestination] = useState('')
  const [mode, setMode] = useState<Mode>('relayer')
  const [stage, setStage] = useState<Stage>('idle')
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [states, setStates] = useState<Record<string, NoteState>>(() =>
    Object.fromEntries(notes.map((n) => [idOf(n), { status: 'pending' }])),
  )
  const [relayerInfo, setRelayerInfo] = useState<RelayerInfo | null>(null)
  const [relayerDown, setRelayerDown] = useState(false)
  const [openedAt] = useState(() => Date.now())

  // Ask the relayer for its address and fees. The fees shown are the fees the proofs will bind.
  useEffect(() => {
    let cancelled = false
    fetch('/api/info')
      .then((r) => (r.ok ? (r.json() as Promise<RelayerInfo>) : Promise.reject(new Error('relayer unavailable'))))
      .then((info) => {
        if (cancelled) return
        setRelayerInfo(info)
        setRelayerDown(false)
      })
      .catch(() => {
        if (cancelled) return
        setRelayerDown(true)
        setMode('self')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const value = (n: OwnedNote) => denominations[n.denomIndex] ?? 0n
  const total = notes.reduce((sum, n) => sum + value(n), 0n)
  const remaining = notes.filter((n) => states[idOf(n)]?.status !== 'done')
  const doneCount = notes.length - remaining.length

  const minFee = relayerInfo ? BigInt(relayerInfo.minFee) : 0n
  const extraFee = relayerInfo?.extraFee ? BigInt(relayerInfo.extraFee) : minFee
  const batchSize = mode === 'relayer' ? Math.min(relayerInfo?.maxBatch ?? MAX_WITHDRAW_BATCH, MAX_WITHDRAW_BATCH) : MAX_WITHDRAW_BATCH
  const batches = chunk(notes, batchSize)
  const totalFee = mode === 'relayer' && relayerInfo ? batches.reduce((sum, b) => sum + batchFee(b.length, minFee, extraFee), 0n) : 0n
  const receive = total > totalFee ? total - totalFee : 0n
  const transactions = Math.ceil(remaining.length / batchSize)

  const hashes = useMemo(() => [...new Set(notes.map((n) => states[idOf(n)]?.hash).filter((h): h is `0x${string}` => !!h))], [notes, states])

  const validDestination = isAddress(destination)
  const busy = stage === 'running'
  const fresh = notes.some((n) => openedAt / 1000 - n.timestamp < FRESH_NOTE_SECONDS)
  const feeTooHigh = mode === 'relayer' && batches.some((b) => batchFee(b.length, minFee, extraFee) >= b.reduce((s, n) => s + value(n), 0n))
  const canStart = !!keys && validDestination && !busy && stage !== 'done' && !feeTooHigh && (mode === 'self' || !!relayerInfo)

  // Escape closes the dialog, except while a withdrawal is in flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const mark = (list: OwnedNote[], patch: NoteState) =>
    setStates((prev) => ({ ...prev, ...Object.fromEntries(list.map((n) => [idOf(n), { ...prev[idOf(n)], ...patch }])) }))

  const withdraw = async () => {
    const pool = POOL_ADDRESS
    if (!keys || !publicClient || !pool || !isAddress(destination)) return
    const recipient = destination
    const relayer: Address = mode === 'relayer' && relayerInfo ? relayerInfo.relayer : zeroAddress
    setError(null)
    setStage('running')

    // Roots change only on deposits and the pool remembers the last 30, so one sync usually covers
    // every proof in a run. A batch that hits UnknownRoot syncs again and is proved once more.
    let logs: DepositLog[] = []
    const prove = (n: OwnedNote, fee: bigint) =>
      proveWithdraw({ keys, secret: n.secret, leaves: leavesFor(logs, n.denomIndex), leafIndex: n.leafIndex, recipient, relayer, fee })

    const todo = notes.filter((n) => states[idOf(n)]?.status !== 'done')
    const runBatches = chunk(todo, batchSize)
    let current: OwnedNote[] = []
    try {
      setStep('Reading the latest pool state...')
      logs = await refresh()

      for (const [k, batch] of runBatches.entries()) {
        current = batch
        const where = runBatches.length > 1 ? ` (batch ${k + 1} of ${runBatches.length})` : ''
        const fees =
          mode === 'relayer' ? allocateFee(batch.map(value), batchFee(batch.length, minFee, extraFee)) : batch.map(() => 0n)

        const proveBatch = async () => {
          const proofs: WithdrawProof[] = []
          for (const [i, n] of batch.entries()) {
            mark([n], { status: 'proving' })
            setStep(many ? `Generating proof ${i + 1} of ${batch.length}${where}...` : 'Generating your zero-knowledge proof...')
            proofs.push(await prove(n, fees[i]))
            mark([n], { status: 'submitting' })
          }
          return proofs
        }

        let proofs = await proveBatch()
        let hash: `0x${string}` | null = null

        if (mode === 'relayer') {
          let waits = 0
          let reproved = false
          while (!hash) {
            setStep(many ? `Relayer is submitting ${batch.length} withdrawals${where}...` : 'Relayer is submitting...')
            try {
              hash =
                batch.length === 1
                  ? await postRelayer('/api/relay', { ...proofFields(batch[0], proofs[0], fees[0]), recipient })
                  : await postRelayer('/api/relay-many', { recipient, items: batch.map((n, i) => proofFields(n, proofs[i], fees[i])) })
            } catch (err) {
              if (err instanceof RateLimited && waits < RATE_LIMIT_RETRIES) {
                waits += 1
                setStep('Relayer is busy, retrying shortly...')
                await sleep(RATE_LIMIT_WAIT_MS)
              } else if (err instanceof Error && err.message.includes('UnknownRoot') && !reproved) {
                reproved = true
                logs = await refresh()
                proofs = await proveBatch()
              } else {
                throw err
              }
            }
          }
        } else {
          await ensureChain()
          setStep(many ? `Confirm in your wallet${where}...` : 'Confirm in your wallet...')
          const withdrawArgs = (n: OwnedNote, p: WithdrawProof) =>
            [n.denomIndex, p.proof, p.root, p.nullifierHash, recipient, zeroAddress, 0n] as const
          hash =
            batch.length === 1
              ? await writeContractAsync({ address: pool, abi: poolAbi, functionName: 'withdraw', args: withdrawArgs(batch[0], proofs[0]), chainId: CHAIN_ID })
              : await writeContractAsync({
                  address: MULTICALL3,
                  abi: multicallAbi,
                  functionName: 'aggregate3',
                  args: [
                    batch.map((n, i) => ({
                      target: pool,
                      allowFailure: false,
                      callData: encodeFunctionData({ abi: poolAbi, functionName: 'withdraw', args: withdrawArgs(n, proofs[i]) }),
                    })),
                  ],
                  chainId: CHAIN_ID,
                })
        }

        setStep(many ? `Waiting for confirmation${where}...` : 'Waiting for confirmation...')
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('The withdrawal transaction reverted')
        mark(batch, { status: 'done', hash })
      }
      current = []
      setStage('done')
    } catch (err) {
      // A batch is atomic: either all of its notes are withdrawn or none are.
      if (current.length) mark(current, { status: 'error' })
      setStage('idle')
      setError(friendlyError(err))
    } finally {
      setStep(null)
      void refresh()
    }
  }

  const modes: { id: Mode; title: string; sub: string; disabled: boolean }[] = [
    { id: 'relayer', title: 'Relayer', sub: 'No gas needed', disabled: busy || relayerDown || doneCount > 0 },
    { id: 'self', title: 'My wallet', sub: 'You pay gas', disabled: busy || doneCount > 0 },
  ]

  const short = `${destination.slice(0, 6)}...${destination.slice(-4)}`
  const startLabel = doneCount > 0 ? `Withdraw remaining ${remaining.length}` : many ? `Withdraw all ${notes.length} notes` : 'Withdraw'
  const showProgress = many && (busy || doneCount > 0 || Object.values(states).some((s) => s.status === 'error'))

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.backdrop }}
      onClick={() => !busy && onClose()}
    >
      <div className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-sm" />
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={many ? 'Withdraw all notes' : 'Withdraw a note'}
        className="frame relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] sm:rounded-[28px]"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.97 }}
        transition={SPRING.popup}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5">
          <h3 className="font-display text-3xl font-light text-ink">
            {many ? 'Withdraw all' : 'Withdraw'} {usdcText(total)} USDC
          </h3>
          <motion.button
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
            whileHover={{ rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            transition={SPRING.chevron}
            className="flex size-11 items-center justify-center rounded-full text-ink hover:bg-surface disabled:opacity-40"
          >
            <X className="size-5" />
          </motion.button>
        </div>

        <div className="px-6 pt-4">
          <Stepper steps={['Details', 'Prove', 'Done']} current={stage === 'done' ? 2 : busy ? 1 : 0} />
        </div>

        <div className="space-y-4 px-6 pb-6 pt-6">
          {stage === 'done' ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <SuccessMark />
              <p className="text-sm font-semibold text-ink">
                {usdcText(receive)} USDC withdrawn to {short}
              </p>
              <ul className="flex max-h-32 flex-col items-center overflow-y-auto">
                {hashes.map((h) => (
                  <li key={h}>
                    <a className="mono inline-flex min-h-8 items-center gap-1 text-xs text-ink underline-offset-4 hover:underline" href={buildTxExplorerUrl(CHAIN_ID, h)} target="_blank" rel="noopener noreferrer">
                      {shortHash(h)} <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
              <button className="btn-primary mt-2 w-full" onClick={onClose}>
                Done
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[11px] text-ink-2" htmlFor="destination">
                  Destination address
                </label>
                <input
                  id="destination"
                  className="field mono mt-1 text-xs"
                  placeholder="0x..."
                  value={destination}
                  onChange={(e) => setDestination(e.target.value.trim())}
                  disabled={busy || doneCount > 0}
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  aria-invalid={!!destination && !validDestination}
                />
                <p className={`mt-1 text-[11px] ${destination && !validDestination ? 'text-danger' : 'text-ink-2'}`}>
                  {destination && !validDestination ? 'Not a valid address.' : 'Use a fresh address that no one links to you.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who submits the transaction">
                {modes.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.id}
                    disabled={m.disabled}
                    onClick={() => setMode(m.id)}
                    className={`relative min-h-14 rounded-2xl border p-3 text-left transition-colors disabled:opacity-40 ${mode === m.id ? 'border-ink' : 'border-line hover:border-ink-2'}`}
                  >
                    {mode === m.id && <motion.span layoutId="withdraw-mode" className="absolute inset-0 rounded-2xl bg-surface" transition={SPRING.snappy} aria-hidden />}
                    <span className="relative block text-sm font-semibold text-ink">{m.title}</span>
                    <span className="relative block text-[11px] text-ink-2">{m.sub}</span>
                  </button>
                ))}
              </div>

              <div className="panel rounded-2xl px-4 py-2">
                <Row label={many ? `${notes.length} notes` : 'Note value'} value={`${usdcText(total)} USDC`} />
                <Row label={mode === 'relayer' ? 'Relayer fee' : 'Fee'} value={`${usdcText(totalFee)} USDC`} />
                {many && (
                  <Row
                    label="Transactions"
                    value={
                      mode === 'relayer'
                        ? `${transactions}, submitted for you`
                        : `${transactions} wallet confirmation${transactions === 1 ? '' : 's'}`
                    }
                  />
                )}
                <Row label="You receive" value={`${usdcText(receive)} USDC`} strong />
              </div>

              {showProgress && <NoteProgress notes={notes} states={states} value={value} />}

              {mode === 'self' && (
                <Notice tone="warn">
                  Sending from your own wallet links that wallet to the destination address on the public chain. Use the relayer for stronger privacy.
                </Notice>
              )}
              {many && !busy && doneCount === 0 && (
                <Notice tone="warn">Withdrawing every note together to one address makes them easy to link to each other and to the payment.</Notice>
              )}
              {relayerDown && <Notice tone="warn">The relayer is not reachable right now, so only withdrawing from your own wallet is available.</Notice>}
              {fresh && !busy && (
                <Notice tone="warn">This payment arrived minutes ago. Waiting longer before you withdraw makes it harder to match to the deposit.</Notice>
              )}
              {error && (
                <Notice tone="error">
                  {doneCount > 0 ? `${doneCount} of ${notes.length} notes withdrawn. ` : ''}
                  {error}
                </Notice>
              )}

              <button className="btn-primary w-full" disabled={!canStart} onClick={() => void withdraw()}>
                {busy ? (
                  <>
                    <Spinner /> {step ?? 'Working...'}
                  </>
                ) : mode === 'self' && wrongChain ? (
                  `Switch to ${CHAIN_NAME} and withdraw`
                ) : (
                  <>
                    {startLabel} <ArrowRight className="btn-arrow size-4" aria-hidden />
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </motion.section>
    </motion.div>
  )
}

const STATUS_TEXT: Record<NoteStatus, string> = {
  pending: 'Waiting',
  proving: 'Proving',
  submitting: 'Ready',
  done: 'Withdrawn',
  error: 'Failed',
}

/** Per-note progress for "Withdraw all". */
function NoteProgress({ notes, states, value }: { notes: OwnedNote[]; states: Record<string, NoteState>; value: (n: OwnedNote) => bigint }) {
  return (
    <ul className="box max-h-48 overflow-y-auto rounded-2xl px-4 py-1" aria-label="Withdrawal progress">
      {notes.map((n, i) => {
        const s = states[idOf(n)]?.status ?? 'pending'
        return (
          <motion.li
            key={idOf(n)}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING.smooth, delay: i * STAGGER.tight }}
            className="flex items-center justify-between gap-3 py-1.5 text-xs"
          >
            <span className="tabular-nums text-ink">{usdcText(value(n))} USDC</span>
            <span className={`flex items-center gap-1.5 ${s === 'error' ? 'text-danger' : s === 'done' ? 'text-success' : 'text-ink-2'}`}>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={s} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={SPRING.snappy} className="flex">
                  {s === 'done' ? <Check className="size-3.5" aria-hidden /> : s === 'proving' ? <Spinner /> : null}
                </motion.span>
              </AnimatePresence>
              {STATUS_TEXT[s]}
            </span>
          </motion.li>
        )
      })}
    </ul>
  )
}
