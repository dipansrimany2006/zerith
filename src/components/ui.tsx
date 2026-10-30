import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion, useReducedMotion } from 'framer-motion'
import { Check, Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { DURATION, EASE, SPRING } from '@/lib/motion'

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin`} aria-hidden />
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy. Select the text and copy it manually.')
    }
  }
  return (
    <button type="button" onClick={() => void copy()} className="btn-ghost">
      <span className="relative inline-flex size-4 items-center justify-center" aria-hidden>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={copied ? 'done' : 'copy'}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={SPRING.chevron}
            className="absolute"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </motion.span>
        </AnimatePresence>
      </span>
      {copied ? 'Copied' : label}
    </button>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink-2">{children}</h2>
}

export function Row({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-ink-2">{label}</span>
      <span className={`text-right tabular-nums text-ink ${strong ? 'font-semibold' : ''}`}>{value}</span>
    </div>
  )
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error'
  children: ReactNode
}) {
  const style =
    tone === 'error'
      ? 'border-danger text-danger'
      : tone === 'warn'
        ? 'border-warn text-warn'
        : 'border-line text-ink-2'
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING.snappy}
      role={tone === 'error' ? 'alert' : undefined}
      className={`border-l-2 bg-[var(--raised)] py-2.5 pl-3 pr-3 text-xs leading-relaxed text-pretty ${style}`}
    >
      {children}
    </motion.div>
  )
}

/** Counts up from 0 on mount, then glides between values on update. */
export function AnimatedNumber({ value, decimals = 2 }: { value: number; decimals?: number }) {
  const reduce = useReducedMotion()
  const current = useRef(0)
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (reduce) {
      current.current = value
      return
    }
    const first = current.current === 0
    const controls = animate(current.current, value, {
      duration: first ? DURATION.digitMount : DURATION.digitUpdate,
      ease: EASE.outCubic,
      onUpdate: (v) => {
        current.current = v
        setShown(v)
      },
    })
    return () => controls.stop()
  }, [value, reduce])

  return <span className="tabular-nums">{(reduce ? value : shown).toFixed(decimals)}</span>
}

const ORDINALS = ['1st', '2nd', '3rd', '4th']

/** "1st Step / Select ──── 2nd Step / Confirm ──── 3rd Step / Success" from the reference. */
export function Stepper({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="flex items-center gap-3 sm:gap-4" aria-label="Progress">
      {steps.map((label, i) => (
        <li key={label} className={`flex items-center gap-3 sm:gap-4 ${i < steps.length - 1 ? 'flex-1' : ''}`} aria-current={i === current ? 'step' : undefined}>
          <div className="shrink-0">
            <p className="text-[11px] leading-none text-ink-2">{ORDINALS[i]} Step</p>
            <p className={`mt-1 font-display text-lg leading-none transition-colors duration-300 ${i <= current ? 'text-ink' : 'text-muted'}`}>
              {label}
            </p>
          </div>
          {i < steps.length - 1 && (
            <div className="relative h-px flex-1 overflow-hidden bg-line" aria-hidden>
              <motion.div
                className="absolute inset-0 origin-left bg-ink"
                initial={false}
                animate={{ scaleX: i < current ? 1 : i === current ? 0.35 : 0 }}
                transition={SPRING.smooth}
              />
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

/** Ink disc pops in, then the check draws itself. */
export function SuccessMark() {
  return (
    <svg viewBox="0 0 56 56" className="size-16" aria-hidden>
      <motion.circle
        cx="28"
        cy="28"
        r="26"
        className="fill-ink"
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={SPRING.bouncy}
      />
      <motion.path
        d="M17 29 l7 7 l15 -16"
        fill="none"
        className="stroke-canvas"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: 0.18, duration: DURATION.checkDraw, ease: EASE.outExpo }}
      />
    </svg>
  )
}

/** Round icon badge used for list rows, like the coin badges in the reference. */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="box flex size-10 shrink-0 items-center justify-center rounded-full text-ink" aria-hidden>
      {children}
    </span>
  )
}
