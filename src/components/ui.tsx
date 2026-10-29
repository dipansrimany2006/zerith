import { useState, type ReactNode } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

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
    <button type="button" onClick={() => void copy()} className="btn-ghost inline-flex items-center gap-1.5">
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? 'Copied' : label}
    </button>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`glass-card rounded-3xl p-5 ${className}`}>{children}</section>
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted)' }}>
      {children}
    </h2>
  )
}

export function Row({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-semibold' : ''}`} style={{ color: 'var(--ink)' }}>
        {value}
      </span>
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
  const color = tone === 'error' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--ink-2)'
  const bg =
    tone === 'error' ? 'rgba(186,43,76,0.08)' : tone === 'warn' ? 'rgba(154,106,18,0.10)' : 'rgba(18,45,69,0.05)'
  return (
    <div className="rounded-2xl px-4 py-3 text-xs leading-relaxed text-pretty" style={{ background: bg, color }}>
      {children}
    </div>
  )
}
