/**
 * Deploys the Zerith pool: PoseidonT3 hasher, PLONK verifier, then ShieldedPool, from your own wallet.
 *
 *   DEPLOYER_PRIVATE_KEY=0x... bun run scripts/deploy-pool.ts --network testnet --denoms 0.1,1,10
 *   DEPLOYER_PRIVATE_KEY=0x... bun run scripts/deploy-pool.ts --network mainnet --denoms 0.1,1,10 --dry-run
 *
 * Options
 *   --network   testnet | mainnet | local            (required)
 *   --denoms    note sizes in USDC, comma separated  (required; fixed forever once deployed, 1 to 8 values)
 *   --owner     pool owner, who can pause deposits   (default: the deployer wallet)
 *   --rpc       RPC URL override                      (local defaults to http://127.0.0.1:8545)
 *   --usdc      USDC address override                 (local only, e.g. a mock token)
 *   --dry-run   run every check and print the plan, but send nothing
 *
 * The key is read from DEPLOYER_PRIVATE_KEY and is never printed or written anywhere. Prefer passing it
 * for one command only (e.g. `read -s` then export in the same shell) over saving it in a file.
 *
 * Before running: `forge build`, and `bun run zk:setup -- --check` so the PLONK verifier and its test
 * vector exist. The script refuses to deploy a verifier that does not accept that vector.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseUnits,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getChain } from '../src/onchain-facts'

const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11'
const NETWORKS = { testnet: 5042002, mainnet: 5042, local: 5042002 } as const
type Network = keyof typeof NETWORKS

// ---------- arguments ----------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const flag = (name: string) => process.argv.includes(`--${name}`)

function fail(message: string): never {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}

const network = arg('network') as Network | undefined
if (!network || !(network in NETWORKS)) fail('Pass --network testnet, mainnet or local')
const dryRun = flag('dry-run')

const denomText = arg('denoms') ?? fail('Pass --denoms, for example --denoms 0.1,1,10')
const denoms = denomText.split(',').map((d) => parseUnits(d.trim(), 6))
if (denoms.length < 1 || denoms.length > 8) fail('Use 1 to 8 note sizes')
if (new Set(denoms).size !== denoms.length || denoms.some((d) => d <= 0n)) fail('Note sizes must be distinct and above zero')

const rawKey = process.env.DEPLOYER_PRIVATE_KEY
if (!rawKey || !/^0x[0-9a-fA-F]{64}$/.test(rawKey)) fail('Set DEPLOYER_PRIVATE_KEY to your deployer key (0x followed by 64 hex characters)')
const account = privateKeyToAccount(rawKey as Hex)

// ---------- chain ----------

const chainId = NETWORKS[network]
const facts = getChain(chainId)
if (!facts && network !== 'local') fail(`Chain ${chainId} is not in src/onchain-facts.ts`)
const rpcUrl = arg('rpc') ?? (network === 'local' ? 'http://127.0.0.1:8545' : facts!.rpcUrls[0])
const usdcOverride = arg('usdc')
if (usdcOverride && network !== 'local') fail('--usdc is only for --network local; real networks use the registered USDC')
const usdc = getAddress(network === 'local' ? (usdcOverride ?? fail('Pass --usdc for --network local')) : facts!.usdc!.address)
const ownerArg = arg('owner')
if (ownerArg && !isAddress(ownerArg)) fail('--owner is not a valid address')
const owner = getAddress(ownerArg ?? account.address)
const explorer = network === 'local' ? null : facts!.explorerBase

const chain = defineChain({
  id: chainId,
  name: facts?.name ?? 'Local Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
})
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) })

// ---------- artifacts ----------

function artifact(file: string, name: string): { abi: unknown[]; bytecode: Hex } {
  const path = `contracts/out/${file}/${name}.json`
  if (!existsSync(path)) fail(`${path} is missing. Run \`forge build\` first.`)
  const json = JSON.parse(readFileSync(path, 'utf8')) as { abi: unknown[]; bytecode: { object: Hex } }
  return { abi: json.abi, bytecode: json.bytecode.object }
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

const poseidonArt = artifact('PoseidonT3.sol', 'PoseidonT3')
const verifierArt = artifact('Verifier.sol', 'PlonkVerifier')
const poolArt = artifact('ShieldedPool.sol', 'ShieldedPool')

const verifierAbi = parseAbi(['function verifyProof(uint256[24] proof, uint256[5] pubSignals) view returns (bool)'])
const poolReadAbi = parseAbi([
  'function usdc() view returns (address)',
  'function verifier() view returns (address)',
  'function poseidon() view returns (address)',
  'function owner() view returns (address)',
  'function paused() view returns (bool)',
  'function getDenominations() view returns (uint256[])',
])

/** The PLONK test vector written by `bun run zk:setup -- --check`. */
function testVector(): { proof: bigint[]; signals: bigint[] } {
  const path = 'build/zk/check/calldata.txt'
  if (!existsSync('build/zk/check/proof.json')) fail('No PLONK test vector. Run `bun run zk:setup -- --check` first.')
  if (!existsSync(path)) {
    // The setup script leaves proof.json and public.json; turn them into Solidity calldata.
    const out = execFileSync('node', ['node_modules/snarkjs/build/cli.cjs', 'zkey', 'export', 'soliditycalldata', 'build/zk/check/public.json', 'build/zk/check/proof.json'])
    writeFileSync(path, out)
  }
  const [proof, signals] = JSON.parse(`[${readFileSync(path, 'utf8').trim().replace('][', '],[')}]`) as [string[], string[]]
  return { proof: proof.map((x) => BigInt(x)), signals: signals.map((x) => BigInt(x)) }
}

