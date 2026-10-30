import { useShielded } from '@/lib/shielded-context'
import { shortAddress } from '@/lib/shielded-keys'
import { Badge, CopyButton } from '@/components/ui'
import { ZerithMark } from '@/components/Logo'

/** The recipient's shareable shielded (Zerith) address. Anyone can pay it; only this wallet's keys can spend. */
export function AddressCard() {
  const { keys } = useShielded()
  if (!keys) return null
  return (
    <div className="box flex flex-wrap items-center gap-3 rounded-2xl p-4">
      <Badge>
        <ZerithMark className="size-5" pupil="var(--canvas)" />
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-ink-2">Your Zerith address</p>
        <p className="mono truncate text-sm text-ink" title={keys.address}>
          {shortAddress(keys.address)}
        </p>
      </div>
      <CopyButton value={keys.address} label="Copy address" />
    </div>
  )
}
