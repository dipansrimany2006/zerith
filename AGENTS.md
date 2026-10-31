# Project memory

Zerith (formerly Shielded USDC): private USDC payments on Arc. The chain is set by VITE_CHAIN_ID (5042002 Arc Testnet, the default; 5042 Arc mainnet) in `.env`, and CHAIN_ID in wrangler.jsonc; `src/lib/chain.ts` reads the rest from `src/onchain-facts.ts`. Built with Arc Studio.
- Logo: `assets/zerith.png` (source), `public/zerith.svg` (favicon), `src/components/Logo.tsx` (in-app mark).
- The strings "Shielded USDC" in `KEY_DERIVATION_MESSAGE` (src/lib/shielded-keys.ts) and the report message (Disclosure.tsx) are protocol strings: never rename them, or existing keys and signed reports break.
- Deploy: Cloudflare Worker `zerith` (`bun run cf:deploy`, config in wrangler.jsonc), live at https://zerith.dipansrimany.workers.dev on the "Dipansrimany@gmail.com's Account" Cloudflare account. The relayer key is a Worker secret.
- Mainnet site: Worker `zerith-mainnet`, live at https://zerith-mainnet.dipansrimany.workers.dev since 2026-10-31, relayer wallet 0xBCdf349Ee859259F75381BE5C74c26A45487017c (`bun run cf:deploy:mainnet`: `vite build --mode mainnet` reads `.env.mainnet` (gitignored, VITE_ values only), then `wrangler deploy --env mainnet`, config under `env.mainnet` in wrangler.jsonc). vite.config.ts refuses a mainnet build without chain 5042 and a pool. Its relayer key is a separate secret (`--env mainnet`) from a gas-only wallet, never the pool owner's.

## Deployed contracts (Arc mainnet, chain 5042)
Deployed 2026-10-31 with scripts/deploy-pool.ts, record in deployments/mainnet.json. Same PLONK verifier bytecode as the tested testnet pool.
- ShieldedPool: 0x322528dcd9f204d381f411c2815f3f4e63440782 (block 28848189). Note sizes 0.10, 1, 10. Owner (can only pause deposits): 0x9205b914F976A1d73e6Db97a770261CcE2DE69A3.
- PlonkVerifier: 0x4d64b0fbfe88013da5d686341870047f2f189329
- PoseidonT3: 0x7d72edc8b42896677b3ccd2a5b6c389336e502f3

## Deployed contracts (Arc Testnet)
Current pool (PLONK, deployed 2026-10-31 with scripts/deploy-pool.ts, record in deployments/testnet.json):
- ShieldedPool: 0xa592d4392b0784502ce40747ee402744c8300e6b (block 70035570). Note sizes 0.10, 1, 10, the same as the mainnet pool. Tested 2026-10-31: a 3-note depositMany and a 3-note wallet Withdraw all through Multicall3. Owner: deployer wallet 0x3630858fEDe8859B24f5F9F8236E3961B1b8A97A.
- PlonkVerifier: 0x4d7e0da3dfb2852e0e83e1a39515272cacc44838 (on-chain bytecode matches the local build of contracts/Verifier.sol)
- PoseidonT3: 0x0e197e1587aad339c7881432050de1dc2daa5c79

Older pools use the Groth16 verifier, so the current app cannot withdraw from them: use a build from before the PLONK switch.
- ShieldedPool (Groth16, v2): 0x213ec5ddc7aa24100ddfcc96787d4d3556431b18 (deploy tx 0xf954e49e0f403ee626684b60666e378f2a4531f5a003f3bff192bca86e264565, block 69873014). Has `depositMany` (up to 10 notes per transaction).
- ShieldedPool v1 (legacy, still works for withdrawals): 0xfb73fe8487910611af9039bf0b72eba0a15770b5 (block 69744668). To withdraw notes still sitting there, temporarily point VITE_POOL_ADDRESS / VITE_POOL_DEPLOY_BLOCK (and POOL_ADDRESS in wrangler.jsonc) at it.
- Groth16Verifier (old pools): 0x90176135a31f01bee989a679f9374137a521edc7
- PoseidonT3 (old pools; standalone hasher, called through an interface): 0x621aed2e8b983736795acb5dc87d9cae07d1a0d8
- Denominations (USDC, 6 decimals): v2 has 0.10, 1, 10, 100, 1000 (v1 had 0.10, 1, 10). They are fixed at deploy time. Owner (can only pause deposits): platform deployer wallet.
- Pool address and deploy block live in `.env` as VITE_POOL_ADDRESS and VITE_POOL_DEPLOY_BLOCK.

