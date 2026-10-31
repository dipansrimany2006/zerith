import { parseAbi, type Address } from 'viem'
import { arcTestnet } from 'viem/chains'
import { getUsdc } from '@/onchain-facts'

export const CHAIN_ID = arcTestnet.id

const rawAddress = import.meta.env.VITE_POOL_ADDRESS as string | undefined
const rawBlock = import.meta.env.VITE_POOL_DEPLOY_BLOCK as string | undefined

/** Pool address from .env (VITE_POOL_ADDRESS). Undefined until the pool is deployed. */
export const POOL_ADDRESS: Address | undefined = rawAddress ? (rawAddress as Address) : undefined
export const POOL_DEPLOY_BLOCK: bigint = rawBlock ? BigInt(rawBlock) : 0n

const usdcFact = getUsdc(CHAIN_ID)
if (!usdcFact) throw new Error(`USDC is not registered for chain ${CHAIN_ID}`)
export const USDC_ADDRESS = usdcFact.address as Address

export const TREE_LEVELS = 20

/** Notes the pool accepts in one depositMany call (matches ShieldedPool.MAX_BATCH). */
export const MAX_BATCH = 10

/**
 * Multicall3 (same address on most EVM chains, deployed on Arc Testnet). "Withdraw all" sends many
 * pool withdrawals through it as one atomic transaction; the pool's withdraw does not depend on the caller.
 */
export const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11'

export const multicallAbi = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
])

/** Notes per "Withdraw all" transaction when the wallet submits it (matches the relayer's batch size). */
export const MAX_WITHDRAW_BATCH = 20

export const poolAbi = parseAbi([
  'function deposit(uint8 denomIndex, bytes32 commitment, bytes32 ephemeralPub, bytes ciphertext)',
  'function depositMany(uint8[] denomIndices, bytes32[] commitments, bytes32[] ephemeralPubs, bytes[] ciphertexts)',
  'function withdraw(uint8 denomIndex, uint256[2] a, uint256[2][2] b, uint256[2] c, bytes32 root, bytes32 nullifierHash, address recipient, address relayer, uint256 fee)',
  'function getDenominations() view returns (uint256[])',
  'function getZeros() view returns (uint256[21])',
  'function nextLeafIndex(uint8 denomIndex) view returns (uint32)',
  'function getLastRoot(uint8 denomIndex) view returns (bytes32)',
  'function isKnownRoot(uint8 denomIndex, bytes32 root) view returns (bool)',
  'function spent(bytes32 nullifierHash) view returns (bool)',
  'function paused() view returns (bool)',
  'event Deposit(uint8 indexed denomIndex, bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp, bytes32 ephemeralPub, bytes ciphertext)',
  'event Withdrawal(uint8 indexed denomIndex, address indexed recipient, bytes32 nullifierHash, address relayer, uint256 fee)',
])
