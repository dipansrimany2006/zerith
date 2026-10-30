import { motion } from 'framer-motion'
import { ArrowDownLeft, ArrowUpRight, Repeat2, type LucideIcon } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID } from '@/lib/pool'
import { useShielded, type OwnedNote } from '@/lib/shielded-context'
import { shortAddress } from '@/lib/shielded-keys'
import type { OutgoingNote } from '@/lib/notes'
import { timeAgo, usdcText } from '@/lib/format'
import { SPRING, STAGGER } from '@/lib/motion'
import { Badge, SectionLabel } from '@/components/ui'

const LIMIT = 6

type Kind = 'received' | 'sent' | 'self'

interface Entry {
  key: string
  kind: Kind
  amount: bigint
  notes: number
  /** Received notes already withdrawn, out of `notes`. */
  withdrawn: number
  memo: string
  recipient?: string
  txHash: `0x${string}`
  timestamp: number
}

const KIND: Record<Kind, { label: string; icon: LucideIcon; sign: string }> = {
  received: { label: 'Received', icon: ArrowDownLeft, sign: '+' },
  sent: { label: 'Sent', icon: ArrowUpRight, sign: '−' },
  self: { label: 'Moved to Zerith', icon: Repeat2, sign: '' },
}

/**
 * One entry per payment: notes from the same deposit transaction are grouped, and a payment to your
 * own address (both an incoming and an outgoing copy) shows once.
 */
function buildActivity(incoming: OwnedNote[], outgoing: OutgoingNote[], denominations: bigint[]): Entry[] {
  const byTx = new Map<string, Entry>()
  const value = (denomIndex: number) => denominations[denomIndex] ?? 0n

  for (const n of incoming) {
    const e = byTx.get(n.txHash) ?? {
      key: n.txHash,
      kind: 'received' as Kind,
      amount: 0n,
      notes: 0,
      withdrawn: 0,
      memo: n.memo,
      txHash: n.txHash,
      timestamp: n.timestamp,
    }
    e.amount += value(n.denomIndex)
    e.notes += 1
    if (n.spent) e.withdrawn += 1
    byTx.set(n.txHash, e)
  }

  const sent = new Map<string, Entry>()
  for (const n of outgoing) {
    const e = sent.get(n.txHash) ?? {
      key: `${n.txHash}:out`,
      kind: 'sent' as Kind,
      amount: 0n,
      notes: 0,
      withdrawn: 0,
      memo: n.memo,
      recipient: n.recipient,
      txHash: n.txHash,
      timestamp: n.timestamp,
    }
    e.amount += value(n.denomIndex)
    e.notes += 1
    sent.set(n.txHash, e)
  }
  for (const [tx, e] of sent) {
    const own = byTx.get(tx)
    if (own) own.kind = 'self'
    else byTx.set(tx, e)
  }

  return [...byTx.values()].sort((a, b) => b.timestamp - a.timestamp)
}

function status(e: Entry): string {
  if (e.kind === 'sent') return e.recipient ? `To ${shortAddress(e.recipient)}` : 'Private payment'
  if (e.withdrawn === 0) return 'Available'
  if (e.withdrawn === e.notes) return 'Withdrawn'
  return `${e.withdrawn} of ${e.notes} notes withdrawn`
}

function ActivityRow({ entry, index }: { entry: Entry; index: number }) {
  const kind = KIND[entry.kind]
  const Icon = kind.icon
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING.smooth, delay: index * STAGGER.tight }}
    >
      <a
        href={buildTxExplorerUrl(CHAIN_ID, entry.txHash)}
        target="_blank"
        rel="noreferrer"
        className="row-hover group -mx-3 flex items-center gap-3 rounded-2xl px-3 py-2.5"
        aria-label={`${kind.label} ${usdcText(entry.amount)} USDC, ${timeAgo(entry.timestamp)}. View on explorer`}
      >
        <span className="transition-transform duration-300 group-hover:scale-105">
          <Badge>
            <Icon className="size-4" />
          </Badge>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{kind.label}</p>
          <p className="truncate text-[11px] text-ink-2">{entry.memo ? `“${entry.memo}”` : status(entry)}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-base leading-tight text-ink tabular-nums">
            {kind.sign}
            {usdcText(entry.amount)}
          </p>
          <p className="text-[11px] text-ink-2">{entry.memo ? status(entry) : timeAgo(entry.timestamp)}</p>
        </div>
      </a>
    </motion.li>
  )
}

function Placeholder({ children }: { children: string }) {
  return <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-xs text-ink-2 text-pretty">{children}</p>
}

/** Your private payment history, read from notes decrypted in this browser. Nobody else can see it. */
export function Activity() {
  const { keys, incoming, outgoing, denominations, loadedOnce, error } = useShielded()

  let body
  if (!keys) {
    body = <Placeholder>Unlock to see your private activity. It is decrypted only in this browser.</Placeholder>
  } else if (!loadedOnce && !error) {
    body = (
      <ul aria-label="Loading activity" className="space-y-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-3 py-1.5">
            <span className="skeleton size-10 rounded-full" />
            <span className="flex-1 space-y-1.5">
              <span className="skeleton block h-3 w-20" />
              <span className="skeleton block h-2.5 w-28" />
            </span>
            <span className="skeleton h-4 w-12" />
          </li>
        ))}
      </ul>
    )
  } else if (error && !loadedOnce) {
    body = <Placeholder>Could not load your activity. It will retry on the next scan.</Placeholder>
  } else {
    const entries = buildActivity(incoming, outgoing, denominations)
    body =
      entries.length === 0 ? (
        <Placeholder>No activity yet. Payments you send or receive show up here.</Placeholder>
      ) : (
        <ul>
          {entries.slice(0, LIMIT).map((e, i) => (
            <ActivityRow key={e.key} entry={e} index={i} />
          ))}
        </ul>
      )
  }

  return (
    <section aria-label="Recent activity">
      <SectionLabel>Recent activity</SectionLabel>
      {body}
    </section>
  )
}
