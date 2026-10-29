import { formatUsdc } from '@/onchain-money'

/** "1.5" style USDC text from base units (6 decimals), trimmed to at most 2 decimals unless more are needed. */
export function usdcText(raw: bigint): string {
  const full = formatUsdc(raw)
  const [whole, frac = ''] = full.split('.')
  const trimmed = frac.replace(/0+$/, '')
  const padded = trimmed.length < 2 ? trimmed.padEnd(2, '0') : trimmed
  return `${whole}.${padded}`
}

export function timeAgo(unixSeconds: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`
  return `${Math.floor(diff / 86400)} d ago`
}

export function shortHash(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-6)}`
}

const REVERT_MESSAGES: Record<string, string> = {
  NullifierAlreadySpent: 'This note was already withdrawn.',
  UnknownRoot: 'The pool changed while preparing the proof. Try again.',
  InvalidProof: 'The proof was rejected. Rescan and try again.',
  FeeExceedsDenomination: 'The fee is larger than the note.',
  InvalidRecipient: 'Choose a valid destination address.',
  EnforcedPause: 'Deposits are paused right now. Withdrawals still work.',
}

/** Turns wallet, RPC and relayer errors into one short sentence. */
export function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const lower = raw.toLowerCase()
  if (lower.includes('user rejected') || lower.includes('user denied')) return 'Cancelled in your wallet.'
  if (lower.includes('insufficient funds') || lower.includes('exceeds balance')) {
    return 'Not enough USDC for this. Use Get test USDC in the sidebar.'
  }
  for (const [code, message] of Object.entries(REVERT_MESSAGES)) {
    if (raw.includes(code)) return message
  }
  if (lower.includes('network') || lower.includes('timeout') || lower.includes('fetch')) {
    return 'Network issue. Check your connection and try again.'
  }
  return raw.split('\n')[0] || 'Something went wrong. Try again.'
}
