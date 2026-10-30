import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { bytesToHex, verifyMessage } from 'viem'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { useAccount, useSignMessage } from 'wagmi'
import { Download, Eye, EyeOff, FileCheck2 } from 'lucide-react'
import { toast } from 'sonner'
import { CHAIN_ID, POOL_ADDRESS } from '@/lib/pool'
import { toBytes32Hex } from '@/lib/shielded-keys'
import { useShielded } from '@/lib/shielded-context'
import { friendlyError, timeAgo, usdcText } from '@/lib/format'
import { DURATION, SPRING, STAGGER } from '@/lib/motion'
import { CopyButton, Notice, SectionLabel, Spinner } from '@/components/ui'

/** Sections rise in one after another. */
const rise = (i: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { ...SPRING.smooth, delay: i * STAGGER.normal * 1.5 },
})

interface ReportEntry {
  direction: 'received' | 'sent'
  amountUsdc: string
  memo: string
  txHash: `0x${string}`
  commitment: `0x${string}`
  denomIndex: number
  leafIndex: number
  timestamp: number
}

interface Report {
  version: 1
  network: 'Arc Testnet'
  chainId: number
  pool: string
  generatedAt: string
  signer: string
  entries: ReportEntry[]
  hash: string
  signature: `0x${string}`
}

// Protocol string: signed reports are verified against it, so it keeps the original name.
const reportMessage = (hash: string) => `Shielded USDC payment report\nSHA-256: ${hash}`
const hashEntries = (entries: ReportEntry[]) => bytesToHex(sha256(utf8ToBytes(JSON.stringify(entries)))).slice(2)

