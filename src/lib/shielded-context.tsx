import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAccount, usePublicClient, useSignMessage } from 'wagmi'
import { CHAIN_ID, POOL_ADDRESS, POOL_DEPLOY_BLOCK, poolAbi } from '@/lib/pool'
import { computeNullifierHash, type IncomingNote, type OutgoingNote } from '@/lib/notes'
import { fetchDeposits, readOwnNotes, type DepositLog } from '@/lib/scan'
import {
  KEY_DERIVATION_MESSAGE,
  deriveKeys,
  toBytes32Hex,
  type ShieldedKeys,
} from '@/lib/shielded-keys'

export interface OwnedNote extends IncomingNote {
  nullifierHash: bigint
  spent: boolean
}

interface ShieldedState {
  keys: ShieldedKeys | null
  unlocking: boolean
  unlock: () => Promise<void>
  lock: () => void
  denominations: bigint[]
  logs: DepositLog[]
  incoming: OwnedNote[]
  outgoing: OutgoingNote[]
  refreshing: boolean
  loadedOnce: boolean
  error: string | null
  /** Syncs new deposits and returns every known Deposit log. */
  refresh: () => Promise<DepositLog[]>
}

const ShieldedContext = createContext<ShieldedState | null>(null)
const EMPTY_INCOMING: OwnedNote[] = []
const EMPTY_OUTGOING: OutgoingNote[] = []

export function ShieldedProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount()
  const client = usePublicClient({ chainId: CHAIN_ID })
  const { signMessageAsync } = useSignMessage()

  // Keys belong to one wallet: they are only visible while that wallet is still connected.
  const [keyState, setKeyState] = useState<{ owner: string | undefined; keys: ShieldedKeys } | null>(null)
  const keys = keyState && keyState.owner === address ? keyState.keys : null
  const [unlocking, setUnlocking] = useState(false)
  const [denominations, setDenominations] = useState<bigint[]>([])
  const [logs, setLogs] = useState<DepositLog[]>([])
  const [ownedNotes, setOwnedNotes] = useState<{ incoming: OwnedNote[]; outgoing: OutgoingNote[] }>({ incoming: [], outgoing: [] })
  const incoming = keys ? ownedNotes.incoming : EMPTY_INCOMING
  const outgoing = keys ? ownedNotes.outgoing : EMPTY_OUTGOING
  const [refreshing, setRefreshing] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Incremental log cache: only new blocks are fetched on each refresh.
  const cache = useRef<{ logs: DepositLog[]; nextBlock: bigint }>({ logs: [], nextBlock: POOL_DEPLOY_BLOCK })
  const busy = useRef(false)

  const unlock = useCallback(async () => {
    setUnlocking(true)
    try {
      const signature = await signMessageAsync({ message: KEY_DERIVATION_MESSAGE })
      setKeyState({ owner: address, keys: deriveKeys(signature) })
    } finally {
      setUnlocking(false)
    }
  }, [signMessageAsync, address])

  const lock = useCallback(() => {
    setKeyState(null)
    setOwnedNotes({ incoming: [], outgoing: [] })
  }, [])

  const refresh = useCallback(async (): Promise<DepositLog[]> => {
    const pool = POOL_ADDRESS
    if (!client || !pool || busy.current) return cache.current.logs
    busy.current = true
    setRefreshing(true)
    try {
      const head = await client.getBlockNumber()
      const fresh = await fetchDeposits(client, cache.current.nextBlock, head)
      cache.current = { logs: [...cache.current.logs, ...fresh], nextBlock: head + 1n }
      const allLogs = cache.current.logs

      const denoms = await client.readContract({
        address: pool,
        abi: poolAbi,
        functionName: 'getDenominations',
      })
      setDenominations([...denoms])
      setLogs(allLogs)

      if (keys) {
        const own = readOwnNotes(allLogs, keys)
        const owned = await Promise.all(
          own.incoming.map(async (note): Promise<OwnedNote> => {
            const nullifierHash = computeNullifierHash(keys.ownerPriv, note.commitment)
            const spent = await client.readContract({
              address: pool,
              abi: poolAbi,
              functionName: 'spent',
              args: [toBytes32Hex(nullifierHash)],
            })
            return { ...note, nullifierHash, spent }
          }),
        )
        setOwnedNotes({
          incoming: owned.sort((a, b) => b.timestamp - a.timestamp),
          outgoing: own.outgoing.sort((a, b) => b.timestamp - a.timestamp),
        })
      }
      setError(null)
      setLoadedOnce(true)
    } catch (err) {
      setError(err instanceof Error ? err.message.split('\n')[0] : 'Could not load the pool')
    } finally {
      busy.current = false
      setRefreshing(false)
    }
    return cache.current.logs
  }, [client, keys])

  // Load on mount and whenever keys change, then poll gently.
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0)
    const id = setInterval(() => void refresh(), 30_000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [refresh])

  const value = useMemo<ShieldedState>(
    () => ({
      keys,
      unlocking,
      unlock,
      lock,
      denominations,
      logs,
      incoming,
      outgoing,
      refreshing,
      loadedOnce,
      error,
      refresh,
    }),
    [keys, unlocking, unlock, lock, denominations, logs, incoming, outgoing, refreshing, loadedOnce, error, refresh],
  )

  return <ShieldedContext.Provider value={value}>{children}</ShieldedContext.Provider>
}

export function useShielded(): ShieldedState {
  const ctx = useContext(ShieldedContext)
  if (!ctx) throw new Error('useShielded must be used inside ShieldedProvider')
  return ctx
}

/** Incoming notes split by spent status, with the unspent total in base units. */
export function useShieldedBalance() {
  const { incoming, denominations } = useShielded()
  return useMemo(() => {
    const unspent = incoming.filter((n) => !n.spent)
    const spent = incoming.filter((n) => n.spent)
    const total = unspent.reduce((sum, n) => sum + (denominations[n.denomIndex] ?? 0n), 0n)
    return { unspent, spent, total }
  }, [incoming, denominations])
}
