import { useShielded } from '@/lib/shielded-context'
import { usdcText } from '@/lib/format'
import { Card, Notice, SectionLabel } from '@/components/ui'

function level(count: number): { label: string; share: number; color: string } {
  if (count >= 50) return { label: 'Good', share: 1, color: 'var(--success)' }
  if (count >= 10) return { label: 'Fair', share: 0.55, color: 'var(--warn)' }
  return { label: 'Low', share: Math.max(0.08, count / 20), color: 'var(--danger)' }
}

/** Real pool sizes per denomination. A bigger pool hides each payment among more deposits. */
export function PrivacyMeter() {
  const { denominations, poolCounts, loadedOnce, error } = useShielded()

  return (
    <Card>
      <SectionLabel>Privacy of the pool</SectionLabel>
      {!loadedOnce && !error && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Reading the pool...
        </p>
      )}
      {error && <Notice tone="error">Could not read the pool: {error}</Notice>}
      <ul className="space-y-3">
        {denominations.map((d, i) => {
          const count = poolCounts[i] ?? 0
          const l = level(count)
          return (
            <li key={d.toString()}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
                  {usdcText(d)} USDC notes
                </span>
                <span className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
                  {count} deposit{count === 1 ? '' : 's'} · <span style={{ color: l.color }}>{l.label}</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(18,45,69,0.08)' }}>
                <div className="h-full rounded-full" style={{ width: `${l.share * 100}%`, background: l.color }} />
              </div>
            </li>
          )
        })}
      </ul>
      <div className="mt-4">
        <Notice>
          A payment is hidden among all deposits of the same size. Small pools are easier to guess, so wait a while
          before withdrawing. Deposit and withdrawal amounts and times stay public; only the link between them is
          hidden.
        </Notice>
      </div>
    </Card>
  )
}
