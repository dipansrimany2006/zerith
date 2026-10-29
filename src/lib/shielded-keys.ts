import { x25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { poseidon1 } from 'poseidon-lite'

/** BN254 scalar field size. */
export const FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

export const KEY_DERIVATION_MESSAGE = [
  'Shielded USDC: derive private payment keys (v1)',
  '',
  'Signing creates your shielded address and viewing key on this device.',
  'It does not send a transaction and costs nothing.',
  'Only sign this on the Shielded USDC app.',
].join('\n')

export const ADDRESS_PREFIX = 'shld1'

export interface ShieldedKeys {
  /** Spend key. Never leaves the browser. */
  ownerPriv: bigint
  /** Poseidon(ownerPriv). Public half of the shielded address. */
  ownerPub: bigint
  /** X25519 private key used to read incoming notes. Safe to share with an auditor. */
  viewPriv: Uint8Array
  viewPub: Uint8Array
  /** Shareable shielded address: ownerPub + viewPub. */
  address: string
}

export function bigintToBytes32(value: bigint): Uint8Array {
  return hexToBytes(value.toString(16).padStart(64, '0'))
}

export function bytes32ToBigint(bytes: Uint8Array): bigint {
  return BigInt(`0x${bytesToHex(bytes)}`)
}

export function toBytes32Hex(value: bigint): `0x${string}` {
  return `0x${value.toString(16).padStart(64, '0')}`
}

function fieldFromSeed(seed: Uint8Array): bigint {
  return bytes32ToBigint(seed) % FIELD_SIZE
}

export function deriveKeys(signature: string): ShieldedKeys {
  const sigBytes = hexToBytes(signature.replace(/^0x/, ''))
  const ownerPriv = fieldFromSeed(sha256(concatBytes(utf8ToBytes('shielded/spend/v1'), sigBytes)))
  const viewPriv = sha256(concatBytes(utf8ToBytes('shielded/view/v1'), sigBytes))
  const ownerPub = poseidon1([ownerPriv])
  const viewPub = x25519.getPublicKey(viewPriv)
  return {
    ownerPriv,
    ownerPub,
    viewPriv,
    viewPub,
    address: encodeAddress(ownerPub, viewPub),
  }
}

export function encodeAddress(ownerPub: bigint, viewPub: Uint8Array): string {
  return `${ADDRESS_PREFIX}${bytesToHex(bigintToBytes32(ownerPub))}${bytesToHex(viewPub)}`
}

export interface DecodedAddress {
  ownerPub: bigint
  viewPub: Uint8Array
}

export function decodeAddress(input: string): DecodedAddress | null {
  const value = input.trim()
  if (!value.startsWith(ADDRESS_PREFIX)) return null
  const hex = value.slice(ADDRESS_PREFIX.length)
  if (!/^[0-9a-fA-F]{128}$/.test(hex)) return null
  const bytes = hexToBytes(hex)
  const ownerPub = bytes32ToBigint(bytes.slice(0, 32))
  if (ownerPub >= FIELD_SIZE) return null
  return { ownerPub, viewPub: bytes.slice(32, 64) }
}

export function shortAddress(address: string): string {
  return address.length > 18 ? `${address.slice(0, 11)}...${address.slice(-6)}` : address
}
