import { useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useSwitchChain } from 'wagmi'
import { ShieldCheck } from 'lucide-react'
import { CHAIN_ID, POOL_ADDRESS } from '@/lib/pool'
import { ShieldedProvider, useShielded } from '@/lib/shielded-context'
import { useChainGuard } from '@/lib/use-chain-guard'
import { AddressCard } from '@/components/AddressCard'
import { Disclosure } from '@/components/Disclosure'
import { Inbox } from '@/components/Inbox'
import { PrivacyMeter } from '@/components/PrivacyMeter'
import { SendPrivate } from '@/components/SendPrivate'
import { UnlockCard } from '@/components/UnlockCard'
import { Card, Notice } from '@/components/ui'

type Tab = 'send' | 'receive' | 'privacy'

const TABS: { id: Tab; label: string }[] = [
  { id: 'send', label: 'Send' },
  { id: 'receive', label: 'Receive' },
  { id: 'privacy', label: 'Privacy' },
]

function Header() {
  return (
    <header className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <div className="flex size-9 items-center justify-center rounded-xl" style={{ background: 'var(--accent)' }}>
          <ShieldCheck className="size-5 text-white" />
        </div>
        <div className="leading-tight">
          <span className="display block text-lg font-bold" style={{ color: 'var(--ink)' }}>
            Shielded USDC
          </span>
          <span className="block text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted)' }}>
            Arc Testnet
          </span>
        </div>
      </div>
      <ConnectKitButton showBalance={false} />
    </header>
  )
}

function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="glass-pill mb-4 grid grid-cols-3 gap-1 rounded-2xl p-1" role="tablist" aria-label="Sections">
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => onChange(t.id)}
          className="min-h-11 rounded-xl text-sm font-semibold transition-colors"
          style={{
            background: tab === t.id ? 'var(--accent)' : 'transparent',
            color: tab === t.id ? '#fff' : 'var(--ink-2)',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function Landing() {
  return (
    <Card>
      <h1 className="display text-4xl font-bold leading-[1.05] text-balance" style={{ color: 'var(--ink)' }}>
        Pay in USDC without a public trail.
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-pretty" style={{ color: 'var(--muted)' }}>
        Send USDC into a shared pool and let the recipient withdraw with a zero-knowledge proof. On the public chain, nobody can tell which deposit paid which withdrawal.
      </p>
      <div className="mt-5">
        <ConnectKitButton.Custom>
          {({ show, isConnecting }) => (
            <button className="btn-primary" onClick={show} disabled={isConnecting}>
              {isConnecting ? 'Connecting...' : 'Connect wallet'}
            </button>
          )}
        </ConnectKitButton.Custom>
      </div>
    </Card>
  )
}

function Main() {
  const { isConnected, wrongChain } = useChainGuard()
  const { switchChain, isPending } = useSwitchChain()
  const { keys } = useShielded()
  const [tab, setTab] = useState<Tab>('send')

  if (!POOL_ADDRESS) {
    return <Notice tone="error">The pool is not configured. Set VITE_POOL_ADDRESS in .env and restart the app.</Notice>
  }

  if (!isConnected) {
    return (
      <div className="space-y-3">
        <Landing />
        <PrivacyMeter />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {wrongChain && (
        <Card>
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            Your wallet is on another network.
          </p>
          <button className="btn-primary mt-3" disabled={isPending} onClick={() => switchChain({ chainId: CHAIN_ID })}>
            Switch to Arc Testnet
          </button>
        </Card>
      )}
      <Tabs tab={tab} onChange={setTab} />
      {!keys ? (
        tab === 'privacy' ? (
          <>
            <PrivacyMeter />
            <UnlockCard />
          </>
        ) : (
          <UnlockCard />
        )
      ) : tab === 'send' ? (
        <SendPrivate />
      ) : tab === 'receive' ? (
        <>
          <AddressCard />
          <Inbox />
        </>
      ) : (
        <>
          <PrivacyMeter />
          <Disclosure />
        </>
      )}
    </div>
  )
}

export default function App() {
  return (
    <ShieldedProvider>
      <div className="relative min-h-dvh overflow-hidden">
        <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
          <div style={{ position: 'absolute', top: '8%', left: '5%', width: 280, height: 280, borderRadius: '50%', background: 'radial-gradient(circle, rgba(133,177,237,0.22) 0%, transparent 70%)', filter: 'blur(60px)' }} />
          <div style={{ position: 'absolute', bottom: '8%', right: '8%', width: 260, height: 260, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,205,131,0.2) 0%, transparent 70%)', filter: 'blur(58px)' }} />
        </div>
        <div className="relative z-10 mx-auto max-w-md px-4 pb-24 pt-6">
          <Header />
          <div className="mb-4">
            <Notice tone="warn">
              Testnet only and unaudited. The proof setup is for development, so do not use real funds. Need test USDC? Use Get test USDC in the Arc Studio sidebar.
            </Notice>
          </div>
          <Main />
        </div>
      </div>
    </ShieldedProvider>
  )
}
