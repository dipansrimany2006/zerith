# Project memory

Shielded USDC: private USDC payments on Arc Testnet (chain ID 5042002). Built with Arc Studio.

## Deployed contracts (Arc Testnet)
- ShieldedPool: 0xfb73fe8487910611af9039bf0b72eba0a15770b5 (deploy tx 0x2fa82ee45b1e8f8955a7b62b255a269cd2258902bffc232337df65d7bc7cc291, block 69744668)
- Groth16Verifier: 0x90176135a31f01bee989a679f9374137a521edc7
- PoseidonT3 (standalone hasher, called through an interface): 0x621aed2e8b983736795acb5dc87d9cae07d1a0d8
- Denominations (USDC, 6 decimals): 0.10, 1, 10. Owner (can only pause deposits): platform deployer wallet.
- Pool address and deploy block live in `.env` as VITE_POOL_ADDRESS and VITE_POOL_DEPLOY_BLOCK.

## Architecture
- Recipient-bound notes: commitment = Poseidon(ownerPub, secret); nullifier = Poseidon(ownerPriv, commitment). The sender cannot spend or detect spending.
- Circuit `circuits/withdraw.circom` (depth 20). Public signals order: root, nullifierHash, recipient, relayer, fee. Rebuild with `bun run zk:setup` (needs `.tools/circom`; dev-only single-party setup). Re-running it changes the verifier: the pool must then be redeployed.
- Client libs in `src/lib/` (keys, notes, scan, merkle, prover). Poseidon in the browser comes from poseidon-lite and matches the on-chain hasher.
- Relayer: `server/relayer.ts` (`bun run relayer`, port 3001), reached by the app at `/api` through the Vite proxy. Needs RELAYER_PRIVATE_KEY in `.env` and a USDC balance for gas. Minimum fee 0.02 USDC (RELAYER_MIN_FEE overrides).
- snarkjs workers crash under Bun, so the end-to-end script is bundled and run with Node: `E2E_SENDER_KEY=0x... bash scripts/run-e2e.sh`.

## Decisions
- Testnet only, unaudited, dev trusted setup. Arc native privacy is on the roadmap; the app logic is kept separate so it can be swapped later.
- Withdrawals are never pausable. Pause only stops deposits.
- Never print or commit `.env`, the relayer key, or any sender key.
