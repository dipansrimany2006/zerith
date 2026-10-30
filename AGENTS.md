# Project memory

Zerith (formerly Shielded USDC): private USDC payments on Arc Testnet (chain ID 5042002). Built with Arc Studio.
- Logo: `assets/zerith.png` (source), `public/zerith.svg` (favicon), `src/components/Logo.tsx` (in-app mark).
- The strings "Shielded USDC" in `KEY_DERIVATION_MESSAGE` (src/lib/shielded-keys.ts) and the report message (Disclosure.tsx) are protocol strings: never rename them, or existing keys and signed reports break.
- Deploy: Cloudflare Worker `zerith` (`bun run cf:deploy`, config in wrangler.jsonc). The relayer key is a Worker secret.

## Deployed contracts (Arc Testnet)
- ShieldedPool (current, v2): 0x213ec5ddc7aa24100ddfcc96787d4d3556431b18 (deploy tx 0xf954e49e0f403ee626684b60666e378f2a4531f5a003f3bff192bca86e264565, block 69873014). Has `depositMany` (up to 10 notes per transaction).
- ShieldedPool v1 (legacy, still works for withdrawals): 0xfb73fe8487910611af9039bf0b72eba0a15770b5 (block 69744668). To withdraw notes still sitting there, temporarily point VITE_POOL_ADDRESS / VITE_POOL_DEPLOY_BLOCK (and POOL_ADDRESS in wrangler.jsonc) at it.
- Groth16Verifier: 0x90176135a31f01bee989a679f9374137a521edc7
- PoseidonT3 (standalone hasher, called through an interface): 0x621aed2e8b983736795acb5dc87d9cae07d1a0d8
- Denominations (USDC, 6 decimals): v2 has 0.10, 1, 10, 100, 1000 (v1 had 0.10, 1, 10). They are fixed at deploy time. Owner (can only pause deposits): platform deployer wallet.
- Pool address and deploy block live in `.env` as VITE_POOL_ADDRESS and VITE_POOL_DEPLOY_BLOCK.

## Architecture
- Recipient-bound notes: commitment = Poseidon(ownerPub, secret); nullifier = Poseidon(ownerPriv, commitment). The sender cannot spend or detect spending.
- Circuit `circuits/withdraw.circom` (depth 20). Public signals order: root, nullifierHash, recipient, relayer, fee. Rebuild with `bun run zk:setup` (needs `.tools/circom`; dev-only single-party setup). Re-running it changes the verifier: the pool must then be redeployed.
- Client libs in `src/lib/` (keys, notes, scan, merkle, prover). Poseidon in the browser comes from poseidon-lite and matches the on-chain hasher.
- Relayer: `server/relayer.ts` (`bun run relayer`, port 3001), reached by the app at `/api` through the Vite proxy. Needs RELAYER_PRIVATE_KEY in `.env` and a USDC balance for gas. Minimum fee 0.02 USDC (RELAYER_MIN_FEE overrides).
- snarkjs workers crash under Bun, so the end-to-end script is bundled and run with Node: `E2E_SENDER_KEY=0x... bash scripts/run-e2e.sh`.

## Decisions
- Large payments: the Send screen splits an amount into the largest allowed notes and sends them with `depositMany` in batches of 10 (one transaction per batch), up to 50 notes per payment. A 10-note batch costs roughly 8.7M gas; Arc Testnet's block gas limit is 30M.
- Testnet only, unaudited, dev trusted setup. Arc native privacy is on the roadmap; the app logic is kept separate so it can be swapped later.
- Withdrawals are never pausable. Pause only stops deposits.
- Never print or commit `.env`, the relayer key, or any sender key.
