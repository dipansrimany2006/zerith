/**
 * One-time helper: records the deployed pool address and deployment block in .env,
 * and creates a relayer key if none exists. Prints only public values.
 * Usage: bun run scripts/setup-env.ts <poolAddress> <deployTxHash>
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { createPublicClient, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'

const [poolAddress, txHash] = process.argv.slice(2)
if (!poolAddress || !txHash) throw new Error('Usage: setup-env.ts <poolAddress> <deployTxHash>')

const envPath = new URL('../.env', import.meta.url).pathname
const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
const has = (key: string) => new RegExp(`^${key}=`, 'm').test(current)

const client = createPublicClient({ chain: arcTestnet, transport: http(arcTestnet.rpcUrls.default.http[0]) })
const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` })

const lines: string[] = []
if (!has('VITE_POOL_ADDRESS')) lines.push(`VITE_POOL_ADDRESS=${poolAddress}`)
if (!has('VITE_POOL_DEPLOY_BLOCK')) lines.push(`VITE_POOL_DEPLOY_BLOCK=${receipt.blockNumber}`)
let relayerKey = ''
if (!has('RELAYER_PRIVATE_KEY')) {
  relayerKey = generatePrivateKey()
  lines.push(`RELAYER_PRIVATE_KEY=${relayerKey}`)
}
if (lines.length) appendFileSync(envPath, `${current.endsWith('\n') || !current ? '' : '\n'}${lines.join('\n')}\n`)

const envKey = relayerKey || /^RELAYER_PRIVATE_KEY=(.*)$/m.exec(current)?.[1] || ''
console.log('deploy block:', receipt.blockNumber.toString())
console.log('relayer address:', envKey ? privateKeyToAccount(envKey as `0x${string}`).address : 'n/a')
