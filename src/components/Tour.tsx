/* ─────────────────────────────────────────────────────────
 * FIRST-VISIT TOUR
 *
 * A spotlight ring glides from one part of the app to the next while a step card
 * sits beside it ("01 / 08 · Wallet", title, tag, one sentence, Back / Next).
 * Shown once per browser (localStorage), replayable from the rail's ? button.
 *
 *    0ms   page dims, ring springs onto the target
 *   60ms   card rises in next to it
 *  step    ring glides to the next target (tabs switch first), card swaps content
 * ───────────────────────────────────────────────────────── */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeftRight, Compass, FileCheck2, Inbox, Layers, ShieldCheck, SlidersHorizontal, Wallet, X, type LucideIcon } from 'lucide-react'
import { SPRING } from '@/lib/motion'
import { Badge } from '@/components/ui'

export type TourTab = 'send' | 'receive' | 'audit'
type Side = 'bottom' | 'right' | 'top' | 'left'

type Step = {
  target: string // matches a data-tour attribute
  tab?: TourTab // switched to before the step shows
  section: string
  title: string
  tag: string
  icon: LucideIcon
  side: Side
  body: ReactNode
}

const STEPS: Step[] = [
  {
    target: 'wallet',
    section: 'Wallet',
    title: 'Connect your wallet',
    tag: 'Non-custodial',
    icon: Wallet,
    side: 'bottom',
    body: 'Zerith never holds your funds or your keys. Your own wallet signs every transaction.',
  },
  {
    target: 'balances',
    section: 'Balances',
    title: 'Public and private',
    tag: 'Two balances',
    icon: Layers,
    side: 'bottom',
    body: 'Your public wallet is the USDC anyone can see on chain. Zerith is your private balance: notes only you can open.',
  },
  {
    target: 'nav',
    section: 'Navigation',
    title: 'Send, Receive, Audit',
    tag: '3 sections',
    icon: Compass,
    side: 'right',
    body: 'Everything happens in three places. Switch between them here.',
  },
  {
    target: 'panel',
    tab: 'send',
    section: 'Send',
    title: 'Pay a Zerith address',
    tag: 'Encrypted',
    icon: ArrowLeftRight,
    side: 'bottom',
    body: 'Paste someone’s Zerith address and an amount. It’s split into standard notes and sealed so only they can read it, memo included.',
  },
  {
    target: 'panel',
    tab: 'receive',
    section: 'Receive',
    title: 'Your private inbox',
    tag: 'Only you see it',
    icon: Inbox,
    side: 'bottom',
    body: 'Sign once to create your Zerith address, then share it. Payments sent to you show up here, and nowhere else.',
  },
  {
    target: 'panel',
    tab: 'receive',
    section: 'Withdraw',
    title: 'Withdraw with a proof',
    tag: 'Zero-knowledge',
    icon: ShieldCheck,
    side: 'bottom',
    body: 'Withdraw to any address. Your browser proves the money is yours without revealing which payment it was, and the relayer can pay the gas.',
  },
  {
    target: 'panel',
    tab: 'audit',
    section: 'Audit',
    title: 'Prove it when you need to',
    tag: 'Your choice',
    icon: FileCheck2,
    side: 'bottom',
    body: 'Export a signed report of your own payments for an accountant or auditor. Nobody else can make one for you.',
  },
  {
    target: 'controls',
    section: 'Controls',
    title: 'Theme, lock and help',
    tag: 'Your session',
    icon: SlidersHorizontal,
    side: 'right',
    body: 'Switch light or dark, lock your keys when you’re done, and replay this tour any time from the ? button.',
  },
]

const SEEN_KEY = 'zerith:tour-seen'
const RING_PAD = 8 // px of breathing room around the highlighted element
const MARGIN = 16 // px kept clear of the viewport edge
const GAP = 14 // px between the ring and the card
const CARD_W = 360
const DOCK_BOTTOM = 64 // px: on phones the card docks above the "Built with Arc Studio" badge
const DOCK_TOP = 92 // px: or just under the sticky rail

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true // storage blocked: never auto-start, the ? button still works
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // storage blocked: nothing to remember
  }
}

