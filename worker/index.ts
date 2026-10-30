/**
 * Cloudflare Worker: serves the built app (dist/, via the ASSETS binding), proxies the Arc RPC at /rpc,
 * and runs the withdrawal relayer at /api/*.
 *
 * Every relay request goes through one Durable Object instance. Worker isolates do not share memory,
 * so this is what keeps withdrawals in order (no nonce collisions) and the rate limit global.
 */
import { DurableObject } from 'cloudflare:workers'
import { DEFAULT_MIN_FEE, PUBLIC_RPC, createRateLimiter, createRelayer, handleRelay, json, proxyRpc } from '../server/relay-core'

interface Env {
  ASSETS: Fetcher
  RELAYER: DurableObjectNamespace<Relayer>
  POOL_ADDRESS: `0x${string}`
  RELAYER_PRIVATE_KEY: `0x${string}`
  RELAYER_MIN_FEE?: string
}

export class Relayer extends DurableObject<Env> {
  private relayer = createRelayer({
    key: this.env.RELAYER_PRIVATE_KEY,
    pool: this.env.POOL_ADDRESS,
    rpcUrl: PUBLIC_RPC,
    minFee: this.env.RELAYER_MIN_FEE ? BigInt(this.env.RELAYER_MIN_FEE) : DEFAULT_MIN_FEE,
  })
  private limited = createRateLimiter()

  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url)

    if (req.method === 'GET' && pathname === '/api/info') {
      return json({ relayer: this.relayer.address, minFee: this.relayer.minFee.toString(), pool: this.relayer.pool })
    }

    if (req.method === 'POST' && pathname === '/api/relay') {
      const ip = req.headers.get('cf-connecting-ip') || 'unknown'
      if (this.limited(ip)) return json({ error: 'Too many requests. Try again in a minute.' }, 429)
      return handleRelay(this.relayer, req)
    }

    return json({ error: 'Not found' }, 404)
  }
}

export default {
  async fetch(req, env): Promise<Response> {
    const { pathname } = new URL(req.url)

    if (pathname === '/rpc') {
      return req.method === 'POST' ? proxyRpc(req) : json({ error: 'Method not allowed' }, 405)
    }

    if (pathname.startsWith('/api/')) {
      if (!env.RELAYER_PRIVATE_KEY) return json({ error: 'Relayer is not configured' }, 503)
      return env.RELAYER.get(env.RELAYER.idFromName('relayer')).fetch(req)
    }

    return env.ASSETS.fetch(req)
  },
} satisfies ExportedHandler<Env>
