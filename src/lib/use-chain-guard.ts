import { useCallback } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { CHAIN_ID } from '@/lib/pool'

/** Wallet connection and Arc Testnet check shared by every action that sends a transaction. */
export function useChainGuard() {
  const { address, chainId, isConnected } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const wrongChain = isConnected && chainId !== CHAIN_ID

  const ensureChain = useCallback(async () => {
    if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
  }, [chainId, switchChainAsync])

  return { address, isConnected, wrongChain, ensureChain }
}
