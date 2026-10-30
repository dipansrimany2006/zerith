# Zerith

Private USDC payments on Arc Testnet. Senders pay into a shared pool and recipients withdraw with a zero-knowledge proof, so the public chain cannot link a deposit to the withdrawal that spends it.

Built with [Arc Studio](https://studio.arc.io)

Testnet only and unaudited. The proof setup is for development, so do not use real funds.

## What you can do

- Create a Zerith address from your wallet (one signature, no transaction).
- Send USDC to someone's Zerith address, with an optional private memo. Amounts are made of fixed note sizes (0.10, 1, 10, 100 and 1,000 USDC). Large payments are sent in batches of up to 10 notes per transaction.
- See payments sent to you and withdraw them to any address, with or without a relayer paying the gas.
- Share a viewing key or a signed payment report with an auditor, and check a report someone gives you.
- See how large the pool is for each note size.

## Tech stack

React, TypeScript, Vite, Tailwind CSS, wagmi, viem, ConnectKit, Solidity (Foundry), circom and snarkjs (Groth16), Bun.

## Development

Prerequisites: Bun, Foundry, and the circom binary at `.tools/circom` (only needed to rebuild the circuit).

```bash
bun install
bun run dev        # app on http://localhost:5173
bun run relayer    # withdrawal relayer on port 3001 (the app reaches it at /api)
```

### Environment variables

| Name | Purpose |
| --- | --- |
| `VITE_POOL_ADDRESS` | Deployed pool contract address |
| `VITE_POOL_DEPLOY_BLOCK` | Block the pool was deployed at (where scanning starts) |
| `RELAYER_PRIVATE_KEY` | Key the relayer uses to submit withdrawals. It needs a small USDC balance for gas |
| `RELAYER_MIN_FEE` | Optional. Minimum relayer fee in USDC base units (default 20000 = 0.02 USDC) |
| `RELAYER_PORT` | Optional. Relayer port (default 3001) |
| `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS` | Optional outside Arc Studio. Used by the relayer when present, otherwise it uses the public Arc Testnet RPC |

### Build, test and check

```bash
bun run check           # lint and typecheck
bun run contracts:build # compile contracts
bun run contracts:test  # contract tests (the invariant tests take a few minutes)
bun run zk:setup        # rebuild the circuit and development proving keys
```

An end-to-end run against Arc Testnet (deposit, scan, prove, relay) is in `scripts/run-e2e.sh`. It needs a funded sender key in `E2E_SENDER_KEY` and the relayer running.

Rebuilding the circuit changes the verifier, so the pool would need to be redeployed.
