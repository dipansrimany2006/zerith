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
  decodeErrorResult,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { defineChain } from 'viem'
import { getChain } from '../src/onchain-facts'

export const DEFAULT_CHAIN_ID = 5042002 // Arc Testnet; Arc mainnet is 5042

/** Public RPC for a chain in the onchain facts registry. */
export function publicRpc(chainId: number): string {
  const facts = getChain(chainId)
  if (!facts) throw new Error(`Chain ${chainId} is not in the onchain facts registry`)
  return facts.rpcUrls[0]
}

function chainFor(chainId: number, rpcUrl: string) {
  const facts = getChain(chainId)
  return defineChain({
    id: chainId,
    name: facts?.name ?? `Chain ${chainId}`,
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  })
}

export const DEFAULT_MIN_FEE = 20000n // 0.02 USDC (6 decimals); covers the gas of one withdrawal
/** Each extra note in a batch adds about 0.33M gas, roughly 0.009 USDC at 25 gwei; 0.01 covers it. */
export const DEFAULT_EXTRA_NOTE_FEE = 10000n

/** Notes per batch transaction: about 6.5M gas with PLONK (0.32M per note), well under Arc's 30M block limit. */
export const MAX_BATCH_WITHDRAW = 20

/** Multicall3, deployed at the same address on most EVM chains, including Arc. */
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

const multicallAbi = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
])

/** Fee for one batch of `count` notes: the base fee plus a per-note extra for each note after the first. */
export function batchFee(count: number, minFee: bigint, extraFee: bigint): bigint {
  return minFee + extraFee * BigInt(Math.max(0, count - 1))
}

