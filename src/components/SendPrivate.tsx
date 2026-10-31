import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { bytesToHex, erc20Abi } from 'viem'
import { usePublicClient, useReadContract, useWriteContract } from 'wagmi'
import { ArrowLeft, ArrowLeftRight, ArrowRight, Check, ExternalLink, Lock, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { parseUsdc } from '@/onchain-money'
import { CHAIN_ID, MAX_BATCH, POOL_ADDRESS, USDC_ADDRESS, poolAbi } from '@/lib/pool'
import { CHAIN_NAME } from '@/lib/chain'
import { MAX_MEMO_BYTES, createNote, splitIntoDenominations } from '@/lib/notes'
import { decodeAddress, shortAddress, toBytes32Hex } from '@/lib/shielded-keys'
import { useShielded } from '@/lib/shielded-context'
import { useChainGuard } from '@/lib/use-chain-guard'
import { friendlyError, shortHash, usdcText } from '@/lib/format'
import { DURATION, SPRING, STAGGER } from '@/lib/motion'
import { Badge, Notice, Row, Spinner, Stepper, SuccessMark } from '@/components/ui'

/** Large payments are split into notes and sent in batches of MAX_BATCH notes per transaction. */
const MAX_NOTES = MAX_BATCH * 5

type Phase = 'select' | 'confirm' | 'success'
const PHASES: readonly Phase[] = ['select', 'confirm', 'success']
const STEP_LABELS = ['Select', 'Confirm', 'Success'] as const

/** Each phase slides in from the right and leaves to the left. */
const SLIDE = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -16 },
  transition: SPRING.smooth,
}

interface Step {
  label: string
  status: 'pending' | 'active' | 'done' | 'error'
  hash?: `0x${string}`
}

/** The round badge between the two boxes. It flips to ink once the payment is ready. */
function LinkBadge({ active }: { active: boolean }) {
  return (
    <div className="relative flex items-center justify-center md:w-12" aria-hidden>
      <div className="absolute inset-y-6 left-1/2 hidden w-px -translate-x-1/2 bg-line md:block" />
      <motion.span
        className={`relative z-10 flex size-11 items-center justify-center rounded-full transition-colors duration-300 ${active ? 'bg-ink text-canvas' : 'box text-ink'}`}
        animate={{ rotate: active ? 180 : 0 }}
        whileHover={{ scale: 1.08 }}
        transition={SPRING.chevron}
      >
        <ArrowLeftRight className="size-4 rotate-90 md:rotate-0" />
      </motion.span>
    </div>
  )
}

function StepIcon({ status }: { status: Step['status'] }) {
  if (status === 'active') return <Spinner className="size-3.5" />
  if (status === 'done') {
    return (
      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING.chevron}>
        <Check className="size-4 text-success" />
      </motion.span>
    )
  }
  return <span className={`size-1.5 rounded-full ${status === 'error' ? 'bg-danger' : 'bg-muted'}`} />
}

function TxSteps({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-2" aria-live="polite">
      {steps.map((s, i) => (
        <motion.li
          key={s.label}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING.snappy, delay: i * STAGGER.tight }}
          className={`flex items-center gap-2 text-xs ${s.status === 'error' ? 'text-danger' : 'text-ink-2'}`}
        >
          <span className="flex size-5 shrink-0 items-center justify-center">
            <StepIcon status={s.status} />
          </span>
          <span className={`flex-1 ${s.status === 'active' ? 'font-semibold text-ink' : ''}`}>{s.label}</span>
          {s.hash && (
            <a className="mono inline-flex min-h-8 items-center gap-1 text-ink underline-offset-4 hover:underline" href={buildTxExplorerUrl(CHAIN_ID, s.hash)} target="_blank" rel="noopener noreferrer">
              {shortHash(s.hash)} <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </motion.li>
      ))}
    </ol>
  )
}

