/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig, fallback } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { APP_CHAIN } from './lib/chain'
import { publicRpcs } from './lib/rpc-urls'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(APP_CHAIN.id, APP_CHAIN.rpcUrls.default.http[0])

// The public RPCs first, straight from the browser, so each user has their own rate limit (the Worker's
// shared IPs get throttled). Last, the same-origin /rpc proxy (Vite in development, the Worker in
// production), for when browser shields block the public ones.
const arcRpcUrl = `${window.location.origin}/rpc`
const arcTransport = fallback([
  ...publicRpcs(APP_CHAIN.id).map((url) => http(url, { retryCount: 0 })),
  http(arcRpcUrl),
])

export const config = createConfig({
  chains: [APP_CHAIN, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [APP_CHAIN.id]: arcTransport,
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
