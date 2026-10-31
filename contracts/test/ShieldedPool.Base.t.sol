// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ShieldedPool, IVerifier, IPoseidonT3} from "../ShieldedPool.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {MockVerifier} from "../test-helpers/MockVerifier.sol";

abstract contract ShieldedPoolTestBase is Test {
    uint256 internal constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    ShieldedPool internal pool;
    MockERC20 internal usdc;
    MockVerifier internal verifier;
    address internal poseidon;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal relayer = makeAddr("relayer");

    uint256[] internal denoms;

    uint256[24] internal proof;

    function setUp() public virtual {
        poseidon = deployCode("PoseidonT3.sol:PoseidonT3");
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        verifier = new MockVerifier();
        denoms.push(1e6);
        denoms.push(10e6);
        denoms.push(100e6);
        pool = new ShieldedPool(
            IERC20(address(usdc)), IVerifier(address(verifier)), IPoseidonT3(poseidon), owner, denoms
        );
        usdc.mint(alice, 1_000_000_000e6);
        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);
    }

    /// @dev Deterministic in-field, nonzero commitment.
    function _c(uint256 n) internal pure returns (bytes32) {
        return bytes32((uint256(keccak256(abi.encode("commitment", n))) % (FIELD - 1)) + 1);
    }

    function _n(uint256 n) internal pure returns (bytes32) {
        return bytes32((uint256(keccak256(abi.encode("nullifier", n))) % (FIELD - 1)) + 1);
    }

    function _deposit(uint8 idx, bytes32 commitment) internal {
        vm.prank(alice);
        pool.deposit(idx, commitment, bytes32(uint256(7)), hex"aabbcc");
    }

    function _withdraw(
        uint8 idx,
        bytes32 root,
        bytes32 nullifier,
        address recipient,
        address relayer_,
        uint256 fee
    ) internal {
        pool.withdraw(idx, proof, root, nullifier, payable(recipient), relayer_, fee);
    }

    function _hash(uint256 a, uint256 b) internal view returns (uint256) {
        return IPoseidonT3(poseidon).hash([a, b]);
    }

    /// @dev Independent reference: zeros computed directly, then the tree is built level-by-level
    ///      over the full list of leaves (no incremental filled-subtree state).
    function _refRoot(uint256[] memory leaves) internal view returns (uint256) {
        uint256[] memory z = new uint256[](21);
        for (uint256 i = 0; i < 20; ++i) {
            z[i + 1] = _hash(z[i], z[i]);
        }
        uint256[] memory layer = leaves;
        for (uint256 level = 0; level < 20; ++level) {
            uint256 len = layer.length;
            uint256 nlen = (len + 1) / 2;
            uint256[] memory next = new uint256[](nlen);
            for (uint256 i = 0; i < nlen; ++i) {
                uint256 left = layer[2 * i];
                uint256 right = (2 * i + 1 < len) ? layer[2 * i + 1] : z[level];
                next[i] = _hash(left, right);
            }
            layer = next;
        }
        return layer.length == 0 ? z[20] : layer[0];
    }
}
