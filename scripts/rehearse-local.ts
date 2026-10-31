/**
 * Local rehearsal of the PLONK pool on an anvil chain (run by scripts/rehearse-local.sh, under Node):
 * deposits, the app's own prover, and the real relayer code, for single and batch withdrawals,
 * plus a wallet-submitted batch and the attacks that must fail.
 *
 * Uses anvil's well-known development accounts. They exist only on the local chain.
 */
import { readFileSync } from 'node:fs'
import { bytesToHex, createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, parseAbi, zeroAddress, type Address } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { MULTICALL3, multicallAbi, poolAbi } from '../src/lib/pool'
import { KEY_DERIVATION_MESSAGE, decodeAddress, deriveKeys, toBytes32Hex } from '../src/lib/shielded-keys'
import { createNote } from '../src/lib/notes'
import { fetchDeposits, leavesFor, readOwnNotes } from '../src/lib/scan'
import { proveWithdraw, type ProvingFiles, type WithdrawProof } from '../src/lib/prover'
import { batchFee, createRelayer } from '../server/relay-core'

const RPC = 'http://127.0.0.1:8545'
// anvil development accounts #0 (sender) and #1 (relayer): public test keys, local chain only
const SENDER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const RELAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const MIN_FEE = 20000n
const EXTRA_FEE = 10000n

const record = JSON.parse(readFileSync('deployments/local.json', 'utf8')) as { usdc: Address; contracts: { ShieldedPool: { address: Address } } }
const POOL = record.contracts.ShieldedPool.address
const USDC = record.usdc

const client = createPublicClient({ chain: arcTestnet, transport: http(RPC) })
const sender = privateKeyToAccount(SENDER_KEY)
const wallet = createWalletClient({ account: sender, chain: arcTestnet, transport: http(RPC) })
const relayer = createRelayer({ key: RELAYER_KEY, pool: POOL, rpcUrl: RPC, minFee: MIN_FEE, extraFee: EXTRA_FEE })
const files: ProvingFiles = {
  wasm: { type: 'mem', data: new Uint8Array(readFileSync('public/zk/withdraw.wasm')) },
  zkey: { type: 'mem', data: new Uint8Array(readFileSync('build/zk/withdraw_plonk.zkey')) },
}

let failures = 0
const step = (msg: string) => console.log(`\n> ${msg}`)
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? '✓' : '✖'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}
const balanceOf = (a: Address) => client.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a] })
const mint = parseAbi(['function mint(address to, uint256 amount)'])
async function send(hash: `0x${string}`) {
  const r = await client.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`tx reverted ${hash}`)
  return r
}
async function rejects(fn: () => Promise<unknown>, expected: string) {
  try {
    await fn()
    return { ok: false, got: 'accepted' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: msg.includes(expected), got: msg.split('\n')[0] }
  }
}
/** Same split as the app: largest notes first, no note's fee above its value. */
function allocateFee(values: bigint[], total: bigint): bigint[] {
  const fees = values.map(() => 0n)
  let left = total
  for (const i of values.map((_, k) => k).sort((x, y) => (values[y] > values[x] ? 1 : -1))) {
    const take = left < values[i] ? left : values[i]
    fees[i] = take
    left -= take
  }
  return fees
}

const denoms = await client.readContract({ address: POOL, abi: poolAbi, functionName: 'getDenominations' })
console.log('pool', POOL, '| note sizes', denoms.map(String).join(', '))

step('Keys and funds')
const recipientKeys = deriveKeys(await privateKeyToAccount(generatePrivateKey()).signMessage({ message: KEY_DERIVATION_MESSAGE }))
const senderKeys = deriveKeys(await sender.signMessage({ message: KEY_DERIVATION_MESSAGE }))
await send(await wallet.writeContract({ address: USDC, abi: mint, functionName: 'mint', args: [sender.address, 1000_000000n] }))
await send(await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [POOL, 1000_000000n] }))
check('sender funded', (await balanceOf(sender.address)) >= 1000_000000n)

step('Sender pays 10 notes (4 x 0.10, 6 x 1) in one depositMany')
const decoded = decodeAddress(recipientKeys.address)!
const plan = [0, 0, 0, 0, 1, 1, 1, 1, 1, 1]
const notes = plan.map(() => createNote(decoded, senderKeys.viewPub, 'rehearsal'))
const dep = await send(
  await wallet.writeContract({
    address: POOL,
    abi: poolAbi,
    functionName: 'depositMany',
    args: [plan, notes.map((n) => toBytes32Hex(n.commitment)), notes.map((n) => bytesToHex(n.ephemeralPub)), notes.map((n) => bytesToHex(n.ciphertext))],
  }),
)
check('depositMany', dep.status === 'success', `gas ${dep.gasUsed}`)

step('Recipient scans and finds the notes')
let logs = await fetchDeposits(client, 0n)
let own = readOwnNotes(logs, recipientKeys).incoming
check('found 10 notes', own.length === 10, `found ${own.length}`)

const dest = privateKeyToAccount(generatePrivateKey()).address
const prove = (n: (typeof own)[number], fee: bigint, rel: Address = relayer.address, recipient: Address = dest) =>
  proveWithdraw({ keys: recipientKeys, secret: n.secret, leaves: leavesFor(logs, n.denomIndex), leafIndex: n.leafIndex, recipient, relayer: rel, fee }, files)
