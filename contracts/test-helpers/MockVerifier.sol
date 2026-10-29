// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IVerifier} from "../ShieldedPool.sol";

/// @dev verifyProof is `view`, so it cannot record calls. Instead the test pre-registers the exact
///      pubSignals it expects (setExpected); the mock returns true only if they match in order.
contract MockVerifier is IVerifier {
    bool public result = true;
    bool public checkSignals;
    uint256[5] public expected;

    function setResult(bool r) external {
        result = r;
    }

    function setExpected(uint256[5] calldata e) external {
        expected = e;
        checkSignals = true;
    }

    function verifyProof(uint[2] calldata, uint[2][2] calldata, uint[2] calldata, uint[5] calldata pubSignals)
        external
        view
        returns (bool)
    {
        if (!result) return false;
        if (checkSignals) {
            for (uint256 i = 0; i < 5; ++i) {
                if (pubSignals[i] != expected[i]) return false;
            }
        }
        return true;
    }
}
