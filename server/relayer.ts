/**
 * Withdrawal relayer for the shielded pool.
 * Submits withdrawals on behalf of recipients so they need no gas, and keeps the fee the proof binds.
 * It cannot change the recipient, relayer or fee: they are public inputs of the zero-knowledge proof.
 *
 * Run with: bun run server/relayer.ts   (listens on RELAYER_PORT, default 3001)
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { getChain } from '../src/onchain-facts'

const PORT = Number(process.env.RELAYER_PORT || 3001)
const POOL = process.env.VITE_POOL_ADDRESS as `0x${string}` | undefined
const KEY = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined
const MIN_FEE = BigInt(process.env.RELAYER_MIN_FEE || '20000') // 0.02 USDC (6 decimals); covers the gas of one withdrawal

if (!POOL || !KEY) {
  console.error('Missing VITE_POOL_ADDRESS or RELAYER_PRIVATE_KEY in .env')
  process.exit(1)
}

// Prefer the sandbox RPC proxy when it covers Arc Testnet; otherwise use the public RPC from onchain-facts.
const proxyChains = (process.env.RPC_PROXY_CHAINS || '').split(',')
const rpcUrl =
  process.env.RPC_PROXY_BASE_URL && proxyChains.indexOf('Arc_Testnet') !== -1
    ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
    : (getChain(arcTestnet.id)?.rpcUrls[0] ?? arcTestnet.rpcUrls.default.http[0])

const account = privateKeyToAccount(KEY)
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) })
const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(rpcUrl) })

const abi = parseAbi([
  'function withdraw(uint8 denomIndex, uint256[2] a, uint256[2][2] b, uint256[2] c, bytes32 root, bytes32 nullifierHash, address recipient, address relayer, uint256 fee)',
  'function getDenominations() view returns (uint256[])',
  'error InvalidProof()',
  'error NullifierAlreadySpent()',
  'error UnknownRoot()',
  'error FeeExceedsDenomination()',
  'error InvalidRecipient()',
  'error InvalidRelayer()',
  'error InvalidDenominationIndex()',
  'error NullifierNotInField()',
  'error RootNotInField()',
])

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Simple per-client rate limit: 10 requests per minute.
const hits = new Map<string, number[]>()
function limited(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > 10
}

// Submissions are serialized so the relayer nonce never collides.
let queue: Promise<unknown> = Promise.resolve()
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

/** Reduces a viem error to a short, stable code the app can translate. */
function describeError(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.data?.errorName ?? reverted.reason ?? 'Withdrawal reverted'
    }
    return err.shortMessage
  }
  return err instanceof Error ? err.message.split('\n')[0] : 'Withdrawal failed'
}

const big = (v: unknown): bigint => {
  if (typeof v !== 'string' || !/^\d{1,80}$/.test(v)) throw new Error('Invalid number')
  return BigInt(v)
}
const hex32 = (v: unknown): `0x${string}` => {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error('Invalid bytes32')
  return v as `0x${string}`
}

async function relay(body: Record<string, unknown>) {
  const denomIndex = Number(body.denomIndex)
  if (!Number.isInteger(denomIndex) || denomIndex < 0 || denomIndex > 7) throw new Error('Invalid denomination')
  if (typeof body.recipient !== 'string' || !isAddress(body.recipient)) throw new Error('Invalid recipient')
  const recipient = getAddress(body.recipient)
  const fee = big(body.fee)
  if (fee < MIN_FEE) throw new Error(`Fee is below the relayer minimum of ${MIN_FEE} base units`)

  const a = (body.a as unknown[]).map(big) as [bigint, bigint]
  const b = (body.b as unknown[][]).map((row) => row.map(big)) as [[bigint, bigint], [bigint, bigint]]
  const c = (body.c as unknown[]).map(big) as [bigint, bigint]
  if (a.length !== 2 || c.length !== 2 || b.length !== 2 || b[0].length !== 2 || b[1].length !== 2) {
    throw new Error('Malformed proof')
  }
  const root = hex32(body.root)
  const nullifierHash = hex32(body.nullifierHash)
  const args = [denomIndex, a, b, c, root, nullifierHash, recipient, account.address, fee] as const

  // Dry run first: an invalid proof, spent note or unknown root is rejected before any gas is spent.
  await publicClient.simulateContract({ address: POOL!, abi, functionName: 'withdraw', args, account })

  return enqueue(async () => {
    const hash = await walletClient.writeContract({ address: POOL!, abi, functionName: 'withdraw', args })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error('Withdrawal transaction reverted')
    return hash
  })
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'

    if (req.method === 'GET' && url.pathname === '/info') {
      return json({ relayer: account.address, minFee: MIN_FEE.toString(), pool: POOL })
    }

    if (req.method === 'POST' && url.pathname === '/relay') {
      if (limited(ip)) return json({ error: 'Too many requests. Try again in a minute.' }, 429)
      const text = await req.text()
      if (text.length > 8_000) return json({ error: 'Request too large' }, 413)
      try {
        const txHash = await relay(JSON.parse(text) as Record<string, unknown>)
        return json({ txHash })
      } catch (err) {
        return json({ error: describeError(err) }, 400)
      }
    }

    return json({ error: 'Not found' }, 404)
  },
})

console.log(`Relayer ${account.address} listening on :${PORT}`)
