#!/usr/bin/env bash
# Bundles scripts/e2e.ts for Node (snarkjs workers do not run under Bun) and runs it.
# Usage: E2E_SENDER_KEY=0x... bash scripts/run-e2e.sh
set -euo pipefail
cd "$(dirname "$0")/.."
POOL=$(grep -E '^VITE_POOL_ADDRESS=' .env | cut -d= -f2)
BLOCK=$(grep -E '^VITE_POOL_DEPLOY_BLOCK=' .env | cut -d= -f2)
bun build scripts/e2e.ts --target=node --outfile=build/e2e.mjs --external snarkjs \
  --define "import.meta.env.VITE_POOL_ADDRESS=\"$POOL\"" \
  --define "import.meta.env.VITE_POOL_DEPLOY_BLOCK=\"$BLOCK\""
node build/e2e.mjs
