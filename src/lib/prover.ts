import { bytesToHex, hexToBigInt, type Address } from 'viem'
import type { ProvingFile } from 'snarkjs'
import { buildMerkleProof } from '@/lib/merkle'
import { computeCommitment, computeNullifierHash } from '@/lib/notes'
import { toBytes32Hex, type ShieldedKeys } from '@/lib/shielded-keys'
import { ZK_WASM, ZK_ZKEY } from '@/lib/zk-artifacts'

type Tuple<T, N extends number, R extends readonly T[] = readonly []> = R['length'] extends N ? R : Tuple<T, N, readonly [T, ...R]>

/** PLONK proof as the 24 words the on-chain verifier takes (`uint256[24]`). */
export type PlonkProofWords = Tuple<bigint, 24>

export interface WithdrawProof {
  proof: PlonkProofWords
  root: `0x${string}`
  nullifierHash: `0x${string}`
}

export interface WithdrawRequest {
  keys: ShieldedKeys
  secret: bigint
  leaves: readonly bigint[]
  leafIndex: number
  recipient: Address
  relayer: Address
  fee: bigint
}

export interface ProvingFiles {
  wasm: ProvingFile
  zkey: ProvingFile
}

async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bytesToHex(new Uint8Array(digest)).slice(2)
}

async function download(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not download the proving files (${res.status}). Try again.`)
  return new Uint8Array(await res.arrayBuffer())
}

let browserFiles: Promise<ProvingFiles> | null = null

/**
 * Downloads the circuit and the PLONK key (shipped in parts to fit static hosting limits), joins the
 * parts, and checks both against the hashes pinned in zk-artifacts.ts. A tampered or incomplete file
 * is refused. Cached for the session after the first successful load.
 */
export function loadProvingFiles(): Promise<ProvingFiles> {
  browserFiles ??= (async () => {
    const [wasm, ...parts] = await Promise.all([download(ZK_WASM.url), ...ZK_ZKEY.parts.map(download)])
    const zkey = new Uint8Array(ZK_ZKEY.bytes)
    let offset = 0
    for (const part of parts) {
      zkey.set(part, offset)
      offset += part.length
    }
    if (offset !== ZK_ZKEY.bytes) throw new Error('The proving key download was incomplete. Try again.')
    const [wasmHash, zkeyHash] = await Promise.all([sha256Hex(wasm), sha256Hex(zkey)])
    if (wasmHash !== ZK_WASM.sha256 || zkeyHash !== ZK_ZKEY.sha256) {
      throw new Error('The proving files do not match the expected hashes. Reload the page and try again.')
    }
    return { wasm: { type: 'mem', data: wasm }, zkey: { type: 'mem', data: zkey } } as ProvingFiles
  })().catch((err: unknown) => {
    browserFiles = null // let the next attempt download again
    throw err
  })
  return browserFiles
}

/** Generates a PLONK proof. Public signals: root, nullifierHash, recipient, relayer, fee. */
export async function proveWithdraw(req: WithdrawRequest, files?: ProvingFiles): Promise<WithdrawProof> {
  const commitment = computeCommitment(req.keys.ownerPub, req.secret)
  if (req.leaves[req.leafIndex] !== commitment) {
    throw new Error('This note does not match the pool tree. Rescan and try again.')
  }
  const merkle = buildMerkleProof(req.leaves, req.leafIndex)
  const nullifierHash = computeNullifierHash(req.keys.ownerPriv, commitment)

  const input = {
    root: merkle.root.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: hexToBigInt(req.recipient).toString(),
    relayer: hexToBigInt(req.relayer).toString(),
    fee: req.fee.toString(),
    ownerPriv: req.keys.ownerPriv.toString(),
    secret: req.secret.toString(),
    pathElements: merkle.pathElements.map((v) => v.toString()),
    pathIndices: merkle.pathIndices,
  }

  const { wasm, zkey } = files ?? (await loadProvingFiles())
  // Loaded on demand so the proving library stays out of the initial page load.
  const snarkjs = await import('snarkjs')
  const { proof, publicSignals } = await snarkjs.plonk.fullProve(input, wasm, zkey)

  // The calldata export puts the 24 proof words in the exact order the Solidity verifier reads them.
  const calldata = await snarkjs.plonk.exportSolidityCallData(proof, publicSignals)
  const [words, signals] = JSON.parse(`[${calldata.replace('][', '],[')}]`) as [string[], string[]]
  if (words.length !== 24) throw new Error('Unexpected proof format')
  if (BigInt(signals[0]) !== merkle.root || BigInt(signals[1]) !== nullifierHash) {
    throw new Error('The proof does not match this note. Rescan and try again.')
  }

  return {
    proof: words.map((w) => BigInt(w)) as unknown as PlonkProofWords,
    root: toBytes32Hex(merkle.root),
    nullifierHash: toBytes32Hex(nullifierHash),
  }
}