type Box = { top: number; left: number; width: number; height: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/** Where the card goes: beside the ring if it fits, inside a large target otherwise, docked on phones. */
function placeCard(ring: Box, card: { w: number; h: number }, prefer: Side, vw: number, vh: number) {
  // Phones: dock at the bottom, or at the top (under the sticky rail) when the target sits low on screen.
  if (vw < 640) return { left: MARGIN, top: ring.top + ring.height / 2 > vh / 2 ? DOCK_TOP : vh - card.h - DOCK_BOTTOM }
  const bottom = Math.min(ring.top + ring.height, vh)
  if (ring.height > vh * 0.6 || ring.width > vw * 0.6) {
    return { left: clamp(ring.left + 24, MARGIN, vw - card.w - MARGIN), top: clamp(bottom - card.h - 24, MARGIN, vh - card.h - MARGIN) }
  }
  const options: Record<Side, { left: number; top: number }> = {
    bottom: { left: clamp(ring.left, MARGIN, vw - card.w - MARGIN), top: ring.top + ring.height + GAP },
    top: { left: clamp(ring.left, MARGIN, vw - card.w - MARGIN), top: ring.top - card.h - GAP },
    right: { left: ring.left + ring.width + GAP, top: clamp(ring.top, MARGIN, vh - card.h - MARGIN) },
    left: { left: ring.left - card.w - GAP, top: clamp(ring.top, MARGIN, vh - card.h - MARGIN) },
  }
  const fits = (p: { left: number; top: number }) =>
    p.left >= MARGIN && p.top >= MARGIN && p.left + card.w <= vw - MARGIN && p.top + card.h <= vh - MARGIN
  for (const side of [prefer, 'bottom', 'right', 'top', 'left'] as Side[]) if (fits(options[side])) return options[side]
  return { left: clamp(ring.left, MARGIN, vw - card.w - MARGIN), top: clamp(vh - card.h - MARGIN, MARGIN, vh) }
}

/** Tracks a data-tour element's box every frame (tabs animate in, the page scrolls). */
function useTargetBox(target: string | null): Box | null {
  const [box, setBox] = useState<Box | null>(null)
  useEffect(() => {
    if (!target) return
    let frame = 0
    const el = () => document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
    const first = el()
    if (first) {
      const r = first.getBoundingClientRect()
      // Phones dock the card at the bottom, so bring the target near the top (the sticky rail needs no scroll).
      if (window.innerWidth < 640 && !first.closest('.rail')) window.scrollBy({ top: r.top - window.innerHeight * 0.2, behavior: 'smooth' })
      else if (r.top < 0 || r.bottom > window.innerHeight) first.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    const tick = () => {
      const node = el()
      if (node) {
        const r = node.getBoundingClientRect()
        const next = { top: r.top - RING_PAD, left: r.left - RING_PAD, width: r.width + RING_PAD * 2, height: r.height + RING_PAD * 2 }
        setBox((prev) =>
          prev && Math.abs(prev.top - next.top) < 0.5 && Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.height - next.height) < 0.5
            ? prev
            : next,
        )
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target])
  return box
}

export function Tour({ open, onClose, onTab }: { open: boolean; onClose: () => void; onTab: (tab: TourTab) => void }) {
  const [index, setIndex] = useState(0)
  const step = STEPS[index]
  const box = useTargetBox(open ? step.target : null)
  const cardRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const [cardSize, setCardSize] = useState({ w: CARD_W, h: 220 })
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight })

  useEffect(() => {
    if (open) setIndex(0)
  }, [open])

  useEffect(() => {
    if (open && step.tab) onTab(step.tab)
  }, [open, step, onTab])

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useLayoutEffect(() => {
    const el = cardRef.current
    if (el) setCardSize({ w: el.offsetWidth, h: el.offsetHeight })
  }, [index, open, viewport.w])

  useEffect(() => {
    if (open) nextRef.current?.focus({ preventScroll: true })
  }, [open, index])

  const finish = useCallback(() => {
    markSeen()
    onClose()
  }, [onClose])
  const next = useCallback(() => (index === STEPS.length - 1 ? finish() : setIndex(index + 1)), [index, finish])
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, finish, next, back])

  const pos = box ? placeCard(box, cardSize, step.side, viewport.w, viewport.h) : null
  const Icon = step.icon
  const count = (n: number) => String(n).padStart(2, '0')

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="tour" className="pointer-events-none fixed inset-0 z-[10000]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          {box && (
            <motion.div
              aria-hidden
              className="tour-ring absolute rounded-[26px]"
              initial={false}
              animate={{ top: box.top, left: box.left, width: box.width, height: box.height }}
              transition={SPRING.smooth}
            />
          )}
          {pos && (
            <motion.div
              ref={cardRef}
              role="dialog"
              aria-modal="false"
              aria-labelledby="tour-title"
              aria-describedby="tour-body"
              className="tour-card pointer-events-auto absolute w-[min(360px,calc(100vw-32px))] rounded-[22px] p-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, top: pos.top, left: pos.left }}
              transition={{ ...SPRING.smooth, opacity: { duration: 0.2, delay: 0.06 } }}
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-full bg-ink px-2.5 py-1 font-mono text-xs font-medium tabular-nums text-canvas">
                  <span className="size-1.5 rounded-full bg-canvas" aria-hidden />
                  {count(index + 1)} / {count(STEPS.length)}
                </span>
                <span className="text-sm font-semibold text-ink">{step.section}</span>
                <button type="button" onClick={finish} className="ml-auto rounded-lg px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:text-ink">
                  Skip
                </button>
                <button type="button" onClick={finish} aria-label="Close tour" className="-mr-1 flex size-8 items-center justify-center rounded-lg text-ink-2 transition-colors hover:text-ink">
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="my-4 h-px bg-line" aria-hidden />

              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={index} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.16 }} className="flex gap-4">
                  <Badge>
                    <Icon className="size-4" />
                  </Badge>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h2 id="tour-title" className="font-display text-xl font-medium leading-tight text-ink">
                        {step.title}
                      </h2>
                      <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-2">{step.tag}</span>
                    </div>
                    <p id="tour-body" className="mt-1.5 text-sm leading-relaxed text-ink-2 text-pretty">
                      {step.body}
                    </p>
                  </div>
                </motion.div>
              </AnimatePresence>

              <div className="mt-5 flex items-center gap-3">
                <div className="flex flex-1 items-center gap-1" aria-hidden>
                  {STEPS.map((_, i) => (
                    <motion.span
                      key={i}
                      className={`h-1 rounded-full ${i <= index ? 'bg-ink' : 'bg-line'}`}
                      animate={{ width: i === index ? 18 : 6 }}
                      transition={SPRING.snappy}
                    />
                  ))}
                </div>
                <button type="button" onClick={back} disabled={index === 0} className="rounded-lg px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:text-ink disabled:opacity-30">
                  Back
                </button>
                <button ref={nextRef} type="button" onClick={next} className="btn-primary min-h-10 px-4 text-sm">
                  {index === STEPS.length - 1 ? 'Finish' : 'Next'}
                </button>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
