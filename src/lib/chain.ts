import { defineChain } from 'viem'
import { requireChain } from '@/onchain-facts'

/**
 * The one chain this build talks to, from VITE_CHAIN_ID: 5042002 is Arc Testnet (the default),
 * 5042 is Arc mainnet. Everything else (RPC, explorer, USDC) comes from the onchain facts registry.
 */
const id = Number(import.meta.env.VITE_CHAIN_ID || 5042002)
const facts = requireChain(id)

export const APP_CHAIN = defineChain({
  id,
  name: facts.name,
  // The gas token is USDC with 18 decimals; the ERC-20 USDC has 6 (see onchain-facts).
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: facts.nativeCurrency.decimals },
  rpcUrls: { default: { http: facts.rpcUrls } },
  blockExplorers: { default: { name: `${facts.name} explorer`, url: facts.explorerBase } },
  testnet: facts.isTestnet,
})

/** Display name, e.g. "Arc Testnet" or "Arc". */
export const CHAIN_NAME = facts.name
export const IS_TESTNET = facts.isTestnet
