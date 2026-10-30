import { getAbiItem, hexToBytes, type PublicClient } from 'viem'
import {
  POOL_ADDRESS,
  POOL_DEPLOY_BLOCK,
  poolAbi,
} from '@/lib/pool'
import {
  tryDecryptIncoming,
  tryDecryptOutgoing,
  type IncomingNote,
  type OutgoingNote,
} from '@/lib/notes'
import type { ShieldedKeys } from '@/lib/shielded-keys'

const depositEvent = getAbiItem({ abi: poolAbi, name: 'Deposit' })

export interface DepositLog {
  denomIndex: number
  commitment: bigint
  leafIndex: number
  timestamp: number
  ephemeralPub: `0x${string}`
  ciphertext: `0x${string}`
  txHash: `0x${string}`
  blockNumber: bigint
}

/** Pages through Deposit logs from the pool's deployment block, shrinking the range if the RPC rejects it. */
export async function fetchDeposits(
  client: PublicClient,
  fromBlock: bigint = POOL_DEPLOY_BLOCK,
  toBlock?: bigint,
): Promise<DepositLog[]> {
  if (!POOL_ADDRESS) return []
  const head = toBlock ?? (await client.getBlockNumber())
  const out: DepositLog[] = []
  let from = fromBlock
  let step = 10_000n // Arc Testnet RPC rejects log ranges above 10,000 blocks
  while (from <= head) {
    const to = from + step - 1n > head ? head : from + step - 1n
    try {
      const logs = await client.getLogs({
        address: POOL_ADDRESS,
        event: depositEvent,
        fromBlock: from,
        toBlock: to,
      })
      for (const log of logs) {
        const a = log.args
        if (
          a.denomIndex === undefined ||
          a.commitment === undefined ||
          a.leafIndex === undefined ||
          a.timestamp === undefined ||
          a.ephemeralPub === undefined ||
          a.ciphertext === undefined
        )
          continue
        out.push({
          denomIndex: a.denomIndex,
          commitment: BigInt(a.commitment),
          leafIndex: a.leafIndex,
          timestamp: Number(a.timestamp),
          ephemeralPub: a.ephemeralPub,
          ciphertext: a.ciphertext,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
        })
      }
      from = to + 1n
    } catch (err) {
      if (step <= 500n) throw err
      step = step / 4n
    }
  }
  return out
}

export function leavesFor(logs: readonly DepositLog[], denomIndex: number): bigint[] {
  return logs
    .filter((l) => l.denomIndex === denomIndex)
    .sort((a, b) => a.leafIndex - b.leafIndex)
    .map((l) => l.commitment)
}

export function countByDenomination(logs: readonly DepositLog[], count: number): number[] {
  const counts = Array.from({ length: count }, () => 0)
  for (const l of logs) if (l.denomIndex < count) counts[l.denomIndex] += 1
  return counts
}

export function readOwnNotes(
  logs: readonly DepositLog[],
  keys: ShieldedKeys,
): { incoming: IncomingNote[]; outgoing: OutgoingNote[] } {
  const incoming: IncomingNote[] = []
  const outgoing: OutgoingNote[] = []
  for (const log of logs) {
    const eph = hexToBytes(log.ephemeralPub)
    const cipher = hexToBytes(log.ciphertext)
    const base = {
      denomIndex: log.denomIndex,
      commitment: log.commitment,
      leafIndex: log.leafIndex,
      txHash: log.txHash,
      blockNumber: log.blockNumber,
      timestamp: log.timestamp,
    }
    const mine = tryDecryptIncoming(keys, eph, cipher, log.commitment)
    if (mine) incoming.push({ ...base, secret: mine.secret, memo: mine.memo })
    const sent = tryDecryptOutgoing(keys, cipher)
    if (sent) outgoing.push({ ...base, recipient: sent.recipient, memo: sent.memo })
  }
  return { incoming, outgoing }
}