## Architecture
- Recipient-bound notes: commitment = Poseidon(ownerPub, secret); nullifier = Poseidon(ownerPriv, commitment). The sender cannot spend or detect spending.
- Circuit `circuits/withdraw.circom` (depth 20). Public signals order: root, nullifierHash, recipient, relayer, fee.
- Proof system: PLONK from the public Hermez Powers of Tau (`powersOfTau28_hez_final_16.ptau`, BLAKE2b pinned in the script). No ceremony and no secret: `bun run zk:setup -- --check` (scripts/zk-setup-plonk.sh, needs `.tools/circom` 2.2.2) is deterministic and must reproduce zkey sha256 5488f3d43ecdeead27b737b1f262c3f1830666c3a5ca088d19a1c2be816a9410. It writes contracts/Verifier.sol (PlonkVerifier), public/zk/ (wasm, the zkey in two parts because Cloudflare serves files up to 25 MiB), and src/lib/zk-artifacts.ts (pinned hashes the browser checks). Changing the circuit means new keys, a new verifier and a new pool. The proof is `uint256[24]`; verification costs about 271k gas, a withdrawal about 0.40M, a batch about 0.32M per note.
- Tests: `forge test` (Foundry in ~/.foundry/bin), including contracts/test/PlonkVerifier.t.sol with a real proof. `bash scripts/rehearse-local.sh` runs the whole flow (deploy script, deposits, app prover, relayer single and batch, wallet batch, attacks) on a local anvil chain.
- Deploy: `DEPLOYER_PRIVATE_KEY=... bun run scripts/deploy-pool.ts --network testnet|mainnet --denoms 0.1,1,10 [--owner 0x..] [--dry-run]`. It checks the chain, USDC and Multicall3, refuses a verifier that rejects the test proof, checks the pool after deploy, and writes deployments/<network>.json plus the .env, wrangler and explorer-verification (Blockscout) commands. The key is only read from the environment, never printed.
- Client libs in `src/lib/` (keys, notes, scan, merkle, prover). Poseidon in the browser comes from poseidon-lite and matches the on-chain hasher.
- Relayer: `server/relay-core.ts` (shared), served by `server/relayer.ts` locally (`bun run relayer`, port 3001) and by the Worker in production; the app reaches it at `/api`. Needs RELAYER_PRIVATE_KEY in `.env` and a USDC balance for gas. Minimum fee 0.02 USDC (RELAYER_MIN_FEE overrides).
- snarkjs workers crash under Bun, so the end-to-end script is bundled and run with Node: `E2E_SENDER_KEY=0x... bash scripts/run-e2e.sh`.

## Decisions
- Large payments: the Send screen splits an amount into the largest allowed notes and sends them with `depositMany` in batches of 10 (one transaction per batch), up to 50 notes per payment. A 10-note batch costs roughly 8.7M gas; Arc Testnet's block gas limit is 30M.
- Withdraw all: several notes go out in one atomic transaction per batch of up to 20, through Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`, deployed on Arc Testnet) calling `aggregate3` with `allowFailure: false`. This needs no pool change: `withdraw` never reads `msg.sender`. The relayer route is `POST /relay-many`; its fee per batch is RELAYER_MIN_FEE + RELAYER_EXTRA_NOTE_FEE (default 0.01) for each note after the first, split across the batch's proofs (largest notes first). A withdrawal costs about 0.31-0.35M gas.
- Mainnet plan (owner's decisions, 2026-10-31): no audit before launch for now; the owner deploys the pool from their own wallet, which is also the pool owner (no multisig). The dev trusted setup is replaced by Path A (PLONK with a public Powers of Tau); the owner reruns `bun run zk:setup` on a second machine and confirms the zkey hash before mainnet. First mainnet pool: small note sizes only (0.10, 1, 10).
- Unaudited. Arc native privacy is on the roadmap; the app logic is kept separate so it can be swapped later.
- Withdrawals are never pausable. Pause only stops deposits.
- Never print or commit `.env`, the relayer key, or any sender key.
