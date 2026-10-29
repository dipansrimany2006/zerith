import { x25519 } from '@noble/curves/ed25519.js'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { concatBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { poseidon2 } from 'poseidon-lite'
import {
  FIELD_SIZE,
  bigintToBytes32,
  bytes32ToBigint,
  encodeAddress,
  type DecodedAddress,
  type ShieldedKeys,
} from '@/lib/shielded-keys'

export const MAX_MEMO_BYTES = 64
const VERSION = 1
const NONCE_LEN = 24
/** "shld1" + 64 hex chars (ownerPub) + 64 hex chars (viewPub). */
const ADDRESS_STRING_LEN = 133

export interface NewNote {
  secret: bigint
  commitment: bigint
  ephemeralPub: Uint8Array
  ciphertext: Uint8Array
}

export interface IncomingNote {
  denomIndex: number
  commitment: bigint
  leafIndex: number
  secret: bigint
  memo: string
  txHash: `0x${string}`
  blockNumber: bigint
  timestamp: number
}

export interface OutgoingNote {
  denomIndex: number
  commitment: bigint
  leafIndex: number
  recipient: string
  memo: string
  txHash: `0x${string}`
  blockNumber: bigint
  timestamp: number
}

function randomField(): bigint {
  // 32 random bytes reduced mod p; bias is negligible for a 254-bit field.
  return bytes32ToBigint(randomBytes(32)) % FIELD_SIZE
}

export function computeCommitment(ownerPub: bigint, secret: bigint): bigint {
  return poseidon2([ownerPub, secret])
}

export function computeNullifierHash(ownerPriv: bigint, commitment: bigint): bigint {
  return poseidon2([ownerPriv, commitment])
}

function symmetricKey(shared: Uint8Array, ephemeralPub: Uint8Array): Uint8Array {
  return sha256(concatBytes(utf8ToBytes('shielded/ecies/v1'), shared, ephemeralPub))
}

function seal(plaintext: Uint8Array, recipientViewPub: Uint8Array) {
  const eph = x25519.keygen()
  const shared = x25519.getSharedSecret(eph.secretKey, recipientViewPub)
  const nonce = randomBytes(NONCE_LEN)
  const sealed = xchacha20poly1305(symmetricKey(shared, eph.publicKey), nonce).encrypt(plaintext)
  return { ephemeralPub: eph.publicKey, blob: concatBytes(nonce, sealed) }
}

function open(blob: Uint8Array, ephemeralPub: Uint8Array, viewPriv: Uint8Array): Uint8Array | null {
  try {
    const shared = x25519.getSharedSecret(viewPriv, ephemeralPub)
    const nonce = blob.slice(0, NONCE_LEN)
    return xchacha20poly1305(symmetricKey(shared, ephemeralPub), nonce).decrypt(blob.slice(NONCE_LEN))
  } catch {
    return null
  }
}

/**
 * Builds a recipient-bound note.
 * ciphertext layout: u16 len(blobR) | blobR | ephS(32) | blobS
 *  - blobR: for the recipient, plaintext = version | secret(32) | memo
 *  - blobS: copy for the sender's own history, plaintext = version | recipient address string (133 bytes) | memo
 */
export function createNote(
  recipient: DecodedAddress,
  senderViewPub: Uint8Array,
  memo: string,
): NewNote {
  const memoBytes = utf8ToBytes(memo)
  if (memoBytes.length > MAX_MEMO_BYTES) throw new Error(`Memo is limited to ${MAX_MEMO_BYTES} bytes`)

  const secret = randomField()
  const commitment = computeCommitment(recipient.ownerPub, secret)

  const toRecipient = seal(
    concatBytes(Uint8Array.of(VERSION), bigintToBytes32(secret), memoBytes),
    recipient.viewPub,
  )
  const recipientAddr = utf8ToBytes(encodeAddress(recipient.ownerPub, recipient.viewPub))
  const toSender = seal(concatBytes(Uint8Array.of(VERSION), recipientAddr, memoBytes), senderViewPub)

  const len = toRecipient.blob.length
  const ciphertext = concatBytes(
    Uint8Array.of((len >> 8) & 0xff, len & 0xff),
    toRecipient.blob,
    toSender.ephemeralPub,
    toSender.blob,
  )
  return { secret, commitment, ephemeralPub: toRecipient.ephemeralPub, ciphertext }
}

const decoder = new TextDecoder()

/** Tries to read a deposit as a payment addressed to `keys`. Returns the secret and memo if it is theirs. */
export function tryDecryptIncoming(
  keys: ShieldedKeys,
  ephemeralPub: Uint8Array,
  ciphertext: Uint8Array,
  commitment: bigint,
): { secret: bigint; memo: string } | null {
  if (ciphertext.length < 2) return null
  const len = (ciphertext[0] << 8) | ciphertext[1]
  if (ciphertext.length < 2 + len) return null
  const plain = open(ciphertext.slice(2, 2 + len), ephemeralPub, keys.viewPriv)
  if (!plain || plain[0] !== VERSION || plain.length < 33) return null
  const secret = bytes32ToBigint(plain.slice(1, 33))
  // Reject forged notes: the commitment must really be bound to this owner.
  if (computeCommitment(keys.ownerPub, secret) !== commitment) return null
  return { secret, memo: decoder.decode(plain.slice(33)) }
}

/** Tries to read the sender's own copy of a deposit. */
export function tryDecryptOutgoing(
  keys: ShieldedKeys,
  ciphertext: Uint8Array,
): { recipient: string; memo: string } | null {
  if (ciphertext.length < 2) return null
  const len = (ciphertext[0] << 8) | ciphertext[1]
  const start = 2 + len
  if (ciphertext.length < start + 32 + NONCE_LEN) return null
  const ephS = ciphertext.slice(start, start + 32)
  const plain = open(ciphertext.slice(start + 32), ephS, keys.viewPriv)
  if (!plain || plain[0] !== VERSION || plain.length < 1 + ADDRESS_STRING_LEN) return null
  return {
    recipient: decoder.decode(plain.slice(1, 1 + ADDRESS_STRING_LEN)),
    memo: decoder.decode(plain.slice(1 + ADDRESS_STRING_LEN)),
  }
}

/**
 * Splits an amount (6-decimal base units) into the fewest allowed denominations.
 * Returns the denomination index for each note, or null if it cannot be made exactly.
 */
export function splitIntoDenominations(amount: bigint, denominations: readonly bigint[]): number[] | null {
  if (amount <= 0n || denominations.length === 0) return null
  const order = denominations.map((_, i) => i).sort((a, b) => (denominations[b] > denominations[a] ? 1 : -1))
  let remaining = amount
  const result: number[] = []
  for (const index of order) {
    const d = denominations[index]
    while (remaining >= d) {
      result.push(index)
      remaining -= d
    }
  }
  return remaining === 0n ? result : null
}
