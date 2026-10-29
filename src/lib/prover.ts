import { hexToBigInt, type Address } from 'viem'
import { buildMerkleProof } from '@/lib/merkle'
import { computeCommitment, computeNullifierHash } from '@/lib/notes'
import { toBytes32Hex, type ShieldedKeys } from '@/lib/shielded-keys'

const WASM_URL = '/zk/withdraw.wasm'
const ZKEY_URL = '/zk/withdraw_final.zkey'

export interface WithdrawProof {
  a: readonly [bigint, bigint]
  b: readonly [readonly [bigint, bigint], readonly [bigint, bigint]]
  c: readonly [bigint, bigint]
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

/** Generates a Groth16 proof in the browser. Public signals: root, nullifierHash, recipient, relayer, fee. */
export async function proveWithdraw(
  req: WithdrawRequest,
  artifacts: { wasm: string; zkey: string } = { wasm: WASM_URL, zkey: ZKEY_URL },
): Promise<WithdrawProof> {
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

  // Loaded on demand so the proving library stays out of the initial page load.
  const snarkjs = await import('snarkjs')
  const { proof } = await snarkjs.groth16.fullProve(input, artifacts.wasm, artifacts.zkey)
  const n = (v: string) => BigInt(v)
  return {
    a: [n(proof.pi_a[0]), n(proof.pi_a[1])],
    // The verifier expects the G2 coordinates swapped.
    b: [
      [n(proof.pi_b[0][1]), n(proof.pi_b[0][0])],
      [n(proof.pi_b[1][1]), n(proof.pi_b[1][0])],
    ],
    c: [n(proof.pi_c[0]), n(proof.pi_c[1])],
    root: toBytes32Hex(merkle.root),
    nullifierHash: toBytes32Hex(nullifierHash),
  }
}
