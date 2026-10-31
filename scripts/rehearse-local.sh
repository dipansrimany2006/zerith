#!/usr/bin/env bash
# Full local rehearsal of the PLONK pool: starts anvil as a stand-in Arc chain (chain ID 5042002),
# copies Multicall3 from Arc Testnet, deploys a mock USDC and the pool with scripts/deploy-pool.ts,
# then runs scripts/rehearse-local.ts. Nothing touches a real network except reading Multicall3's code.
#
# Needs: Foundry (anvil, forge, cast), and `bun run zk:setup -- --check` done once.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

# anvil development account #0: a public test key that exists only on the local chain
DEV_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
RPC=http://127.0.0.1:8545

anvil --chain-id 5042002 --gas-limit 30000000 --silent &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null' EXIT
for _ in $(seq 1 50); do cast chain-id --rpc-url $RPC >/dev/null 2>&1 && break; sleep 0.2; done

echo "Copying Multicall3 from Arc Testnet"
CODE=$(cast code 0xcA11bde05977b3631167028862bE2a173976CA11 --rpc-url https://rpc.testnet.arc.io)
cast rpc anvil_setCode 0xcA11bde05977b3631167028862bE2a173976CA11 "$CODE" --rpc-url $RPC >/dev/null

forge build >/dev/null
echo "Deploying mock USDC"
USDC=$(forge create contracts/test-helpers/MockERC20.sol:MockERC20 --rpc-url $RPC --private-key $DEV_KEY --broadcast \
  --constructor-args "USD Coin" "USDC" 6 | awk '/Deployed to:/ {print $3}')

echo "Deploying the pool with scripts/deploy-pool.ts"
DEPLOYER_PRIVATE_KEY=$DEV_KEY bun run scripts/deploy-pool.ts --network local --usdc "$USDC" --denoms 0.1,1,10

echo "Running the rehearsal"
POOL=$(python3 -c "import json;print(json.load(open('deployments/local.json'))['contracts']['ShieldedPool']['address'])")
bun build scripts/rehearse-local.ts --target=node --outfile=build/rehearse-local.mjs --external snarkjs \
  --define "import.meta.env.VITE_POOL_ADDRESS=\"$POOL\"" --define "import.meta.env.VITE_POOL_DEPLOY_BLOCK=\"0\"" --define "import.meta.env.VITE_CHAIN_ID=\"5042002\"" >/dev/null
node build/rehearse-local.mjs