export function SendPrivate() {
  const { keys, denominations, refresh } = useShielded()
  const { address, wrongChain, ensureChain } = useChainGuard()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()

  const [phase, setPhase] = useState<Phase>('select')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  })

  const decoded = useMemo(() => decodeAddress(recipient), [recipient])
  const memoBytes = new TextEncoder().encode(memo).length

  const parsed = useMemo(() => {
    if (!amount) return null
    try {
      return parseUsdc(amount)
    } catch {
      return null
    }
  }, [amount])

  const split = useMemo(
    () => (parsed && denominations.length ? splitIntoDenominations(parsed, denominations) : null),
    [parsed, denominations],
  )

  const grouped = useMemo(() => {
    const counts = new Map<number, number>()
    for (const i of split ?? []) counts.set(i, (counts.get(i) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => Number(denominations[b[0]] - denominations[a[0]]))
  }, [split, denominations])

  const smallest = denominations.length ? denominations.reduce((a, b) => (a < b ? a : b)) : 0n
  const tooMany = (split?.length ?? 0) > MAX_NOTES
  const insufficient = parsed !== null && balance !== undefined && parsed > balance
  const amountProblem =
    amount && parsed === null
      ? 'Enter a valid amount.'
      : parsed && !split
        ? `Amounts must be made of ${denominations.map(usdcText).join(', ')} USDC notes (smallest ${usdcText(smallest)}).`
        : tooMany
          ? `That would take more than ${MAX_NOTES} notes in one payment. Send it as several payments, or in larger note sizes.`
          : insufficient
            ? 'Not enough USDC. Use Get test USDC in the sidebar.'
            : null

  const ready =
    !!keys && !!decoded && !!split && !tooMany && !insufficient && memoBytes <= MAX_MEMO_BYTES && !!POOL_ADDRESS

  const notesText = split && !tooMany ? grouped.map(([i, c]) => `${c} × ${usdcText(denominations[i])}`).join(' + ') : '—'
  const batchCount = split ? Math.ceil(split.length / MAX_BATCH) : 0
  const txText = split && !tooMany ? `1 approval + ${batchCount} deposit${batchCount === 1 ? '' : 's'}` : '—'

  const updateStep = (index: number, patch: Partial<Step>) =>
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  const send = async () => {
    const pool = POOL_ADDRESS
    if (!keys || !decoded || !split || !publicClient || !pool || !address || !parsed) return
    setError(null)
    setSending(true)
    const batches: number[][] = []
    for (let i = 0; i < split.length; i += MAX_BATCH) batches.push(split.slice(i, i + MAX_BATCH))
    const labels: string[] = [
      'Approve USDC',
      ...batches.map((b, n) => {
        const value = b.reduce((sum, d) => sum + denominations[d], 0n)
        return `Deposit ${b.length} note${b.length === 1 ? '' : 's'} (${usdcText(value)} USDC)${batches.length > 1 ? `, batch ${n + 1} of ${batches.length}` : ''}`
      }),
    ]
    setSteps(labels.map((label) => ({ label, status: 'pending' })))
    let current = 0
    try {
      await ensureChain()

      updateStep(0, { status: 'active' })
      const allowance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, pool],
      })
      if (allowance < parsed) {
        const hash = await writeContractAsync({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [pool, parsed],
          chainId: CHAIN_ID,
        })
        updateStep(0, { hash })
        await publicClient.waitForTransactionReceipt({ hash })
      }
      updateStep(0, { status: 'done' })

      for (let n = 0; n < batches.length; n++) {
        current = n + 1
        updateStep(current, { status: 'active' })
        const batch = batches[n]
        const notes = batch.map(() => createNote(decoded, keys.viewPub, memo))
        const hash = await writeContractAsync({
          address: pool,
          abi: poolAbi,
          functionName: 'depositMany',
          args: [
            batch,
            notes.map((note) => toBytes32Hex(note.commitment)),
            notes.map((note) => bytesToHex(note.ephemeralPub)),
            notes.map((note) => bytesToHex(note.ciphertext)),
          ],
          chainId: CHAIN_ID,
        })
        updateStep(current, { hash })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('A deposit reverted')
        updateStep(current, { status: 'done' })
      }
      toast.success('Private payment sent')
      setPhase('success')
      void refetchBalance()
      void refresh()
    } catch (err) {
      updateStep(current, { status: 'error' })
      setError(friendlyError(err))
    } finally {
      setSending(false)
    }
  }

  const reset = () => {
    setPhase('select')
    setSteps([])
    setError(null)
    setRecipient('')
    setAmount('')
    setMemo('')
  }

  return (
    <div className="flex h-full flex-col">
      <Stepper steps={STEP_LABELS} current={PHASES.indexOf(phase)} />

      <AnimatePresence mode="wait" initial={false}>
        {phase === 'select' && (
          <motion.div key="select" {...SLIDE} className="mt-8 flex flex-1 flex-col">
            <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:gap-0">
              <div className="box rounded-2xl p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">Public wallet</p>
                    <p className="text-[11px] text-ink-2">
                      {balance !== undefined ? `${usdcText(balance)} USDC available` : 'Reading your balance...'}
                    </p>
                  </div>
                  <Badge>
                    <Wallet className="size-4" />
                  </Badge>
                </div>

                <label htmlFor="amount" className="mt-8 block text-[11px] text-ink-2">
                  You send
                </label>
                <div className="line-field mt-1 flex items-baseline gap-2 pb-1">
                  <input
                    id="amount"
                    inputMode="decimal"
                    autoComplete="off"
                    value={amount}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9.]/g, '')
                      if (v === '' || /^\d*\.?\d{0,6}$/.test(v)) setAmount(v)
                    }}
                    placeholder="0.00"
                    className="w-full min-w-0 bg-transparent font-display text-4xl font-light tabular-nums text-ink outline-none placeholder:text-muted"
                  />
                  <span className="font-display text-2xl text-ink">USDC</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {denominations.map((d) => (
                    <motion.button
                      key={d.toString()}
                      type="button"
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.94 }}
                      transition={SPRING.snappy}
                      onClick={() => setAmount(usdcText(d))}
                      className="min-h-9 rounded-full border border-line px-3 text-xs font-semibold tabular-nums text-ink transition-colors hover:border-ink"
                    >
                      {usdcText(d)}
                    </motion.button>
                  ))}
                </div>
              </div>

              <LinkBadge active={ready} />

              <div className="box rounded-2xl p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">Zerith address</p>
                    <p className="truncate text-[11px] text-ink-2">{decoded ? shortAddress(recipient) : 'Who gets paid'}</p>
                  </div>
                  <Badge>
                    <Lock className="size-4" />
                  </Badge>
                </div>

                <div className="mt-8 flex items-center justify-between gap-2">
                  <label htmlFor="recipient" className="text-[11px] text-ink-2">
                    Recipient
                  </label>
                  {keys && (
                    <button type="button" className="min-h-8 text-xs font-semibold text-ink underline-offset-4 hover:underline" onClick={() => setRecipient(keys.address)}>
                      Use mine
                    </button>
                  )}
                </div>
                <input
                  id="recipient"
                  className="field mono mt-1 text-xs"
                  placeholder="shld1..."
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value.trim())}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!recipient && !decoded}
                />
                {recipient && !decoded && <p className="mt-1 text-[11px] text-danger">Not a valid Zerith address.</p>}

                <p className="mt-5 text-[11px] text-ink-2">They receive</p>
                <p className="font-display text-4xl font-light tabular-nums text-muted">
                  {parsed && split ? usdcText(parsed) : '0.00'} <span className="text-2xl">USDC</span>
                </p>
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="memo" className="block text-[11px] text-ink-2">
                Private memo (optional)
              </label>
              <input id="memo" className="field mt-1" placeholder="Invoice 1042" value={memo} onChange={(e) => setMemo(e.target.value)} autoComplete="off" />
              <p className={`mt-1 text-[11px] tabular-nums ${memoBytes > MAX_MEMO_BYTES ? 'text-danger' : 'text-ink-2'}`}>
                {memoBytes}/{MAX_MEMO_BYTES} bytes. Only you and the recipient can read it.
              </p>
            </div>

            {amountProblem && (
              <div className="mt-3">
                <Notice tone="warn">{amountProblem}</Notice>
              </div>
            )}

            <div className="mt-auto flex flex-col gap-4 border-t border-line pt-5 sm:flex-row sm:items-end sm:justify-between">
              <dl className="flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <dt className="text-[11px] text-ink-2">Notes</dt>
                  <dd className="text-sm font-semibold tabular-nums text-ink">{notesText}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-ink-2">Transactions</dt>
                  <dd className="text-sm font-semibold tabular-nums text-ink">{txText}</dd>
                </div>
              </dl>
              <button className="btn-primary" disabled={!ready} onClick={() => setPhase('confirm')}>
                Review payment <ArrowRight className="btn-arrow size-4" aria-hidden />
              </button>
            </div>
          </motion.div>
        )}

        {phase === 'confirm' && (
          <motion.div key="confirm" {...SLIDE} className="mt-8 flex flex-1 flex-col">
            <h3 className="font-display text-3xl font-light text-ink">Review payment</h3>
            <div className="box mt-4 rounded-2xl px-5 py-3">
              <Row label="To" value={<span className="mono text-xs">{shortAddress(recipient)}</span>} />
              <Row label="Amount" value={`${usdcText(parsed ?? 0n)} USDC`} strong />
              <Row label="Notes" value={notesText} />
              <Row label="Memo" value={memo || 'None'} />
              <Row label="Transactions" value={txText} />
            </div>
            <p className="mt-3 text-[11px] text-ink-2">Your deposits are public. Who they are for stays hidden.</p>

            {steps.length > 0 && (
              <div className="mt-5">
                <TxSteps steps={steps} />
              </div>
            )}
            {error && (
              <div className="mt-3">
                <Notice tone="error">{error}</Notice>
              </div>
            )}

            <div className="mt-auto flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">
              <button type="button" className="btn-ghost min-h-12" disabled={sending} onClick={() => setPhase('select')}>
                <ArrowLeft className="size-4" aria-hidden /> Back
              </button>
              <button className="btn-primary" disabled={!ready || sending} onClick={() => void send()}>
                {sending ? (
                  <>
                    <Spinner /> Sending...
                  </>
                ) : wrongChain ? (
                  `Switch to ${CHAIN_NAME} and send`
                ) : (
                  <>
                    Confirm and send <ArrowRight className="btn-arrow size-4" aria-hidden />
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {phase === 'success' && (
          <motion.div key="success" {...SLIDE} className="mt-8 flex flex-1 flex-col items-center text-center">
            <SuccessMark />
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING.smooth, delay: DURATION.checkDraw }}
              className="mt-5 max-w-sm"
            >
              <h3 className="font-display text-3xl font-light text-ink">Payment sent</h3>
              <p className="mt-2 text-sm text-ink-2 text-pretty">
                {usdcText(parsed ?? 0n)} USDC is in the pool for {shortAddress(recipient)}. For the best privacy, the
                recipient should wait a while before withdrawing.
              </p>
            </motion.div>
            <div className="mt-6 w-full max-w-sm text-left">
              <TxSteps steps={steps} />
            </div>
            <button className="btn-primary mt-auto" onClick={reset}>
              Send another <ArrowRight className="btn-arrow size-4" aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
