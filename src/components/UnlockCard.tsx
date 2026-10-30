import { motion } from 'framer-motion'
import { ArrowRight, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { useShielded } from '@/lib/shielded-context'
import { friendlyError } from '@/lib/format'
import { SPRING } from '@/lib/motion'
import { Notice, Spinner } from '@/components/ui'

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
    <div className="flex h-full flex-col justify-center py-6">
      <motion.span
        initial={{ scale: 0.6, rotate: -20, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={SPRING.bouncy}
        className="flex size-14 items-center justify-center rounded-2xl bg-ink text-canvas"
        aria-hidden
      >
        <KeyRound className="size-6" />
      </motion.span>
      <h2 className="mt-6 max-w-md font-display text-4xl font-light leading-tight text-ink text-balance">Create your Zerith address</h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-2 text-pretty">
        Sign one message to create the private keys for this wallet. They are built in your browser and never sent
        anywhere. Signing costs nothing and sends no transaction.
      </p>
      <div className="mt-6 max-w-md space-y-3">
        <button className="btn-primary" disabled={unlocking} onClick={() => void onUnlock()}>
          {unlocking ? (
            <>
              <Spinner /> Confirm in wallet...
            </>
          ) : (
            <>
              Sign and unlock <ArrowRight className="btn-arrow size-4" aria-hidden />
            </>
          )}
        </button>
        <Notice>Use the same wallet next time and you get the same address and the same payments back.</Notice>
      </div>
    </div>
  )
}