const body = (n: (typeof own)[number], p: WithdrawProof, fee: bigint) => ({
  denomIndex: n.denomIndex,
  proof: p.proof.map(String),
  root: p.root,
  nullifierHash: p.nullifierHash,
  fee: fee.toString(),
})

step('Single withdrawal through the relayer')
const single = own[0]
let t = Date.now()
const p0 = await prove(single, MIN_FEE)
console.log(`  proof generated in ${Date.now() - t} ms`)
const tamper = await rejects(() => relayer.relay({ ...body(single, p0, MIN_FEE), recipient: privateKeyToAccount(generatePrivateKey()).address }), 'InvalidProof')
check('changed recipient rejected', tamper.ok, tamper.got)
const feeTamper = await rejects(() => relayer.relay({ ...body(single, p0, MIN_FEE + 1n), recipient: dest }), 'InvalidProof')
check('changed fee rejected', feeTamper.ok, feeTamper.got)
let before = { dest: await balanceOf(dest), rel: await balanceOf(relayer.address) }
const h1 = await relayer.relay({ ...body(single, p0, MIN_FEE), recipient: dest })
const r1 = await client.getTransactionReceipt({ hash: h1 })
const value0 = denoms[single.denomIndex]
check('recipient got note minus fee', (await balanceOf(dest)) - before.dest === value0 - MIN_FEE)
check('relayer got its fee', (await balanceOf(relayer.address)) - before.rel === MIN_FEE, `gas ${r1.gasUsed}`)
const replay = await rejects(() => relayer.relay({ ...body(single, p0, MIN_FEE), recipient: dest }), 'NullifierAlreadySpent')
check('replay rejected', replay.ok, replay.got)

step('Withdraw all: 6 notes in one relayer batch')
const batch = own.slice(1, 7)
const values = batch.map((n) => denoms[n.denomIndex])
const total = batchFee(batch.length, MIN_FEE, EXTRA_FEE)
const fees = allocateFee(values, total)
t = Date.now()
const proofs: WithdrawProof[] = []
for (const [i, n] of batch.entries()) proofs.push(await prove(n, fees[i]))
console.log(`  6 proofs generated in ${Date.now() - t} ms`)
const lowFees = allocateFee(values, total - 1n)
const lowProofs = await Promise.all(batch.slice(0, 2).map((n, i) => prove(n, lowFees[i])))
const low = await rejects(() => relayer.relayMany({ recipient: dest, items: batch.slice(0, 2).map((n, i) => body(n, lowProofs[i], lowFees[i])) }), 'below the relayer minimum')
check('too-low batch fee rejected', low.ok, low.got)
before = { dest: await balanceOf(dest), rel: await balanceOf(relayer.address) }
const h2 = await relayer.relayMany({ recipient: dest, items: batch.map((n, i) => body(n, proofs[i], fees[i])) })
const r2 = await client.getTransactionReceipt({ hash: h2 })
const batchValue = values.reduce((a, b) => a + b, 0n)
check('one transaction for 6 notes', r2.status === 'success', `gas ${r2.gasUsed}`)
check('recipient got all notes minus one batch fee', (await balanceOf(dest)) - before.dest === batchValue - total, `fee ${total}`)
check('relayer got the batch fee', (await balanceOf(relayer.address)) - before.rel === total)
const replayBatch = await rejects(() => relayer.relayMany({ recipient: dest, items: batch.map((n, i) => body(n, proofs[i], fees[i])) }), 'NullifierAlreadySpent')
check('batch replay rejected', replayBatch.ok, replayBatch.got)

step('Withdraw all from the wallet: 3 notes through Multicall3, no relayer')
logs = await fetchDeposits(client, 0n)
own = readOwnNotes(logs, recipientKeys).incoming
const rest = own.slice(7)
const selfDest = privateKeyToAccount(generatePrivateKey()).address
const selfProofs = await Promise.all(rest.map((n) => prove(n, 0n, zeroAddress, selfDest)))
const calls = rest.map((n, i) => ({
  target: POOL,
  allowFailure: false,
  callData: encodeFunctionData({
    abi: poolAbi,
    functionName: 'withdraw',
    args: [n.denomIndex, selfProofs[i].proof, selfProofs[i].root, selfProofs[i].nullifierHash, selfDest, zeroAddress, 0n],
  }),
}))
const r3 = await send(await wallet.writeContract({ address: MULTICALL3, abi: multicallAbi, functionName: 'aggregate3', args: [calls] }))
const restValue = rest.reduce((s, n) => s + denoms[n.denomIndex], 0n)
check('wallet batch, full amount, one transaction', (await balanceOf(selfDest)) === restValue, `gas ${r3.gasUsed}`)

step('Pool accounting')
check('pool is empty again', (await balanceOf(POOL)) === 0n, `${await balanceOf(POOL)} left`)

console.log(failures === 0 ? '\nREHEARSAL PASSED\n' : `\nREHEARSAL FAILED: ${failures} check(s)\n`)
process.exit(failures === 0 ? 0 : 1)
