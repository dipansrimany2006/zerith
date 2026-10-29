#!/usr/bin/env bash
# Development-only Groth16 setup for the withdraw circuit.
# NOT a secure ceremony: a single local contribution. Testnet use only.
set -euo pipefail
cd "$(dirname "$0")/.."

SNARK="bunx snarkjs"
mkdir -p build/circuits build/zk public/zk

.tools/circom circuits/withdraw.circom --r1cs --wasm --sym -o build/circuits -l node_modules

if [ ! -f build/zk/pot14_final.ptau ]; then
  $SNARK powersoftau new bn128 14 build/zk/pot14_0.ptau
  $SNARK powersoftau contribute build/zk/pot14_0.ptau build/zk/pot14_1.ptau --name="dev" -e="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  $SNARK powersoftau prepare phase2 build/zk/pot14_1.ptau build/zk/pot14_final.ptau
fi

$SNARK groth16 setup build/circuits/withdraw.r1cs build/zk/pot14_final.ptau build/zk/withdraw_0.zkey
$SNARK zkey contribute build/zk/withdraw_0.zkey build/zk/withdraw_final.zkey --name="dev" -e="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
$SNARK zkey export verificationkey build/zk/withdraw_final.zkey public/zk/verification_key.json
$SNARK zkey export solidityverifier build/zk/withdraw_final.zkey contracts/Verifier.sol

cp build/circuits/withdraw_js/withdraw.wasm public/zk/withdraw.wasm
cp build/zk/withdraw_final.zkey public/zk/withdraw_final.zkey
echo "zk-setup done"
