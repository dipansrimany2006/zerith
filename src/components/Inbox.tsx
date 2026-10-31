import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDownToLine, Inbox as InboxIcon, RefreshCw } from 'lucide-react'
import { useShielded, useShieldedBalance, type OwnedNote } from '@/lib/shielded-context'
import { timeAgo, usdcNumber, usdcText } from '@/lib/format'
import { SPRING, STAGGER } from '@/lib/motion'
import { AnimatedNumber, Badge, Notice, SectionLabel } from '@/components/ui'
import { AddressCard } from '@/components/AddressCard'
import { WithdrawSheet } from '@/components/WithdrawSheet'

export function Inbox() {
  const { denominations, refresh, refreshing, loadedOnce, error } = useShielded()
  const { unspent, spent, total } = useShieldedBalance()
  const [selected, setSelected] = useState<OwnedNote[] | null>(null)

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] text-ink-2">Zerith balance</p>
          <p className="font-display text-5xl font-light text-ink">
            {loadedOnce ? <AnimatedNumber value={usdcNumber(total)} /> : <span className="skeleton inline-block h-10 w-32 align-middle" aria-label="Loading" />}
            <span className="ml-2 text-2xl text-muted">USDC</span>
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} className="btn-ghost" aria-label="Scan for new payments">
          <motion.span
            animate={refreshing ? { rotate: 360 } : { rotate: 0 }}
            transition={refreshing ? { repeat: Infinity, duration: 0.9, ease: 'linear' } : SPRING.chevron}
            className="inline-flex"
            aria-hidden
          >
            <RefreshCw className="size-4" />
          </motion.span>
          Scan
        </button>
      </div>

      <div className="mt-6">
        <AddressCard />
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>Received</SectionLabel>
          {unspent.length > 1 && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={SPRING.smooth}
              className="btn-primary -mt-3 min-h-10 px-4 text-[0.82rem]"
              onClick={() => setSelected(unspent)}
            >
              <ArrowDownToLine className="size-4" aria-hidden /> Withdraw all · {usdcText(total)} USDC
            </motion.button>
          )}
        </div>
        {error && <Notice tone="error">Could not scan the pool: {error}. Try Scan again.</Notice>}
        {!loadedOnce && !error && (
          <ul className="space-y-2" aria-label="Scanning the pool">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-3 py-2">
                <div className="skeleton size-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="skeleton h-4 w-24" />
                  <div className="skeleton h-3 w-36" />
                </div>
              </li>
            ))}
          </ul>
        )}
        {loadedOnce && unspent.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING.smooth} className="flex flex-col items-center gap-2 py-8 text-center">
            <InboxIcon className="size-6 text-muted" aria-hidden />
            <p className="text-sm font-semibold text-ink">No payments yet</p>
            <p className="max-w-xs text-xs text-ink-2 text-pretty">Copy your Zerith address above and share it. New payments show up here after a scan.</p>
          </motion.div>
        )}
        <ul>
          {unspent.map((n, i) => (
            <motion.li
              key={n.commitment.toString()}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...SPRING.smooth, delay: i * STAGGER.normal }}
              className="row-hover group -mx-3 flex items-center gap-3 rounded-2xl px-3 py-3"
            >
              <span className="transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105">
                <Badge>
                  <span className="font-display text-sm">{usdcText(denominations[n.denomIndex] ?? 0n)}</span>
                </Badge>
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg leading-tight text-ink">{usdcText(denominations[n.denomIndex] ?? 0n)} USDC</p>
                <p className="truncate text-[11px] text-ink-2">
                  {n.memo ? `${n.memo} · ` : ''}
                  {timeAgo(n.timestamp)}
                </p>
              </div>
              <button type="button" className="btn-ghost" onClick={() => setSelected([n])}>
                <ArrowDownToLine className="size-4" aria-hidden /> Withdraw
              </button>
            </motion.li>
          ))}
        </ul>
      </div>

      {spent.length > 0 && (
        <div className="mt-8">
          <SectionLabel>Already withdrawn</SectionLabel>
          <ul className="space-y-2">
            {spent.map((n) => (
              <li key={n.commitment.toString()} className="flex items-center justify-between text-sm">
                <span className="tabular-nums text-ink-2">
                  {usdcText(denominations[n.denomIndex] ?? 0n)} USDC{n.memo ? ` · ${n.memo}` : ''}
                </span>
                <span className="text-[11px] text-ink-2">{timeAgo(n.timestamp)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AnimatePresence>
        {selected && <WithdrawSheet key={selected.map((n) => n.commitment.toString()).join()} notes={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  )
}
