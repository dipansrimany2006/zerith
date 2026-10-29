import { ShieldCheck } from 'lucide-react'
import { useShielded } from '@/lib/shielded-context'
import { shortAddress } from '@/lib/shielded-keys'
import { Card, CopyButton, SectionLabel } from '@/components/ui'

/** The recipient's shareable shielded address. Anyone can pay it; only this wallet's keys can spend. */
export function AddressCard() {
  const { keys, lock } = useShielded()
  if (!keys) return null
  return (
    <Card>
      <SectionLabel>Your shielded address</SectionLabel>
      <div className="glass-inner flex items-start gap-3 rounded-2xl p-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0" style={{ color: 'var(--success)' }} />
        <div className="min-w-0">
          <p className="mono break-all text-xs leading-relaxed" style={{ color: 'var(--ink-2)' }} title={keys.address}>
            {shortAddress(keys.address)}
          </p>
          <p className="mt-1 text-xs text-pretty" style={{ color: 'var(--muted)' }}>
            Share this to get paid. It does not show your wallet address.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <CopyButton value={keys.address} label="Copy full address" />
        <button type="button" className="btn-ghost" onClick={lock}>
          Lock keys
        </button>
      </div>
    </Card>
  )
}
