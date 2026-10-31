/**
 * Writes a valid witness input for the withdraw circuit, built with the app's own crypto code,
 * for the PLONK self-check in scripts/zk-setup-plonk.sh. Test values only, never real keys.
 * Usage: bun run scripts/zk-check-input.ts <out.json>
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { poseidon1 } from 'poseidon-lite'
import { buildMerkleProof } from '../src/lib/merkle'
import { computeCommitment, computeNullifierHash } from '../src/lib/notes'

const out = process.argv[2] ?? 'build/zk/check/input.json'
const ownerPriv = 123456789n
const secret = 987654321n
const commitment = computeCommitment(poseidon1([ownerPriv]), secret)
const merkle = buildMerkleProof([11n, 22n, commitment], 2)

const input = {
  root: merkle.root.toString(),
  nullifierHash: computeNullifierHash(ownerPriv, commitment).toString(),
  recipient: BigInt('0x000000000000000000000000000000000000dEaD').toString(),
  relayer: BigInt('0x00000000000000000000000000000000000000Aa').toString(),
  fee: '20000',
  ownerPriv: ownerPriv.toString(),
  secret: secret.toString(),
  pathElements: merkle.pathElements.map(String),
  pathIndices: merkle.pathIndices,
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(input))
