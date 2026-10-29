import { poseidon2 } from 'poseidon-lite'
import { TREE_LEVELS } from '@/lib/pool'

/** zeros[0] = 0 (empty leaf); zeros[i] = H(zeros[i-1], zeros[i-1]). Matches the contract. */
export const ZEROS: bigint[] = (() => {
  const out: bigint[] = [0n]
  for (let i = 0; i < TREE_LEVELS; i++) out.push(poseidon2([out[i], out[i]]))
  return out
})()

export interface MerkleProof {
  root: bigint
  pathElements: bigint[]
  /** 0 = current node is the left child, 1 = right child. */
  pathIndices: number[]
}

/** Computes the root of a depth-20 tree and the authentication path for one leaf. */
export function buildMerkleProof(leaves: readonly bigint[], index: number): MerkleProof {
  if (index < 0 || index >= leaves.length) throw new Error('Leaf index out of range')
  let layer = leaves.slice()
  let idx = index
  const pathElements: bigint[] = []
  const pathIndices: number[] = []
  for (let level = 0; level < TREE_LEVELS; level++) {
    const sibling = idx % 2 === 0 ? layer[idx + 1] : layer[idx - 1]
    pathElements.push(sibling ?? ZEROS[level])
    pathIndices.push(idx % 2)
    const next: bigint[] = []
    for (let i = 0; i < layer.length; i += 2) {
      next.push(poseidon2([layer[i], layer[i + 1] ?? ZEROS[level]]))
    }
    layer = next
    idx = Math.floor(idx / 2)
  }
  return { root: layer[0], pathElements, pathIndices }
}
