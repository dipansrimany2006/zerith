## Implementation Plan: Shielded USDC Payments

### Summary
A private USDC payment app on Arc Testnet. Senders pay into a shielded pool and recipients withdraw with a zero-knowledge proof, so the public chain cannot link sender, recipient or exact payment amount. Serves individuals, merchants and businesses, with optional auditor disclosure.

### Architecture
- Blockchain: Arc Testnet (chain ID 5042002), USDC as asset and gas. Chain facts come from src/onchain-facts.ts. Arc native privacy (Arc Privacy Sector) is not available yet, so privacy is built at the app and contract level and designed to be swappable later.
- Contract: ShieldedPool.sol. deposit(denomination, commitment, encryptedNote) pulls USDC, inserts the commitment into an incremental Merkle tree and emits the encrypted note. withdraw(proof, root, nullifierHash, recipient, relayer, fee) verifies a Groth16 proof, rejects spent nullifiers, pays recipient and relayer fee. Fixed denominations (testnet: 0.10, 1, 10 USDC), owner-set. Generated Groth16 verifier contract.
- Proofs: circom circuit (Poseidon commitment and nullifier, Merkle membership), proofs generated in-browser with snarkjs. Dev-only trusted setup, labeled in the UI.
- Relayer: small server route that submits withdrawals and takes a USDC fee, so recipients need no prior gas.
- Frontend: React + Tailwind. Screens: shielded address and viewing key, send privately (amount split into denominations), inbox (scanned notes), withdraw, disclosure export, privacy meter (pool size and limits).
- Wallet: ConnectKit, browser wallet. Shielded keys derived from a signed message; never sent anywhere.
- Honest limits shown in UI: testnet-only, unaudited, deposit/withdraw amounts and times are public, small anonymity set.

### Files to Create/Modify
1. contracts/ShieldedPool.sol - pool: deposit, withdraw, Merkle tree, nullifiers, relayer fee.
2. contracts/Verifier.sol - generated Groth16 verifier.
3. circuits/withdraw.circom - membership and nullifier circuit (artifacts in public/zk/).
4. contracts/test/ShieldedPool.t.sol - tests: double spend, bad proof, wrong denomination, fee limits.
5. src/lib/shielded-keys.ts - derive spend key, viewing key, shielded address from wallet signature.
6. src/lib/notes.ts - commitments, note encrypt/decrypt, event scanning, denomination splitting.
7. src/lib/prover.ts - browser proof generation and Merkle path building.
8. src/lib/pool-abi.ts - ABI; deployed address via VITE_ env keys.
9. src/components/SendPrivate.tsx - recipient shielded address, amount, split preview, deposits.
10. src/components/Inbox.tsx - discovered notes, balance, withdraw action.
11. src/components/Withdraw.tsx - destination, relayer fee, proof progress.
12. src/components/Disclosure.tsx - export viewing key or payment report for auditors.
13. src/components/PrivacyMeter.tsx - pool size per denomination and plain-language limits.
14. server/relayer.ts - validates and submits withdrawals (adapt to the project's server setup).
15. src/App.tsx - layout, tabs, wallet button, testnet banner.
16. src/config.ts - add ConnectKit setup using existing arcTestnet chain.

### Build Sequence
1. Confirm circom and snarkjs work in the sandbox; if not, stop and tell the user before changing design.
2. Write the circuit, run dev setup, generate verifier.
3. Write ShieldedPool.sol, compile, test, safety-check.
4. Deploy to Arc Testnet; wire address and ABI into .env.
5. Build key derivation and note encryption libraries.
6. Build send flow, then inbox scanner.
7. Build browser prover and withdraw flow.
8. Build relayer route and connect to withdraw.
9. Build disclosure export and privacy meter.
10. Polish UI, add testnet disclaimers, run end-to-end test with two wallets.

### Done When
- [ ] Wallet A sends a private payment; wallet B finds the note and withdraws to a fresh address.
- [ ] Explorer shows no direct link between A's deposit and B's withdrawal.
- [ ] Reusing a spent note is rejected; an invalid proof reverts.
- [ ] Withdrawal works with a recipient holding zero gas.
- [ ] Amounts split into allowed denominations and totals match.
- [ ] Disclosure export lets a third party verify only selected payments.
- [ ] UI states unaudited testnet software and shows pool size.
- [ ] Typecheck, lint and contract tests pass.

## Ready to build?
