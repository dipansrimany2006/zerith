import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { ArrowDownToLine, Inbox as InboxIcon, RefreshCw } from 'lucide-react'
import { useShielded, type OwnedNote } from '@/lib/shielded-context'
import { timeAgo, usdcText } from '@/lib/format'
import { Card, Notice, SectionLabel, Spinner } from '@/components/ui'
import { WithdrawSheet } from '@/components/WithdrawSheet'

export function Inbox() {
  const { incoming, denominations, refresh, refreshing, loadedOnce } = useShielded()
  const [selected, setSelected] = useState<OwnedNote | null>(null)

  const unspent = useMemo(() => incoming.filter((n) => !n.spent), [incoming])
  const spent = useMemo(() => incoming.filter((n) => n.spent), [incoming])
  const total = useMemo(
    () => unspent.reduce((sum, n) => sum + (denominations[n.denomIndex] ?? 0n), 0n),
    [unspent, denominations],
  )

  return (
    <div className="space-y-3">
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
            Shielded balance
          </span>
          <button type="button" onClick={() => void refresh()} className="btn-ghost inline-flex items-center gap-1.5" aria-label="Scan for new payments">
            {refreshing ? <Spinner /> : <RefreshCw className="size-4" />}
            Scan
          </button>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="display text-5xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
            {loadedOnce ? usdcText(total) : '...'}
          </span>
          <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>
            USDC
          </span>
        </div>
        <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>
          {unspent.length} unspent note{unspent.length === 1 ? '' : 's'} found for your keys
        </p>
      </Card>

      <Card>
        <SectionLabel>Received</SectionLabel>
        {loadedOnce && unspent.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <InboxIcon className="size-6" style={{ color: 'var(--subtle)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              No payments yet
            </p>
            <p className="max-w-xs text-xs text-pretty" style={{ color: 'var(--muted)' }}>
              Share your shielded address from the Receive tab. New payments appear here after you scan.
            </p>
          </div>
        )}
        <ul className="space-y-2">
          {unspent.map((n) => (
            <li key={n.commitment.toString()} className="glass-inner flex items-center gap-3 rounded-2xl p-3">
              <div className="min-w-0 flex-1">
                <p className="display text-lg font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                  {usdcText(denominations[n.denomIndex] ?? 0n)} <span className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
                </p>
                <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>
                  {n.memo ? `${n.memo} · ` : ''}
                  {timeAgo(n.timestamp)}
                </p>
              </div>
              <button type="button" className="btn-ghost inline-flex items-center gap-1.5" onClick={() => setSelected(n)}>
                <ArrowDownToLine className="size-4" /> Withdraw
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {spent.length > 0 && (
        <Card>
          <SectionLabel>Already withdrawn</SectionLabel>
          <ul className="space-y-2">
            {spent.map((n) => (
              <li key={n.commitment.toString()} className="flex items-center justify-between text-sm">
                <span className="tabular-nums" style={{ color: 'var(--ink-2)' }}>
                  {usdcText(denominations[n.denomIndex] ?? 0n)} USDC{n.memo ? ` · ${n.memo}` : ''}
                </span>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {timeAgo(n.timestamp)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!loadedOnce && <Notice>Scanning the pool for payments addressed to you...</Notice>}

      <AnimatePresence>
        {selected && <WithdrawSheet key={selected.commitment.toString()} note={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  )
}
