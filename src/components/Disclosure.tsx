import { useMemo, useState } from 'react'
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
import { Card, CopyButton, Notice, SectionLabel, Spinner } from '@/components/ui'

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
      a.download = `shielded-usdc-report-${Date.now()}.json`
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
    <div className="space-y-3">
      <Card>
        <SectionLabel>Viewing key</SectionLabel>
        <p className="text-sm leading-relaxed text-pretty" style={{ color: 'var(--muted)' }}>
          Anyone with this key can read every payment sent to you, including amounts and memos. It cannot spend or withdraw. Share it only with someone you trust, such as an auditor.
        </p>
        <div className="glass-inner mt-3 rounded-2xl p-3">
          <p className="mono break-all text-xs" style={{ color: 'var(--ink-2)' }}>
            {revealed ? viewingKey : '•'.repeat(48)}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-ghost inline-flex items-center gap-1.5" onClick={() => setRevealed((v) => !v)}>
            {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {revealed ? 'Hide' : 'Reveal'}
          </button>
          {revealed && <CopyButton value={viewingKey} label="Copy key" />}
        </div>
        <div className="mt-3">
          <Notice tone="warn">A shared viewing key cannot be taken back. To stop someone seeing future payments, use a different wallet.</Notice>
        </div>
      </Card>

      <Card>
        <SectionLabel>Signed payment report</SectionLabel>
        <p className="mb-3 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          Pick the payments you want to prove. The report is signed by your wallet and each entry can be matched to a deposit on the public chain.
        </p>
        {candidates.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No payments found for your keys yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {candidates.map((e) => {
              const k = keyOf(e)
              return (
                <li key={k}>
                  <label className="glass-inner flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl p-3">
                    <input type="checkbox" className="size-4" checked={picked.has(k)} onChange={() => toggle(k)} />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-semibold tabular-nums">{e.direction === 'received' ? '+' : '-'}{e.amountUsdc} USDC</span>
                      <span className="block truncate text-xs" style={{ color: 'var(--muted)' }}>
                        {e.direction} · {e.memo || 'no memo'} · {timeAgo(e.timestamp)}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
        <div className="mt-4">
          <button className="btn-primary" disabled={picked.size === 0 || signing} onClick={() => void download()}>
            {signing ? (
              <span className="flex items-center justify-center gap-2"><Spinner /> Confirm in wallet...</span>
            ) : (
              <span className="flex items-center justify-center gap-2"><Download className="size-4" /> Sign and download report</span>
            )}
          </button>
        </div>
      </Card>

      <Card>
        <SectionLabel>Check a report</SectionLabel>
        <p className="mb-3 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          Paste a report file to check its signature and confirm each payment exists on the pool ({logs.length} deposits loaded).
        </p>
        <textarea className="field mono h-28 py-3 text-xs" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{"version":1,...}' spellCheck={false} />
        <div className="mt-3">
          <button className="btn-ghost inline-flex items-center gap-1.5" disabled={!pasted.trim()} onClick={() => void verify()}>
            <FileCheck2 className="size-4" /> Check report
          </button>
        </div>
        {verifyResult && (
          <div className="mt-3 space-y-1">
            <Notice tone={verifyResult.ok ? 'info' : 'error'}>
              <strong>{verifyResult.ok ? 'Report is valid.' : 'Report did not check out.'}</strong>
              {verifyResult.lines.map((l) => (
                <span key={l} className="block">{l}</span>
              ))}
            </Notice>
          </div>
        )}
      </Card>
    </div>
  )
}
