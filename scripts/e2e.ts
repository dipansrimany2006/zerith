/**
 * End-to-end check against Arc Testnet:
 *   sender deposits one note for a recipient -> recipient scans, proves, relayer withdraws to a fresh address.
 * Needs: the relayer running (bun run relayer), and E2E_SENDER_KEY funded with testnet USDC.
 * Usage: E2E_SENDER_KEY=0x... bun run scripts/e2e.ts
 */
import { bytesToHex, createPublicClient, createWalletClient, erc20Abi, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { POOL_ADDRESS, USDC_ADDRESS, poolAbi } from '../src/lib/pool'
import { KEY_DERIVATION_MESSAGE, decodeAddress, deriveKeys, toBytes32Hex } from '../src/lib/shielded-keys'
import { createNote } from '../src/lib/notes'
import { fetchDeposits, leavesFor, readOwnNotes } from '../src/lib/scan'
import { proveWithdraw } from '../src/lib/prover'

const senderKey = process.env.E2E_SENDER_KEY as `0x${string}` | undefined
if (!senderKey || !POOL_ADDRESS) throw new Error('Set E2E_SENDER_KEY and VITE_POOL_ADDRESS')

const rpc = arcTestnet.rpcUrls.default.http[0]
const client = createPublicClient({ chain: arcTestnet, transport: http(rpc) })
const sender = privateKeyToAccount(senderKey)
const wallet = createWalletClient({ account: sender, chain: arcTestnet, transport: http(rpc) })

const step = (msg: string) => console.log(`\n> ${msg}`)
const balanceOf = (a: `0x${string}`) =>
  client.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [a] })

// Keys: sender and recipient each sign the derivation message with their own wallet.
const recipientWallet = privateKeyToAccount(generatePrivateKey())
const senderKeys = deriveKeys(await sender.signMessage({ message: KEY_DERIVATION_MESSAGE }))
const recipientKeys = deriveKeys(await recipientWallet.signMessage({ message: KEY_DERIVATION_MESSAGE }))
const destination = privateKeyToAccount(generatePrivateKey()).address // fresh, empty address

const denominations = await client.readContract({ address: POOL_ADDRESS, abi: poolAbi, functionName: 'getDenominations' })
const denomIndex = 0
const amount = denominations[denomIndex]
console.log('denominations:', denominations.map(String).join(', '), '| withdrawing index', denomIndex, '=', amount.toString())

step('Sender approves and deposits TWO notes (0.10 and 1 USDC) in ONE depositMany transaction')
const decoded = decodeAddress(recipientKeys.address)
if (!decoded) throw new Error('bad address')
const batchIndexes = [0, 1]
const total = batchIndexes.reduce((sum, i) => sum + denominations[i], 0n)
const batchNotes = batchIndexes.map(() => createNote(decoded, senderKeys.viewPub, 'e2e test payment'))
const note = batchNotes[0]
const approveHash = await wallet.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [POOL_ADDRESS, total] })
await client.waitForTransactionReceipt({ hash: approveHash })
const hex = (b: Uint8Array) => `0x${Buffer.from(b).toString('hex')}`
const poolBefore = await balanceOf(POOL_ADDRESS)
const depositHash = await wallet.writeContract({
  address: POOL_ADDRESS,
  abi: poolAbi,
  functionName: 'depositMany',
  args: [batchIndexes, batchNotes.map((n) => toBytes32Hex(n.commitment)), batchNotes.map((n) => bytesToHex(n.ephemeralPub)), batchNotes.map((n) => bytesToHex(n.ciphertext))],
})
const depositReceipt = await client.waitForTransactionReceipt({ hash: depositHash })
console.log('depositMany status:', depositReceipt.status, 'gas used:', depositReceipt.gasUsed.toString())
console.log('pool received:', ((await balanceOf(POOL_ADDRESS)) - poolBefore).toString(), '(expected', total.toString() + ')')

step('Recipient scans the pool and finds the note')
const logs = await fetchDeposits(client)
const recipientNotes = readOwnNotes(logs, recipientKeys)
const senderNotes = readOwnNotes(logs, senderKeys)
const mine = recipientNotes.incoming.find((n) => n.commitment === note.commitment)
if (!mine) throw new Error('Recipient could not find the note')
console.log('recipient found note with memo:', JSON.stringify(mine.memo))
console.log('sender sent-history entries:', senderNotes.outgoing.length, '| sender incoming (expect 0 for this note):', senderNotes.incoming.filter((n) => n.commitment === note.commitment).length)

step('Recipient generates the proof')
const info = (await fetch('http://localhost:3001/info').then((r) => r.json())) as { relayer: `0x${string}`; minFee: string }
const fee = BigInt(info.minFee)
const leaves = leavesFor(logs, denomIndex)
const t0 = Date.now()
const proof = await proveWithdraw(
  { keys: recipientKeys, secret: mine.secret, leaves, leafIndex: mine.leafIndex, recipient: destination, relayer: info.relayer, fee },
  { wasm: 'public/zk/withdraw.wasm', zkey: 'public/zk/withdraw_final.zkey' },
)
console.log('proof generated in', Date.now() - t0, 'ms')

const before = { dest: await balanceOf(destination), relayer: await balanceOf(info.relayer) }
const body = {
  denomIndex,
  a: proof.a.map(String),
  b: proof.b.map((r) => r.map(String)),
  c: proof.c.map(String),
  root: proof.root,
  nullifierHash: proof.nullifierHash,
  recipient: destination,
  fee: fee.toString(),
}

step('Tampered request (different recipient) must be rejected')
const tampered = await fetch('http://localhost:3001/relay', {
  method: 'POST',
  body: JSON.stringify({ ...body, recipient: privateKeyToAccount(generatePrivateKey()).address }),
}).then((r) => r.json() as Promise<unknown>)
console.log('tampered ->', JSON.stringify(tampered))

step('Relayer submits the real withdrawal')
const result = (await fetch('http://localhost:3001/relay', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json())) as { txHash?: string; error?: string }
console.log('relay ->', JSON.stringify(result))

const after = { dest: await balanceOf(destination), relayer: await balanceOf(info.relayer) }
console.log('destination received:', (after.dest - before.dest).toString(), '(expected', (amount - fee).toString() + ')')
console.log('relayer fee received:', (after.relayer - before.relayer).toString(), '(expected', fee.toString() + ')')

step('Replaying the same proof must be rejected')
const replay = await fetch('http://localhost:3001/relay', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json() as Promise<unknown>)
console.log('replay ->', JSON.stringify(replay))

const ok = !!result.txHash && after.dest - before.dest === amount - fee
console.log(ok ? '\nE2E PASS' : '\nE2E FAIL')
process.exit(ok ? 0 : 1)
