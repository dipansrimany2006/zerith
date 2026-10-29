import { KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { useShielded } from '@/lib/shielded-context'
import { friendlyError } from '@/lib/format'
import { Card, Notice, Spinner } from '@/components/ui'

/** Shown until the wallet signs the key-derivation message. No transaction, no gas. */
export function UnlockCard() {
  const { unlock, unlocking } = useShielded()

  const onUnlock = async () => {
    try {
      await unlock()
    } catch (err) {
      toast.error(friendlyError(err))
    }
  }

  return (
    <Card>
      <div className="mb-4 flex size-11 items-center justify-center rounded-2xl" style={{ background: 'rgba(18,45,69,0.08)' }}>
        <KeyRound className="size-5" style={{ color: 'var(--ink)' }} />
      </div>
      <h2 className="display text-2xl font-bold text-balance" style={{ color: 'var(--ink)' }}>
        Create your shielded address
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-pretty" style={{ color: 'var(--muted)' }}>
        Sign one message to create the private keys for this wallet. They are built in your browser and never sent
        anywhere. Signing costs nothing and sends no transaction.
      </p>
      <div className="mt-5 space-y-3">
        <button className="btn-primary" disabled={unlocking} onClick={() => void onUnlock()}>
          {unlocking ? (
            <span className="flex items-center justify-center gap-2">
              <Spinner /> Confirm in wallet...
            </span>
          ) : (
            'Sign and unlock'
          )}
        </button>
        <Notice>Use the same wallet next time and you get the same address and the same payments back.</Notice>
      </div>
    </Card>
  )
}
