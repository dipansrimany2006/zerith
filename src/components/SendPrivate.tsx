import { useMemo, useState } from 'react'
import { bytesToHex, erc20Abi } from 'viem'
import { usePublicClient, useReadContract, useWriteContract } from 'wagmi'
import { Check, ExternalLink, Send } from 'lucide-react'
import { toast } from 'sonner'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { parseUsdc } from '@/onchain-money'
import { CHAIN_ID, POOL_ADDRESS, USDC_ADDRESS, poolAbi } from '@/lib/pool'
import { MAX_MEMO_BYTES, createNote, splitIntoDenominations } from '@/lib/notes'
import { decodeAddress, toBytes32Hex } from '@/lib/shielded-keys'
import { useShielded } from '@/lib/shielded-context'
import { useChainGuard } from '@/lib/use-chain-guard'
import { friendlyError, shortHash, usdcText } from '@/lib/format'
import { Card, Notice, Row, SectionLabel, Spinner } from '@/components/ui'

const MAX_NOTES = 10

interface Step {
  label: string
  status: 'pending' | 'active' | 'done' | 'error'
  hash?: `0x${string}`
}

export function SendPrivate() {
  const { keys, denominations, refresh } = useShielded()
  const { address, wrongChain, ensureChain } = useChainGuard()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()

  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  })

  const decoded = useMemo(() => decodeAddress(recipient), [recipient])
  const memoBytes = new TextEncoder().encode(memo).length

  const parsed = useMemo(() => {
    if (!amount) return null
    try {
      return parseUsdc(amount)
    } catch {
      return null
    }
  }, [amount])

  const split = useMemo(
    () => (parsed && denominations.length ? splitIntoDenominations(parsed, denominations) : null),
    [parsed, denominations],
  )

  const grouped = useMemo(() => {
    const counts = new Map<number, number>()
    for (const i of split ?? []) counts.set(i, (counts.get(i) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => Number(denominations[b[0]] - denominations[a[0]]))
  }, [split, denominations])

  const smallest = denominations.length ? denominations.reduce((a, b) => (a < b ? a : b)) : 0n
  const tooMany = (split?.length ?? 0) > MAX_NOTES
  const insufficient = parsed !== null && balance !== undefined && parsed > balance
  const amountProblem =
    amount && parsed === null
      ? 'Enter a valid amount.'
      : parsed && !split
        ? `Amounts must be made of ${denominations.map(usdcText).join(', ')} USDC notes (smallest ${usdcText(smallest)}).`
        : tooMany
          ? `That would take more than ${MAX_NOTES} notes. Send a smaller amount, or send in several payments.`
          : insufficient
            ? 'Not enough USDC. Use Get test USDC in the sidebar.'
            : null

  const ready =
    !!keys && !!decoded && !!split && !tooMany && !insufficient && memoBytes <= MAX_MEMO_BYTES && !sending && !!POOL_ADDRESS

  const updateStep = (index: number, patch: Partial<Step>) =>
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  const send = async () => {
    const pool = POOL_ADDRESS
    if (!keys || !decoded || !split || !publicClient || !pool || !address || !parsed) return
    setError(null)
    setSending(true)
    const labels: string[] = ['Approve USDC', ...split.map((d, n) => `Deposit note ${n + 1} of ${split.length} (${usdcText(denominations[d])} USDC)`)]
    setSteps(labels.map((label) => ({ label, status: 'pending' })))
    let current = 0
    try {
      await ensureChain()

      updateStep(0, { status: 'active' })
      const allowance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, pool],
      })
      if (allowance < parsed) {
        const hash = await writeContractAsync({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [pool, parsed],
          chainId: CHAIN_ID,
        })
        updateStep(0, { hash })
        await publicClient.waitForTransactionReceipt({ hash })
      }
      updateStep(0, { status: 'done' })

      for (let n = 0; n < split.length; n++) {
        current = n + 1
        updateStep(current, { status: 'active' })
        const note = createNote(decoded, keys.viewPub, memo)
        const hash = await writeContractAsync({
          address: pool,
          abi: poolAbi,
          functionName: 'deposit',
          args: [
            split[n],
            toBytes32Hex(note.commitment),
            bytesToHex(note.ephemeralPub),
            bytesToHex(note.ciphertext),
          ],
          chainId: CHAIN_ID,
        })
        updateStep(current, { hash })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('A deposit reverted')
        updateStep(current, { status: 'done' })
      }
      toast.success('Private payment sent')
      setAmount('')
      setMemo('')
      void refetchBalance()
      void refresh()
    } catch (err) {
      updateStep(current, { status: 'error' })
      setError(friendlyError(err))
    } finally {
      setSending(false)
    }
  }

  const finished = steps.length > 0 && steps.every((s) => s.status === 'done')

  return (
    <Card>
      <SectionLabel>Send privately</SectionLabel>

      <label className="block text-xs font-semibold" style={{ color: 'var(--ink-2)' }} htmlFor="recipient">
        Recipient shielded address
      </label>
      <input
        id="recipient"
        className="field mono mt-1.5 text-xs"
        placeholder="shld1..."
        value={recipient}
        onChange={(e) => setRecipient(e.target.value.trim())}
        autoComplete="off"
        spellCheck={false}
      />
      <div className="mt-1 flex items-center justify-between text-xs">
        <span style={{ color: recipient && !decoded ? 'var(--danger)' : 'var(--muted)' }}>
          {recipient && !decoded ? 'Not a valid shielded address.' : 'Ask the recipient to copy theirs from the Receive tab.'}
        </span>
        {keys && (
          <button type="button" className="font-semibold" style={{ color: 'var(--accent-hover)' }} onClick={() => setRecipient(keys.address)}>
            Use mine
          </button>
        )}
      </div>

      <div className="glass-inner mt-4 rounded-2xl p-4">
        <input
          inputMode="decimal"
          aria-label="Amount in USDC"
          value={amount}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, '')
            if (v === '' || /^\d*\.?\d{0,6}$/.test(v)) setAmount(v)
          }}
          placeholder="0.00"
          className="display w-full bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:text-slate-300"
          style={{ color: 'var(--ink)' }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>
            USDC
          </span>
          <span className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
            {balance !== undefined ? `Balance: ${usdcText(balance)}` : 'Connect to see your balance'}
          </span>
        </div>
      </div>
      {denominations.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {denominations.map((d) => (
            <button key={d.toString()} type="button" className="glass-pill min-h-9 rounded-full px-3 text-xs font-semibold tabular-nums" onClick={() => setAmount(usdcText(d))}>
              {usdcText(d)}
            </button>
          ))}
        </div>
      )}

      <label className="mt-4 block text-xs font-semibold" style={{ color: 'var(--ink-2)' }} htmlFor="memo">
        Private memo (optional)
      </label>
      <input id="memo" className="field mt-1.5" placeholder="Invoice 1042" value={memo} onChange={(e) => setMemo(e.target.value)} />
      <p className="mt-1 text-xs tabular-nums" style={{ color: memoBytes > MAX_MEMO_BYTES ? 'var(--danger)' : 'var(--muted)' }}>
        {memoBytes}/{MAX_MEMO_BYTES} bytes. Only you and the recipient can read it.
      </p>

      {amountProblem && (
        <div className="mt-3">
          <Notice tone="warn">{amountProblem}</Notice>
        </div>
      )}

      {split && !tooMany && (
        <div className="glass-inner mt-4 rounded-2xl px-4 py-2">
          <Row
            label="Notes"
            value={grouped.map(([i, c]) => `${c} × ${usdcText(denominations[i])}`).join(' + ')}
          />
          <Row label="Transactions" value={`1 approval + ${split.length} deposit${split.length === 1 ? '' : 's'}`} />
          <Row label="Total sent" value={`${usdcText(parsed ?? 0n)} USDC`} strong />
        </div>
      )}

      <div className="mt-4">
        <button className="btn-primary" disabled={!ready} onClick={() => void send()}>
          {sending ? (
            <span className="flex items-center justify-center gap-2">
              <Spinner /> Sending...
            </span>
          ) : wrongChain ? (
            'Switch to Arc Testnet and send'
          ) : (
            <span className="flex items-center justify-center gap-2">
              <Send className="size-4" /> Send privately
            </span>
          )}
        </button>
      </div>

      {steps.length > 0 && (
        <ol className="mt-4 space-y-2" aria-live="polite">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-2 text-xs" style={{ color: s.status === 'error' ? 'var(--danger)' : 'var(--ink-2)' }}>
              <span className="flex size-5 shrink-0 items-center justify-center">
                {s.status === 'active' ? <Spinner className="size-3.5" /> : s.status === 'done' ? <Check className="size-4" style={{ color: 'var(--success)' }} /> : <span className="size-1.5 rounded-full" style={{ background: s.status === 'error' ? 'var(--danger)' : 'var(--subtle)' }} />}
              </span>
              <span className="flex-1">{s.label}</span>
              {s.hash && (
                <a className="mono inline-flex items-center gap-1" style={{ color: 'var(--accent-hover)' }} href={buildTxExplorerUrl(CHAIN_ID, s.hash)} target="_blank" rel="noopener noreferrer">
                  {shortHash(s.hash)} <ExternalLink className="size-3" />
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {finished && (
        <div className="mt-3">
          <Notice>
            Sent. The recipient will see it in their Receive tab. For the best privacy they should wait before withdrawing.
          </Notice>
        </div>
      )}
    </Card>
  )
}
