pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

// One level of a Poseidon Merkle path.
// isRight = 0: current node is the left child. isRight = 1: current node is the right child.
template MerkleLevel() {
    signal input cur;
    signal input sibling;
    signal input isRight;
    signal output out;

    isRight * (1 - isRight) === 0;

    signal diffL;
    signal diffR;
    diffL <== isRight * (sibling - cur);
    diffR <== isRight * (cur - sibling);

    component h = Poseidon(2);
    h.inputs[0] <== cur + diffL;
    h.inputs[1] <== sibling + diffR;
    out <== h.out;
}

// Proves ownership of a recipient-bound note that sits in the pool tree.
//   ownerPub   = Poseidon(ownerPriv)
//   commitment = Poseidon(ownerPub, secret)
//   nullifier  = Poseidon(ownerPriv, commitment)
// recipient, relayer and fee are bound into the proof so nobody can swap them in flight.
template Withdraw(levels) {
    // public
    signal input root;
    signal input nullifierHash;
    signal input recipient;
    signal input relayer;
    signal input fee;

    // private
    signal input ownerPriv;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component pubHash = Poseidon(1);
    pubHash.inputs[0] <== ownerPriv;

    component commitHash = Poseidon(2);
    commitHash.inputs[0] <== pubHash.out;
    commitHash.inputs[1] <== secret;

    component nullHash = Poseidon(2);
    nullHash.inputs[0] <== ownerPriv;
    nullHash.inputs[1] <== commitHash.out;
    nullHash.out === nullifierHash;

    component levelsHash[levels];
    for (var i = 0; i < levels; i++) {
        levelsHash[i] = MerkleLevel();
        levelsHash[i].cur <== i == 0 ? commitHash.out : levelsHash[i - 1].out;
        levelsHash[i].sibling <== pathElements[i];
        levelsHash[i].isRight <== pathIndices[i];
    }
    levelsHash[levels - 1].out === root;

    // Bind the payout details to the proof (square trick, standard practice).
    signal recipientSquare;
    signal relayerSquare;
    signal feeSquare;
    recipientSquare <== recipient * recipient;
    relayerSquare <== relayer * relayer;
    feeSquare <== fee * fee;
}

component main {public [root, nullifierHash, recipient, relayer, fee]} = Withdraw(20);
