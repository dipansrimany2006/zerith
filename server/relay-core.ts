/**
 * Relay logic shared by the Bun server (server/relayer.ts) and the Cloudflare Worker (worker/index.ts).
 * Submits withdrawals on behalf of recipients so they need no gas, and keeps the fee the proof binds.
 * It cannot change the recipient, relayer or fee: they are public inputs of the zero-knowledge proof.
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

export const PUBLIC_RPC = getChain(arcTestnet.id)?.rpcUrls[0] ?? arcTestnet.rpcUrls.default.http[0]

export const DEFAULT_MIN_FEE = 20000n // 0.02 USDC (6 decimals); covers the gas of one withdrawal

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

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Simple per-client rate limit: `limit` requests per minute. */
export function createRateLimiter(limit = 10) {
  const hits = new Map<string, number[]>()
  return (ip: string): boolean => {
    const now = Date.now()
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
    recent.push(now)
    hits.set(ip, recent)
    return recent.length > limit
  }
}

/** Runs tasks one at a time, so the relayer nonce never collides. */
export function createQueue() {
  let queue: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }
}

/** Reduces a viem error to a short, stable code the app can translate. */
export function describeError(err: unknown): string {
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

export interface RelayerOptions {
  key: `0x${string}`
  pool: `0x${string}`
  rpcUrl: string
  minFee: bigint
}

export function createRelayer({ key, pool, rpcUrl, minFee }: RelayerOptions) {
  const account = privateKeyToAccount(key)
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) })
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(rpcUrl) })
  const enqueue = createQueue()

  async function relay(body: Record<string, unknown>): Promise<`0x${string}`> {
    const denomIndex = Number(body.denomIndex)
    if (!Number.isInteger(denomIndex) || denomIndex < 0 || denomIndex > 7) throw new Error('Invalid denomination')
    if (typeof body.recipient !== 'string' || !isAddress(body.recipient)) throw new Error('Invalid recipient')
    const recipient = getAddress(body.recipient)
    const fee = big(body.fee)
    if (fee < minFee) throw new Error(`Fee is below the relayer minimum of ${minFee} base units`)

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
    await publicClient.simulateContract({ address: pool, abi, functionName: 'withdraw', args, account })

    return enqueue(async () => {
      const hash = await walletClient.writeContract({ address: pool, abi, functionName: 'withdraw', args })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('Withdrawal transaction reverted')
      return hash
    })
  }

  return { address: account.address, minFee, pool, relay }
}

/** Handles POST /relay: size limit, parse, relay, and a JSON answer. */
export async function handleRelay(relayer: ReturnType<typeof createRelayer>, req: Request): Promise<Response> {
  const text = await req.text()
  if (text.length > 8_000) return json({ error: 'Request too large' }, 413)
  try {
    const txHash = await relayer.relay(JSON.parse(text) as Record<string, unknown>)
    return json({ txHash })
  } catch (err) {
    return json({ error: describeError(err) }, 400)
  }
}

/** Forwards a JSON-RPC request to the public Arc RPC, so the browser reaches it same-origin. */
export async function proxyRpc(req: Request): Promise<Response> {
  const text = await req.text()
  if (text.length > 100_000) return json({ error: 'Request too large' }, 413)
  const upstream = await fetch(PUBLIC_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: text,
  })
  return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': 'application/json' } })
}
