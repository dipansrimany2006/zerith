import { motion } from 'framer-motion'
import { useShielded } from '@/lib/shielded-context'
import { usdcText } from '@/lib/format'
import { SPRING, STAGGER } from '@/lib/motion'
import { Notice } from '@/components/ui'

function level(count: number): { label: string; share: number; tone: string } {
  if (count >= 50) return { label: 'Good privacy', share: 1, tone: 'text-success' }
  if (count >= 10) return { label: 'Fair privacy', share: 0.55, tone: 'text-warn' }
  return { label: 'Low privacy', share: Math.max(0.06, count / 20), tone: 'text-danger' }
}

/** Real pool sizes per denomination. A bigger pool hides each payment among more deposits. */
export function PrivacyMeter({ show = true, delay = 0 }: { show?: boolean; delay?: number }) {
  const { denominations, poolCounts, loadedOnce, error } = useShielded()

  if (error) return <Notice tone="error">Could not read the pool: {error}</Notice>

  if (!loadedOnce) {
    return (
      <ul className="space-y-4" aria-label="Loading pool size">
        {[0, 1, 2].map((i) => (
          <li key={i} className="space-y-2">
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-1 w-full" />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <ul className="space-y-4">
      {denominations.map((d, i) => {
        const count = poolCounts[i] ?? 0
        const l = level(count)
        return (
          <motion.li
            key={d.toString()}
            initial={{ opacity: 0, x: -12 }}
            animate={show ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
            transition={{ ...SPRING.smooth, delay: delay + i * STAGGER.normal }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-ink">{usdcText(d)} USDC notes</span>
              <span className="font-display text-xl tabular-nums text-ink">{count}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className={l.tone}>{l.label}</span>
              <span className="text-ink-2">deposit{count === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-page" aria-hidden>
              <motion.div
                className="h-full origin-left rounded-full bg-ink"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: show ? l.share : 0 }}
                transition={{ ...SPRING.smooth, delay: delay + 0.15 + i * STAGGER.normal }}
              />
            </div>
          </motion.li>
        )
      })}
    </ul>
  )
}
