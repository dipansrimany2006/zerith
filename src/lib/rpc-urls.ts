import { getChain } from '../onchain-facts'

/**
 * Extra public RPCs per chain, tried after the registry's own. Arc's public mainnet RPC rate-limits the
 * shared Cloudflare IPs the Worker calls from, so the Worker and the browser rotate through these.
 * Each one was checked for CORS and for eth_getLogs over 10,000 blocks (dRPC's free plan fails that).
 */
const EXTRA_RPCS: Record<number, string[]> = {
  5042: ['https://rpc.quicknode.mainnet.arc.io', 'https://rpc.blockdaemon.mainnet.arc.io'],
}

/** Public RPCs for a chain, in the order to try them. Relative import so the Worker can use it too. */
export function publicRpcs(chainId: number): string[] {
  const facts = getChain(chainId)
  if (!facts) throw new Error(`Chain ${chainId} is not in the onchain facts registry`)
  return [...facts.rpcUrls, ...(EXTRA_RPCS[chainId] ?? [])]
}
