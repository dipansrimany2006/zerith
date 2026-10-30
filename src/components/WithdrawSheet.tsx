import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { isAddress, zeroAddress, type Address } from 'viem'
import { usePublicClient, useWriteContract } from 'wagmi'
import { ArrowRight, ExternalLink, X } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID, POOL_ADDRESS, poolAbi } from '@/lib/pool'
import { leavesFor } from '@/lib/scan'
import { proveWithdraw } from '@/lib/prover'
import { useShielded, type OwnedNote } from '@/lib/shielded-context'
import { useChainGuard } from '@/lib/use-chain-guard'
import { friendlyError, shortHash, usdcText } from '@/lib/format'
import { DURATION, SPRING } from '@/lib/motion'
import { Notice, Row, Spinner, Stepper, SuccessMark } from '@/components/ui'

type Mode = 'relayer' | 'self'
type Stage = 'idle' | 'syncing' | 'proving' | 'submitting' | 'done'

interface RelayerInfo {
  relayer: Address
  minFee: string
}

const FRESH_NOTE_SECONDS = 15 * 60

export function WithdrawSheet({ note, onClose }: { note: OwnedNote; onClose: () => void }) {
  const { keys, denominations, refresh } = useShielded()
  const { wrongChain, ensureChain } = useChainGuard()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()

  const [destination, setDestination] = useState('')
  const [mode, setMode] = useState<Mode>('relayer')
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [relayerInfo, setRelayerInfo] = useState<RelayerInfo | null>(null)
  const [relayerDown, setRelayerDown] = useState(false)
  const [openedAt] = useState(() => Date.now())

  // Ask the relayer for its address and fee. The fee shown is the fee the proof will bind.
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

  const denom = denominations[note.denomIndex] ?? 0n
  const fee = mode === 'relayer' && relayerInfo ? BigInt(relayerInfo.minFee) : 0n
  const receive = denom > fee ? denom - fee : 0n
  const validDestination = isAddress(destination)
  const busy = stage === 'syncing' || stage === 'proving' || stage === 'submitting'
  const fresh = openedAt / 1000 - note.timestamp < FRESH_NOTE_SECONDS
  const feeTooHigh = mode === 'relayer' && fee >= denom
  const canStart = !!keys && validDestination && !busy && stage !== 'done' && !feeTooHigh && (mode === 'self' || !!relayerInfo)

  // Escape closes the dialog, except while a withdrawal is in flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const withdraw = async () => {
    const pool = POOL_ADDRESS
    if (!keys || !publicClient || !pool || !isAddress(destination)) return
    setError(null)
    try {
      setStage('syncing')
      const logs = await refresh()
      const leaves = leavesFor(logs, note.denomIndex)
      const leafIndex = note.leafIndex

      setStage('proving')
      const relayer: Address = mode === 'relayer' && relayerInfo ? relayerInfo.relayer : zeroAddress
      const proof = await proveWithdraw({
        keys,
        secret: note.secret,
        leaves,
        leafIndex,
        recipient: destination,
        relayer,
        fee,
      })

      setStage('submitting')
      let hash: `0x${string}`
      if (mode === 'relayer') {
        const res = await fetch('/api/relay', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            denomIndex: note.denomIndex,
            a: proof.a.map(String),
            b: proof.b.map((row) => row.map(String)),
            c: proof.c.map(String),
            root: proof.root,
            nullifierHash: proof.nullifierHash,
            recipient: destination,
            fee: fee.toString(),
          }),
        })
        const body = (await res.json()) as { txHash?: `0x${string}`; error?: string }
        if (!res.ok || !body.txHash) throw new Error(body.error ?? 'The relayer could not submit this withdrawal')
        hash = body.txHash
      } else {
        await ensureChain()
        hash = await writeContractAsync({
          address: pool,
          abi: poolAbi,
          functionName: 'withdraw',
          args: [note.denomIndex, proof.a, proof.b, proof.c, proof.root, proof.nullifierHash, destination, zeroAddress, 0n],
          chainId: CHAIN_ID,
        })
      }
      setTxHash(hash)
      await publicClient.waitForTransactionReceipt({ hash })
      setStage('done')
      void refresh()
    } catch (err) {
      setStage('idle')
      setError(friendlyError(err))
    }
  }

  const stageLabel =
    stage === 'syncing'
      ? 'Reading the latest pool state...'
      : stage === 'proving'
        ? 'Generating your zero-knowledge proof...'
        : stage === 'submitting'
          ? mode === 'relayer'
            ? 'Relayer is submitting...'
            : 'Confirm in your wallet...'
          : null

  const modes: { id: Mode; title: string; sub: string; disabled: boolean }[] = [
    { id: 'relayer', title: 'Relayer', sub: 'No gas needed', disabled: busy || relayerDown },
    { id: 'self', title: 'My wallet', sub: 'You pay gas', disabled: busy },
  ]

  return (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.backdrop }}
          onClick={() => !busy && onClose()}
        >
          <div className="absolute inset-0 bg-[rgba(5,6,8,0.3)] backdrop-blur-sm" />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label="Withdraw a note"
            className="frame relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] sm:rounded-[28px]"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={SPRING.popup}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 pt-5">
              <h3 className="font-display text-3xl font-light text-ink">Withdraw {usdcText(denom)} USDC</h3>
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
              {stage === 'done' && txHash ? (
                <div className="flex flex-col items-center gap-3 text-center">
                  <SuccessMark />
                  <p className="text-sm font-semibold text-ink">
                    Withdrawn to {destination.slice(0, 6)}...{destination.slice(-4)}
                  </p>
                  <a className="mono inline-flex min-h-8 items-center gap-1 text-xs text-ink underline-offset-4 hover:underline" href={buildTxExplorerUrl(CHAIN_ID, txHash)} target="_blank" rel="noopener noreferrer">
                    {shortHash(txHash)} <ExternalLink className="size-3" aria-hidden />
                  </a>
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
                      disabled={busy}
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
                        {mode === m.id && (
                          <motion.span layoutId="withdraw-mode" className="absolute inset-0 rounded-2xl bg-surface" transition={SPRING.snappy} aria-hidden />
                        )}
                        <span className="relative block text-sm font-semibold text-ink">{m.title}</span>
                        <span className="relative block text-[11px] text-ink-2">{m.sub}</span>
                      </button>
                    ))}
                  </div>

                  <div className="panel rounded-2xl px-4 py-2">
                    <Row label="Note value" value={`${usdcText(denom)} USDC`} />
                    <Row label={mode === 'relayer' ? 'Relayer fee' : 'Fee'} value={`${usdcText(fee)} USDC`} />
                    <Row label="You receive" value={`${usdcText(receive)} USDC`} strong />
                  </div>

                  {mode === 'self' && (
                    <Notice tone="warn">
                      Sending from your own wallet links that wallet to the destination address on the public chain. Use the relayer for stronger privacy.
                    </Notice>
                  )}
                  {relayerDown && <Notice tone="warn">The relayer is not reachable right now, so only withdrawing from your own wallet is available.</Notice>}
                  {fresh && (
                    <Notice tone="warn">
                      This payment arrived minutes ago. Waiting longer before you withdraw makes it harder to match to the deposit.
                    </Notice>
                  )}
                  {error && <Notice tone="error">{error}</Notice>}

                  <button className="btn-primary w-full" disabled={!canStart} onClick={() => void withdraw()}>
                    {busy ? (
                      <>
                        <Spinner /> {stageLabel}
                      </>
                    ) : mode === 'self' && wrongChain ? (
                      'Switch to Arc Testnet and withdraw'
                    ) : (
                      <>
                        Withdraw <ArrowRight className="btn-arrow size-4" aria-hidden />
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
