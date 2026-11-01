/* ─────────────────────────────────────────────────────────
 * PAGE ENTRANCE STORYBOARD
 *
 * The frame and the dark rail are the static shell: visible at once.
 *
 *    0ms   frame + rail shell visible
 *    0ms   rail icons rise in (40ms apart)
 *   80ms   wallets column slides in from the left
 *  200ms   wallet rows and pool bars stagger in (60ms apart)
 *  260ms   main panel slides in from the right
 *
 * After mount: switching tabs cross-fades the panel (~200ms);
 * the active rail marker springs between icons.
 * ───────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { ConnectKitButton } from 'connectkit'
import { useSwitchChain } from 'wagmi'
import { ArrowDownToLine, ArrowLeftRight, ArrowRight, CircleHelp, FileCheck2, Lock, Moon, Sun, type LucideIcon } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { CHAIN_ID, POOL_ADDRESS } from '@/lib/pool'
import { CHAIN_NAME } from '@/lib/chain'
import { ShieldedProvider, useShielded } from '@/lib/shielded-context'
import { useChainGuard } from '@/lib/use-chain-guard'
import { DURATION, SPRING, STAGGER } from '@/lib/motion'
import { Disclosure } from '@/components/Disclosure'
import { Inbox } from '@/components/Inbox'
import { SendPrivate } from '@/components/SendPrivate'
import { UnlockCard } from '@/components/UnlockCard'
import { Wallets } from '@/components/Wallets'
import { ZerithMark } from '@/components/Logo'
import { Notice, Stepper } from '@/components/ui'
import { Tour, tourSeen } from '@/components/Tour'

type Tab = 'send' | 'receive' | 'audit'

const NAV: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'send', label: 'Send', icon: ArrowLeftRight },
  { id: 'receive', label: 'Receive', icon: ArrowDownToLine },
  { id: 'audit', label: 'Audit', icon: FileCheck2 },
]

const TIMING = {
  wallets: 80, // ms — wallets column
  rows: 200, // ms — wallet rows and pool bars
  panel: 260, // ms — main panel
  tour: 900, // ms — first-visit tour starts once the page has settled
}

const WALLETS = { offsetX: -24, spring: SPRING.smooth }
const PANEL = { offsetX: 24, spring: SPRING.smooth }

function useEntranceStage() {
  const [stage, setStage] = useState(0)
  useEffect(() => {
    const timers = [
      setTimeout(() => setStage((s) => Math.max(s, 1)), TIMING.wallets),
      setTimeout(() => setStage((s) => Math.max(s, 2)), TIMING.rows),
      setTimeout(() => setStage((s) => Math.max(s, 3)), TIMING.panel),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])
  return stage
}

/** Sun/moon switch: the icons swap with a quarter turn. */
function ThemeToggle() {
  const [theme, setTheme] = useTheme()
  const dark = theme === 'dark'
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <motion.button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.9 }}
      transition={SPRING.snappy}
      className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-muted transition-colors hover:text-[color:var(--rail-fg)]"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={theme}
          initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
          transition={SPRING.snappy}
          className="flex"
        >
          {dark ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  )
}

function Rail({ tab, onChange, onHelp }: { tab: Tab; onChange: (t: Tab) => void; onHelp: () => void }) {
  const { keys, lock } = useShielded()
  return (
    <nav aria-label="Sections" className="rail flex items-center gap-1 rounded-[22px] bg-[var(--rail)] p-2 lg:h-full lg:flex-col lg:gap-2 lg:rounded-[28px] lg:py-6">
      <span className="flex size-12 shrink-0 items-center justify-center text-[color:var(--rail-fg)]" role="img" aria-label="Zerith" title="Zerith">
        <ZerithMark className="size-8" pupil="var(--rail)" />
      </span>
      <div data-tour="nav" className="flex flex-1 items-center justify-center gap-1 lg:flex-col lg:gap-3">
        {NAV.map((item, i) => {
          const active = tab === item.id
          const Icon = item.icon
          return (
            <motion.button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              whileTap={{ scale: 0.92 }}
              transition={{ ...SPRING.snappy, delay: i * STAGGER.tight }}
              className={`group relative flex h-12 min-w-12 items-center justify-center gap-2 rounded-2xl px-3 transition-colors lg:w-12 lg:px-0 ${active ? 'text-[color:var(--rail-fg)]' : 'text-muted hover:text-[color:var(--rail-hover)]'}`}
            >
              {active && (
                <motion.span layoutId="rail-active" className="absolute inset-0 rounded-2xl bg-[var(--rail-active)]" transition={SPRING.snappy} aria-hidden />
              )}
              <Icon className="relative size-5 transition-transform duration-200 group-hover:-translate-y-0.5" aria-hidden />
              <span className="relative hidden text-xs font-semibold sm:inline lg:hidden">{item.label}</span>
            </motion.button>
          )
        })}
      </div>
      <div data-tour="controls" className="flex items-center gap-1 lg:flex-col lg:gap-2">
        <motion.button
          type="button"
          onClick={onHelp}
          aria-label="Take the tour"
          title="Take the tour"
          whileTap={{ scale: 0.9 }}
          transition={SPRING.snappy}
          className="flex size-12 shrink-0 items-center justify-center rounded-2xl text-muted transition-colors hover:text-[color:var(--rail-fg)]"
        >
          <CircleHelp className="size-5" aria-hidden />
        </motion.button>
        <ThemeToggle />
        {keys ? (
          <motion.button
            type="button"
            onClick={lock}
            aria-label="Lock keys"
            title="Lock keys"
            whileHover={{ rotate: -8 }}
            whileTap={{ scale: 0.9 }}
            transition={SPRING.chevron}
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl text-muted transition-colors hover:text-[color:var(--rail-fg)]"
          >
            <Lock className="size-5" aria-hidden />
          </motion.button>
        ) : (
          <span className="hidden size-12 shrink-0 lg:block" aria-hidden />
        )}
      </div>
    </nav>
  )
}

