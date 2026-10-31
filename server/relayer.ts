/**
 * Withdrawal relayer for the shielded pool, as a Bun server for local development.
 * The deployed version is the Cloudflare Worker in worker/index.ts; both share server/relay-core.ts.
 *
 * Run with: bun run server/relayer.ts   (listens on RELAYER_PORT, default 3001)
 * After `bun run build` it also serves the built app from dist/.
 */
import { join, resolve, sep } from 'node:path'
import {
  DEFAULT_EXTRA_NOTE_FEE,
  DEFAULT_MIN_FEE,
  PUBLIC_RPC,
  createRateLimiter,
  createRelayer,
  handleRelay,
  handleRelayMany,
  json,
  proxyRpc,
  relayerInfo,
} from './relay-core'

const PORT = Number(process.env.PORT || process.env.RELAYER_PORT || 3001) // hosts set PORT
const POOL = process.env.VITE_POOL_ADDRESS as `0x${string}` | undefined
const KEY = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined
const MIN_FEE = process.env.RELAYER_MIN_FEE ? BigInt(process.env.RELAYER_MIN_FEE) : DEFAULT_MIN_FEE
const EXTRA_FEE = process.env.RELAYER_EXTRA_NOTE_FEE ? BigInt(process.env.RELAYER_EXTRA_NOTE_FEE) : DEFAULT_EXTRA_NOTE_FEE

if (!POOL || !KEY) {
  console.error('Missing VITE_POOL_ADDRESS or RELAYER_PRIVATE_KEY in .env')
  process.exit(1)
}

// Prefer the sandbox RPC proxy when it covers Arc Testnet; otherwise use the public RPC from onchain-facts.
const proxyChains = (process.env.RPC_PROXY_CHAINS || '').split(',')
const rpcUrl =
  process.env.RPC_PROXY_BASE_URL && proxyChains.indexOf('Arc_Testnet') !== -1
    ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
    : PUBLIC_RPC

const relayer = createRelayer({ key: KEY, pool: POOL, rpcUrl, minFee: MIN_FEE, extraFee: EXTRA_FEE })
const limited = createRateLimiter()

const DIST = resolve(import.meta.dir, '../dist')

async function staticFile(pathname: string): Promise<Response> {
  const path = resolve(DIST, '.' + decodeURIComponent(pathname))
  if (path.startsWith(DIST + sep)) {
    const file = Bun.file(path)
    if (await file.exists()) {
      // Vite fingerprints everything under assets/, so it can be cached forever.
      const cache = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
      return new Response(file, { headers: { 'cache-control': cache } })
    }
  }
  const index = Bun.file(join(DIST, 'index.html'))
  if (await index.exists()) return new Response(index, { headers: { 'cache-control': 'no-cache' } })
  return json({ error: 'Not found' }, 404)
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    // The app calls /api/*; the Vite dev proxy strips the prefix, so accept both forms.
    const route = url.pathname.replace(/^\/api(?=\/)/, '')

    if (req.method === 'POST' && url.pathname === '/rpc') return proxyRpc(req)

    if (req.method === 'GET' && route === '/info') return json(relayerInfo(relayer))

    if (req.method === 'POST' && (route === '/relay' || route === '/relay-many')) {
      if (limited(ip)) return json({ error: 'Too many requests. Try again in a minute.' }, 429)
      return route === '/relay' ? handleRelay(relayer, req) : handleRelayMany(relayer, req)
    }

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return staticFile(url.pathname)

    return json({ error: 'Not found' }, 404)
  },
})

console.log(`Relayer ${relayer.address} listening on :${PORT}`)