export function Disclosure() {
  const { keys, incoming, outgoing, denominations, logs, refresh } = useShielded()
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const [revealed, setRevealed] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [signing, setSigning] = useState(false)
  const [pasted, setPasted] = useState('')
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; lines: string[] } | null>(null)

  const candidates = useMemo<ReportEntry[]>(() => {
    const make = (
      direction: ReportEntry['direction'],
      n: { denomIndex: number; memo: string; txHash: `0x${string}`; commitment: bigint; leafIndex: number; timestamp: number },
    ): ReportEntry => ({
      direction,
      amountUsdc: usdcText(denominations[n.denomIndex] ?? 0n),
      memo: n.memo,
      txHash: n.txHash,
      commitment: toBytes32Hex(n.commitment),
      denomIndex: n.denomIndex,
      leafIndex: n.leafIndex,
      timestamp: n.timestamp,
    })
    return [...incoming.map((n) => make('received', n)), ...outgoing.map((n) => make('sent', n))].sort((a, b) => b.timestamp - a.timestamp)
  }, [incoming, outgoing, denominations])

  const keyOf = (e: ReportEntry) => `${e.direction}:${e.commitment}`
  const toggle = (k: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  const download = async () => {
    if (!address || !POOL_ADDRESS) return
    const entries = candidates.filter((e) => picked.has(keyOf(e)))
    if (!entries.length) return
    setSigning(true)
    try {
      const hash = hashEntries(entries)
      const signature = await signMessageAsync({ message: reportMessage(hash) })
      const report: Report = {
        version: 1,
        network: 'Arc Testnet',
        chainId: CHAIN_ID,
        pool: POOL_ADDRESS,
        generatedAt: new Date().toISOString(),
        signer: address,
        entries,
        hash,
        signature,
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `zerith-report-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(friendlyError(err))
    } finally {
      setSigning(false)
    }
  }

  const verify = async () => {
    setVerifyResult(null)
    try {
      const report = JSON.parse(pasted) as Report
      const latest = await refresh()
      const lines: string[] = []
      let ok = true
      const hashOk = hashEntries(report.entries) === report.hash
      lines.push(hashOk ? 'Report contents match the signed hash.' : 'Report contents were changed after signing.')
      const sigOk = await verifyMessage({ address: report.signer as `0x${string}`, message: reportMessage(report.hash), signature: report.signature })
      lines.push(sigOk ? `Signed by ${report.signer}.` : 'Signature does not match the signer.')
      ok = hashOk && sigOk
      for (const e of report.entries) {
        const found = latest.some((l) => toBytes32Hex(l.commitment) === e.commitment && l.txHash === e.txHash && l.denomIndex === e.denomIndex)
        lines.push(`${found ? 'On chain' : 'NOT FOUND'}: ${e.direction} ${e.amountUsdc} USDC, transaction ${e.txHash.slice(0, 10)}...`)
        ok = ok && found
      }
      setVerifyResult({ ok, lines })
    } catch {
      setVerifyResult({ ok: false, lines: ['That does not look like a report file.'] })
    }
  }

  if (!keys) return null
  const viewingKey = bytesToHex(keys.viewPriv)

  return (
    <div className="space-y-4">
      <motion.section {...rise(0)} className="box rounded-2xl p-5">
        <SectionLabel>Viewing key</SectionLabel>
        <p className="text-sm leading-relaxed text-ink-2 text-pretty">
          Anyone with this key can read every payment sent to you, including amounts and memos. It cannot spend or withdraw. Share it only with someone you trust, such as an auditor.
        </p>
        <div className="panel mt-3 overflow-hidden rounded-xl p-3">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={revealed ? 'shown' : 'hidden'}
              initial={{ opacity: 0, filter: 'blur(4px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, filter: 'blur(4px)' }}
              transition={{ duration: DURATION.crossFade }}
              className="mono break-all text-xs text-ink"
            >
              {revealed ? viewingKey : '•'.repeat(48)}
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={() => setRevealed((v) => !v)}>
            {revealed ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />} {revealed ? 'Hide' : 'Reveal'}
          </button>
          {revealed && <CopyButton value={viewingKey} label="Copy key" />}
        </div>
        <div className="mt-3">
          <Notice tone="warn">A shared viewing key cannot be taken back. To stop someone seeing future payments, use a different wallet.</Notice>
        </div>
      </motion.section>

      <motion.section {...rise(1)} className="box rounded-2xl p-5">
        <SectionLabel>Signed payment report</SectionLabel>
        <p className="mb-3 text-sm text-ink-2 text-pretty">
          Pick the payments you want to prove. The report is signed by your wallet and each entry can be matched to a deposit on the public chain.
        </p>
        {candidates.length === 0 ? (
          <p className="text-sm text-ink-2">No payments found for your keys yet.</p>
        ) : (
          <ul className="space-y-1">
            {candidates.map((e) => {
              const k = keyOf(e)
              const on = picked.has(k)
              return (
                <li key={k}>
                  <label className={`row-hover flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 ${on ? 'bg-surface' : ''}`}>
                    <input type="checkbox" className="size-4 accent-[color:var(--ink)]" checked={on} onChange={() => toggle(k)} />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-display text-lg tabular-nums text-ink">{e.direction === 'received' ? '+' : '-'}{e.amountUsdc} USDC</span>
                      <span className="block truncate text-[11px] text-ink-2">
                        {e.direction} · {e.memo || 'no memo'} · {timeAgo(e.timestamp)}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
        <div className="mt-4 flex justify-end">
          <button className="btn-primary" disabled={picked.size === 0 || signing} onClick={() => void download()}>
            {signing ? (
              <>
                <Spinner /> Confirm in wallet...
              </>
            ) : (
              <>
                <Download className="size-4" aria-hidden /> Sign and download report
              </>
            )}
          </button>
        </div>
      </motion.section>

      <motion.section {...rise(2)} className="box rounded-2xl p-5">
        <SectionLabel>Check a report</SectionLabel>
        <label htmlFor="report" className="mb-3 block text-sm text-ink-2 text-pretty">
          Paste a report file to check its signature and confirm each payment exists on the pool ({logs.length} deposits loaded).
        </label>
        <textarea id="report" className="field mono h-28 py-3 text-xs" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{"version":1,...}' spellCheck={false} />
        <div className="mt-3">
          <button className="btn-ghost" disabled={!pasted.trim()} onClick={() => void verify()}>
            <FileCheck2 className="size-4" aria-hidden /> Check report
          </button>
        </div>
        {verifyResult && (
          <div className="mt-3">
            <Notice tone={verifyResult.ok ? 'info' : 'error'}>
              <strong>{verifyResult.ok ? 'Report is valid.' : 'Report did not check out.'}</strong>
              {verifyResult.lines.map((l) => (
                <span key={l} className="block">{l}</span>
              ))}
            </Notice>
          </div>
        )}
      </motion.section>
    </div>
  )
}