// ---------- preflight ----------

const usdcText = (v: bigint) => formatUnits(v, 6)
const line = (k: string, v: string) => console.log(`  ${k.padEnd(18)} ${v}`)

console.log(`\nZerith pool deployment: ${network.toUpperCase()}${dryRun ? ' (dry run, nothing will be sent)' : ''}\n`)

const remoteChainId = await publicClient.getChainId().catch(() => fail(`Cannot reach the RPC at ${rpcUrl}`))
if (remoteChainId !== chainId) fail(`The RPC is chain ${remoteChainId}, expected ${chainId}`)
if (!(await publicClient.getCode({ address: usdc }))) fail(`No contract at the USDC address ${usdc}`)
const hasMulticall = !!(await publicClient.getCode({ address: MULTICALL3 }))
const balance = await publicClient.getBalance({ address: account.address })

line('Chain', `${chain.name} (${chainId})`)
line('RPC', rpcUrl)
line('Deployer', account.address)
line('Deployer balance', `${formatUnits(balance, 18)} USDC (gas)`)
line('Pool owner', `${owner}${owner === account.address ? ' (the deployer)' : ''}`)
line('USDC', usdc)
line('Note sizes', denoms.map(usdcText).join(', ') + ' USDC (permanent)')
line('Multicall3', hasMulticall ? 'present (Withdraw all works)' : 'MISSING: Withdraw all will not work on this chain')
line('Verifier source', `contracts/Verifier.sol sha256 ${sha256('contracts/Verifier.sol').slice(0, 16)}...`)
if (existsSync('build/zk/withdraw_plonk.zkey')) line('Proving key', `sha256 ${sha256('build/zk/withdraw_plonk.zkey').slice(0, 16)}...`)

const vector = testVector()
const gasPrice = await publicClient.getGasPrice()
const estimate = 9_000_000n // three contracts; generous upper bound
line('Gas price', `${formatUnits(gasPrice, 9)} gwei`)
line('Max cost', `~${formatUnits(estimate * gasPrice, 18)} USDC`)
if (balance < estimate * gasPrice) fail('The deployer balance is too low for the deployment gas')

if (dryRun) {
  console.log('\n✓ Dry run passed. Rerun without --dry-run to deploy.\n')
  process.exit(0)
}

if (network === 'mainnet') {
  console.log('\nThis deploys to MAINNET from your wallet, with real funds and permanent note sizes.')
  const answer = prompt('Type "deploy to mainnet" to continue:')
  if (answer?.trim() !== 'deploy to mainnet') fail('Cancelled')
}

// ---------- deploy ----------

async function deploy(label: string, art: { abi: unknown[]; bytecode: Hex }, args: unknown[] = []) {
  process.stdout.write(`\n  Deploying ${label}... `)
  const hash = await walletClient.deployContract({ abi: art.abi, bytecode: art.bytecode, args })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success' || !receipt.contractAddress) fail(`${label} deployment failed (tx ${hash})`)
  console.log(`${receipt.contractAddress}  (block ${receipt.blockNumber}, gas ${receipt.gasUsed})`)
  return { address: receipt.contractAddress, hash, block: receipt.blockNumber }
}

