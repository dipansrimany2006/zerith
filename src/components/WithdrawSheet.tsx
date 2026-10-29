import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { isAddress, zeroAddress, type Address } from 'viem'
import { usePublicClient, useWriteContract } from 'wagmi'
import { Check, ExternalLink, X } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID, POOL_ADDRESS, poolAbi } from '@/lib/pool'
import { leavesFor } from '@/lib/scan'
import { proveWithdraw } from '@/lib/prover'
import { useShielded, type OwnedNote } from '@/lib/shielded-context'
import { useChainGuard } from '@/lib/use-chain-guard'
import { friendlyError, shortHash, usdcText } from '@/lib/format'
import { Notice, Row, Spinner } from '@/components/ui'

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

  return (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => !busy && onClose()}
        >
          <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" />
          <motion.section
            role="dialog"
            aria-label="Withdraw a note"
            className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl"
            style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(40px) saturate(200%)', WebkitBackdropFilter: 'blur(40px) saturate(200%)' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-1" style={{ background: 'linear-gradient(90deg, #5fbeff, #af8ff4, #f05c6b, #ffcd83, #7ef1b3)' }} />
            <div className="flex items-center justify-between px-5 pt-4">
              <h3 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>
                Withdraw {usdcText(denom)} USDC
              </h3>
              <button type="button" aria-label="Close" disabled={busy} onClick={onClose} className="flex size-11 items-center justify-center rounded-full disabled:opacity-40">
                <X className="size-5" />
              </button>
            </div>

            <div className="space-y-4 px-5 pb-6 pt-2">
              {stage === 'done' && txHash ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--success)' }}>
                    <Check className="size-5" /> Withdrawn to {destination.slice(0, 6)}...{destination.slice(-4)}
                  </div>
                  <a className="mono inline-flex items-center gap-1 text-xs" style={{ color: 'var(--accent-hover)' }} href={buildTxExplorerUrl(CHAIN_ID, txHash)} target="_blank" rel="noopener noreferrer">
                    {shortHash(txHash)} <ExternalLink className="size-3" />
                  </a>
                  <button className="btn-primary" onClick={onClose}>
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold" style={{ color: 'var(--ink-2)' }} htmlFor="destination">
                      Destination address
                    </label>
                    <input
                      id="destination"
                      className="field mono mt-1.5 text-xs"
                      placeholder="0x..."
                      value={destination}
                      onChange={(e) => setDestination(e.target.value.trim())}
                      disabled={busy}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="mt-1 text-xs" style={{ color: destination && !validDestination ? 'var(--danger)' : 'var(--muted)' }}>
                      {destination && !validDestination ? 'Not a valid address.' : 'Use a fresh address that no one links to you.'}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who submits the transaction">
                    <button type="button" role="radio" aria-checked={mode === 'relayer'} disabled={busy || relayerDown} onClick={() => setMode('relayer')} className="glass-inner min-h-14 rounded-2xl p-3 text-left disabled:opacity-40" style={{ borderColor: mode === 'relayer' ? 'var(--border-strong)' : undefined }}>
                      <span className="block text-sm font-semibold">Relayer</span>
                      <span className="block text-xs" style={{ color: 'var(--muted)' }}>No gas needed</span>
                    </button>
                    <button type="button" role="radio" aria-checked={mode === 'self'} disabled={busy} onClick={() => setMode('self')} className="glass-inner min-h-14 rounded-2xl p-3 text-left disabled:opacity-40" style={{ borderColor: mode === 'self' ? 'var(--border-strong)' : undefined }}>
                      <span className="block text-sm font-semibold">My wallet</span>
                      <span className="block text-xs" style={{ color: 'var(--muted)' }}>You pay gas</span>
                    </button>
                  </div>

                  <div className="glass-inner rounded-2xl px-4 py-2">
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

                  <button className="btn-primary" disabled={!canStart} onClick={() => void withdraw()}>
                    {busy ? (
                      <span className="flex items-center justify-center gap-2">
                        <Spinner /> {stageLabel}
                      </span>
                    ) : mode === 'self' && wrongChain ? (
                      'Switch to Arc Testnet and withdraw'
                    ) : (
                      'Withdraw'
                    )}
                  </button>
                </>
              )}
            </div>
          </motion.section>
        </motion.div>
  )
}
