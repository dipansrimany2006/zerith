/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { APP_CHAIN } from './lib/chain'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(APP_CHAIN.id, APP_CHAIN.rpcUrls.default.http[0])

// Reach the RPC same-origin, so browser shields cannot block it: the Vite proxy serves /rpc in
// development and server/relayer.ts serves it in production.
const arcRpcUrl = `${window.location.origin}/rpc`

export const config = createConfig({
  chains: [APP_CHAIN, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [APP_CHAIN.id]: http(arcRpcUrl),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