const poseidon = await deploy('PoseidonT3', poseidonArt)
const verifier = await deploy('PlonkVerifier', verifierArt)

// Never put a pool in front of a verifier that does not accept a known-good proof.
const accepts = await publicClient.readContract({
  address: verifier.address,
  abi: verifierAbi,
  functionName: 'verifyProof',
  args: [vector.proof as never, vector.signals as never],
})
if (!accepts) fail('The deployed verifier rejected the test proof. Not deploying the pool.')
const tampered = [...vector.signals]
tampered[2] += 1n
const rejects = !(await publicClient.readContract({
  address: verifier.address,
  abi: verifierAbi,
  functionName: 'verifyProof',
  args: [vector.proof as never, tampered as never],
}))
if (!rejects) fail('The deployed verifier accepted a tampered proof. Not deploying the pool.')
console.log('  Verifier accepts the test proof and rejects a tampered one.')

const pool = await deploy('ShieldedPool', poolArt, [usdc, verifier.address, poseidon.address, owner, denoms])

// ---------- post-deploy checks ----------

const read = <T>(functionName: string) =>
  publicClient.readContract({ address: pool.address, abi: poolReadAbi, functionName: functionName as never }) as Promise<T>
const checks: [string, boolean][] = [
  ['usdc', getAddress(await read<Address>('usdc')) === usdc],
  ['verifier', getAddress(await read<Address>('verifier')) === getAddress(verifier.address)],
  ['poseidon', getAddress(await read<Address>('poseidon')) === getAddress(poseidon.address)],
  ['owner', getAddress(await read<Address>('owner')) === owner],
  ['not paused', !(await read<boolean>('paused'))],
  ['note sizes', JSON.stringify((await read<bigint[]>('getDenominations')).map(String)) === JSON.stringify(denoms.map(String))],
]
for (const [name, ok] of checks) console.log(`  ${ok ? '✓' : '✖'} ${name}`)
if (checks.some(([, ok]) => !ok)) fail('A post-deploy check failed. Do not use this pool.')

// ---------- record ----------

const record = {
  network,
  chainId,
  deployedAt: new Date().toISOString(),
  deployer: account.address,
  owner,
  usdc,
  denominations: denoms.map(String),
  proofSystem: 'plonk',
  contracts: {
    PoseidonT3: { address: poseidon.address, tx: poseidon.hash, block: poseidon.block.toString() },
    PlonkVerifier: { address: verifier.address, tx: verifier.hash, block: verifier.block.toString() },
    ShieldedPool: { address: pool.address, tx: pool.hash, block: pool.block.toString() },
  },
  hashes: {
    verifierSource: sha256('contracts/Verifier.sol'),
    zkey: existsSync('build/zk/withdraw_plonk.zkey') ? sha256('build/zk/withdraw_plonk.zkey') : null,
  },
}
mkdirSync('deployments', { recursive: true })
const recordPath = `deployments/${network}.json`
writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n')

console.log(`\n✓ Deployed. Record written to ${recordPath}\n`)
console.log('Next steps:')
console.log(`  1. In .env:            VITE_POOL_ADDRESS=${pool.address}`)
console.log(`                         VITE_POOL_DEPLOY_BLOCK=${pool.block}`)
console.log(`  2. In wrangler.jsonc:  "POOL_ADDRESS": "${pool.address}"`)
if (explorer) {
  const verify = (addr: string, path: string, extra = '') =>
    `forge verify-contract ${addr} ${path} --chain-id ${chainId} --verifier blockscout --verifier-url ${explorer}/api/${extra}`
  const ctorArgs = `$(cast abi-encode "constructor(address,address,address,address,uint256[])" ${usdc} ${verifier.address} ${poseidon.address} ${owner} "[${denoms.join(',')}]")`
  console.log('  3. Verify the source on the explorer:')
  console.log(`     ${verify(poseidon.address, 'contracts/PoseidonT3.sol:PoseidonT3')}`)
  console.log(`     ${verify(verifier.address, 'contracts/Verifier.sol:PlonkVerifier')}`)
  console.log(`     ${verify(pool.address, 'contracts/ShieldedPool.sol:ShieldedPool', ` --constructor-args ${ctorArgs}`)}`)
  console.log(`  4. Explorer: ${explorer}/address/${pool.address}`)
}
console.log('')
