import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ConnectKitButton } from 'connectkit'
import { erc20Abi } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { Wallet } from 'lucide-react'
import { ZerithMark } from '@/components/Logo'
import { CHAIN_ID, USDC_ADDRESS } from '@/lib/pool'
import { useShielded, useShieldedBalance } from '@/lib/shielded-context'
import { usdcNumber } from '@/lib/format'
import { SPRING, STAGGER } from '@/lib/motion'
import { AnimatedNumber, Badge, SectionLabel } from '@/components/ui'
import { PrivacyMeter } from '@/components/PrivacyMeter'

function ConnectPill() {
  return (
    <ConnectKitButton.Custom>
      {({ isConnected, isConnecting, show, truncatedAddress, ensName }) => (
        <motion.button
          type="button"
          onClick={show}
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.96 }}
          transition={SPRING.snappy}
          className="inline-flex min-h-10 items-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold text-canvas"
        >
          <span className={`size-2 rounded-full ${isConnected ? 'bg-success' : 'bg-muted'}`} aria-hidden />
          {isConnected ? (ensName ?? truncatedAddress) : isConnecting ? 'Connecting...' : 'Connect'}
        </motion.button>
      )}
    </ConnectKitButton.Custom>
  )
}

function WalletRow({
  index,
  show,
  icon,
  name,
  sub,
  amount,
  amountSub,
}: {
  index: number
  show: boolean
  icon: ReactNode
  name: string
  sub: string
  amount: ReactNode
  amountSub: string
}) {
  return (
    <motion.li
      initial={{ opacity: 0, x: -12 }}
      animate={show ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
      transition={{ ...SPRING.smooth, delay: index * STAGGER.normal }}
      className="row-hover group -mx-3 flex items-center gap-3 rounded-2xl px-3 py-3"
    >
      <span className="transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105">
        <Badge>{icon}</Badge>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{name}</p>
        <p className="text-[11px] text-ink-2">{sub}</p>
      </div>
      <div className="text-right">
        <p className="font-display text-lg leading-tight text-ink">{amount}</p>
        <p className="text-[11px] text-ink-2">{amountSub}</p>
      </div>
    </motion.li>
  )
}

const Dash = () => <span className="text-muted">—</span>
const Skeleton = () => <span className="skeleton inline-block h-4 w-14 align-middle" aria-label="Loading" />

/** Middle column: balances and pool size, laid out like the wallet list in the reference. */
export function Wallets({ show }: { show: boolean }) {
  const { address, isConnected } = useAccount()
  const { keys, loadedOnce } = useShielded()
  const { unspent, total: shielded } = useShieldedBalance()

  // Same query as the send form, so wagmi shares one cache entry and both update together.
  const { data: balance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  })

  const total = (balance ?? 0n) + (keys ? shielded : 0n)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-4xl font-light tracking-tight text-ink">Wallets</h1>
        <ConnectPill />
      </div>

      <div className="mt-8 flex items-end justify-between gap-3">
        <div>
          <p className="text-base font-medium text-ink">USDC</p>
          <p className="text-[11px] text-ink-2">Arc Testnet</p>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl text-ink">
            {!isConnected ? <Dash /> : balance === undefined ? <Skeleton /> : <>$ <AnimatedNumber value={usdcNumber(total)} /></>}
          </p>
          <p className="text-[11px] text-ink-2">Total balance</p>
        </div>
      </div>

      <ul className="mt-6">
        <WalletRow
          index={0}
          show={show}
          icon={<Wallet className="size-4" />}
          name="Public wallet"
          sub="Visible on chain"
          amount={!isConnected ? <Dash /> : balance === undefined ? <Skeleton /> : <AnimatedNumber value={usdcNumber(balance)} />}
          amountSub="USDC"
        />
        <WalletRow
          index={1}
          show={show}
          icon={<ZerithMark className="size-5" pupil="var(--canvas)" />}
          name="Zerith"
          sub={keys ? `${unspent.length} unspent note${unspent.length === 1 ? '' : 's'}` : 'Locked'}
          amount={!keys ? <Dash /> : !loadedOnce ? <Skeleton /> : <AnimatedNumber value={usdcNumber(shielded)} />}
          amountSub="USDC"
        />
      </ul>

      <div className="mt-8">
        <SectionLabel>Pool size</SectionLabel>
        <PrivacyMeter show={show} delay={0.12} />
        <p className="mt-4 text-[11px] leading-relaxed text-ink-2 text-pretty">
          A payment hides among every deposit of the same size. Amounts and times stay public; only the link between
          deposit and withdrawal is hidden.
        </p>
      </div>

      <p className="mt-auto pt-8 text-[11px] leading-relaxed text-ink-2">
        Testnet only and unaudited, with a development proof setup. Do not use real funds.
      </p>
    </div>
  )
}