const abi = parseAbi([
  'function withdraw(uint8 denomIndex, uint256[24] proof, bytes32 root, bytes32 nullifierHash, address recipient, address relayer, uint256 fee)',
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

/**
 * Simple per-client rate limit: `limit` requests per minute. High enough for "Withdraw all", which
 * sends one request per note; the app waits and retries when it is hit.
 */
export function createRateLimiter(limit = 30) {
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
  chainId?: number
  minFee: bigint
  extraFee?: bigint
}

type Tuple<T, N extends number, R extends readonly T[] = readonly []> = R['length'] extends N ? R : Tuple<T, N, readonly [T, ...R]>
/** PLONK proof: the 24 words the on-chain verifier takes. */
type ProofWords = Tuple<bigint, 24>

/** Validates one proof's fields from a request body. */
function parseProof(item: Record<string, unknown>) {
  const denomIndex = Number(item.denomIndex)
  if (!Number.isInteger(denomIndex) || denomIndex < 0 || denomIndex > 7) throw new Error('Invalid denomination')
  if (!Array.isArray(item.proof) || item.proof.length !== 24) throw new Error('Malformed proof')
  const proof = (item.proof as unknown[]).map(big) as unknown as ProofWords
  return { denomIndex, proof, root: hex32(item.root), nullifierHash: hex32(item.nullifierHash), fee: big(item.fee) }
}

export function createRelayer({ key, pool, rpcUrl, chainId = DEFAULT_CHAIN_ID, minFee, extraFee = DEFAULT_EXTRA_NOTE_FEE }: RelayerOptions) {
  const chain = chainFor(chainId, rpcUrl)
  const account = privateKeyToAccount(key)
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) })
  const enqueue = createQueue()

  async function relay(body: Record<string, unknown>): Promise<`0x${string}`> {
    if (typeof body.recipient !== 'string' || !isAddress(body.recipient)) throw new Error('Invalid recipient')
    const recipient = getAddress(body.recipient)
    const { denomIndex, proof, root, nullifierHash, fee } = parseProof(body)
    if (fee < minFee) throw new Error(`Fee is below the relayer minimum of ${minFee} base units`)
    const args = [denomIndex, proof, root, nullifierHash, recipient, account.address, fee] as const

    // Dry run first: an invalid proof, spent note or unknown root is rejected before any gas is spent.
    await publicClient.simulateContract({ address: pool, abi, functionName: 'withdraw', args, account })

    return enqueue(async () => {
      const hash = await walletClient.writeContract({ address: pool, abi, functionName: 'withdraw', args })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('Withdrawal transaction reverted')
      return hash
    })
  }

  /**
   * Withdraws several notes to one recipient in a single atomic transaction through Multicall3.
   * Each proof binds this relayer; together their fees must cover the batch fee.
   */
  async function relayMany(body: Record<string, unknown>): Promise<`0x${string}`> {
    if (typeof body.recipient !== 'string' || !isAddress(body.recipient)) throw new Error('Invalid recipient')
    const recipient = getAddress(body.recipient)
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_BATCH_WITHDRAW) {
      throw new Error(`Send between 1 and ${MAX_BATCH_WITHDRAW} notes per batch`)
    }
    const items = (body.items as Record<string, unknown>[]).map(parseProof)
    const nullifiers = new Set(items.map((i) => i.nullifierHash))
    if (nullifiers.size !== items.length) throw new Error('The same note appears twice')
    const totalFee = items.reduce((sum, i) => sum + i.fee, 0n)
    const required = batchFee(items.length, minFee, extraFee)
    if (totalFee < required) throw new Error(`Fee is below the relayer minimum of ${required} base units for ${items.length} notes`)

    const calls = items.map((i) => ({
      target: pool,
      allowFailure: false,
      callData: encodeFunctionData({
        abi,
        functionName: 'withdraw',
        args: [i.denomIndex, i.proof, i.root, i.nullifierHash, recipient, account.address, i.fee],
      }),
    }))

    // Dry run first: any bad proof, spent note or unknown root is caught before gas is spent.
    // Multicall3 hides the inner error when a call fails, so the dry run lets every call report
    // its own result and decodes the first failure with the pool ABI.
    const { result } = await publicClient.simulateContract({
      address: MULTICALL3,
      abi: multicallAbi,
      functionName: 'aggregate3',
      args: [calls.map((call) => ({ ...call, allowFailure: true }))],
      account,
    })
    const failed = result.findIndex((r) => !r.success)
    if (failed !== -1) throw new Error(poolErrorName(result[failed].returnData) ?? 'Withdrawal reverted')

    return enqueue(async () => {
      const hash = await walletClient.writeContract({ address: MULTICALL3, abi: multicallAbi, functionName: 'aggregate3', args: [calls] })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('Withdrawal transaction reverted')
      return hash
    })
  }

  /** Names the pool error in one call's revert data. */
  function poolErrorName(data: `0x${string}`): string | null {
    try {
      return decodeErrorResult({ abi, data }).errorName
    } catch {
      return null
    }
  }

  return { address: account.address, minFee, extraFee, pool, relay, relayMany }
}

/** Handles POST /relay-many: size limit, parse, relay the batch, and a JSON answer. */
export async function handleRelayMany(relayer: ReturnType<typeof createRelayer>, req: Request): Promise<Response> {
  const text = await req.text()
  if (text.length > 60_000) return json({ error: 'Request too large' }, 413)
  try {
    const txHash = await relayer.relayMany(JSON.parse(text) as Record<string, unknown>)
    return json({ txHash })
  } catch (err) {
    return json({ error: describeError(err) }, 400)
  }
}

/** Public relayer terms, served at GET /info. */
export function relayerInfo(relayer: ReturnType<typeof createRelayer>) {
  return {
    relayer: relayer.address,
    minFee: relayer.minFee.toString(),
    extraFee: relayer.extraFee.toString(),
    maxBatch: MAX_BATCH_WITHDRAW,
    pool: relayer.pool,
  }
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
export async function proxyRpc(req: Request, rpcUrl: string): Promise<Response> {
  const text = await req.text()
  if (text.length > 100_000) return json({ error: 'Request too large' }, 413)
  const upstream = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: text,
  })
  return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': 'application/json' } })
}