function Landing() {
  return (
    <div className="flex h-full flex-col">
      <Stepper steps={['Connect', 'Unlock', 'Send']} current={0} />
      <div className="flex flex-1 flex-col justify-center py-10">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-ink text-canvas">
            <ZerithMark className="size-7" />
          </span>
          <span className="font-display text-2xl font-medium uppercase tracking-[0.18em] text-ink">Zerith</span>
        </div>
        <h2 className="max-w-lg font-display text-5xl font-light leading-[1.02] text-ink text-balance">Pay in USDC without a public trail.</h2>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-2 text-pretty">
          Send USDC into a shared pool and let the recipient withdraw with a zero-knowledge proof. On the public chain,
          nobody can tell which deposit paid which withdrawal.
        </p>
        <div className="mt-8">
          <ConnectKitButton.Custom>
            {({ show, isConnecting }) => (
              <button className="btn-primary" onClick={show} disabled={isConnecting}>
                {isConnecting ? (
                  'Connecting...'
                ) : (
                  <>
                    Connect wallet <ArrowRight className="btn-arrow size-4" aria-hidden />
                  </>
                )}
              </button>
            )}
          </ConnectKitButton.Custom>
        </div>
      </div>
    </div>
  )
}

function TabContent({ tab }: { tab: Tab }) {
  if (tab === 'send') return <SendPrivate />
  if (tab === 'receive') return <Inbox />
  return (
    <div>
      <h2 className="font-display text-4xl font-light text-ink">Audit</h2>
      <p className="mb-6 mt-1 text-sm text-ink-2">Prove your payments to someone else, without giving up control.</p>
      <Disclosure />
    </div>
  )
}

function Panel({ tab }: { tab: Tab }) {
  const { isConnected, wrongChain } = useChainGuard()
  const { switchChain, isPending } = useSwitchChain()
  const { keys } = useShielded()

  if (!POOL_ADDRESS) {
    return <Notice tone="error">The pool is not configured. Set VITE_POOL_ADDRESS in .env and restart the app.</Notice>
  }
  if (!isConnected) return <Landing />

  return (
    <div className="flex flex-1 flex-col">
      {wrongChain && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warn bg-[var(--raised)] p-4">
          <p className="text-sm font-semibold text-ink">Your wallet is on another network.</p>
          <button className="btn-ghost" disabled={isPending} onClick={() => switchChain({ chainId: CHAIN_ID })}>
            Switch to {CHAIN_NAME}
          </button>
        </div>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={keys ? tab : 'locked'}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: DURATION.crossFade }}
          className="flex flex-1 flex-col"
        >
          {keys ? <TabContent tab={tab} /> : <UnlockCard />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function Shell() {
  const [tab, setTab] = useState<Tab>('send')
  const [touring, setTouring] = useState(false)
  const stage = useEntranceStage()

  // First visit only: start the tour once the entrance animation has settled.
  useEffect(() => {
    if (tourSeen()) return
    const t = setTimeout(() => setTouring(true), TIMING.tour)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="flex min-h-dvh flex-col gap-4 p-3 sm:p-4 lg:grid lg:grid-cols-[88px_320px_minmax(0,1fr)] lg:gap-10 lg:p-5">
        <div className="sticky top-3 z-20 lg:top-5 lg:h-[calc(100dvh-2.5rem)]">
          <Rail tab={tab} onChange={setTab} onHelp={() => setTouring(true)} />
        </div>

        <motion.aside
          className="order-3 px-2 pb-6 lg:order-none lg:px-0 lg:py-6"
          initial={{ opacity: 0, x: WALLETS.offsetX }}
          animate={stage >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: WALLETS.offsetX }}
          transition={WALLETS.spring}
        >
          <Wallets show={stage >= 2} />
        </motion.aside>

        <motion.main
          data-tour="panel"
          className="panel order-2 flex min-h-[560px] flex-col rounded-[28px] p-5 sm:p-7 lg:order-none lg:p-8"
          initial={{ opacity: 0, x: PANEL.offsetX }}
          animate={stage >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: PANEL.offsetX }}
          transition={PANEL.spring}
        >
          <Panel tab={tab} />
        </motion.main>
      </div>
      <Tour open={touring} onClose={() => setTouring(false)} onTab={setTab} />
    </div>
  )
}

export default function App() {
  return (
    <ShieldedProvider>
      <MotionConfig reducedMotion="user">
        <Shell />
      </MotionConfig>
    </ShieldedProvider>
  )
}
