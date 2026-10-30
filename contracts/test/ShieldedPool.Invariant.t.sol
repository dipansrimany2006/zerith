// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ShieldedPool} from "../ShieldedPool.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";
import {ShieldedPoolTestBase} from "./ShieldedPool.Base.t.sol";

/// @dev Drives bounded deposits/withdrawals and tracks the sum of unspent deposits.
contract ShieldedPoolHandler is Test {
    ShieldedPool public pool;
    MockERC20 public usdc;
    address public relayer = address(0xBEEF);

    uint256 public ghostUnspent;
    uint256 public counter;

    struct Note {
        uint8 idx;
        bytes32 nullifier;
        bool spent;
    }

    Note[] internal notes;

    constructor(ShieldedPool _pool, MockERC20 _usdc) {
        pool = _pool;
        usdc = _usdc;
        usdc.approve(address(_pool), type(uint256).max);
    }

    function deposit(uint256 idxSeed) external {
        uint8 idx = uint8(bound(idxSeed, 0, pool.denominationsLength() - 1));
        uint256 amount = pool.denominations(idx);
        usdc.mint(address(this), amount);
        ++counter;
        bytes32 commitment = bytes32(uint256(keccak256(abi.encode("c", counter))) % (pool.FIELD_SIZE() - 1) + 1);
        pool.deposit(idx, commitment, bytes32(counter), "");
        notes.push(Note(idx, bytes32(counter), false));
        ghostUnspent += amount;
    }

    function withdraw(uint256 noteSeed, uint256 feeSeed, address recipient) external {
        if (notes.length == 0) return;
        recipient = address(uint160(bound(uint256(uint160(recipient)), 1, type(uint160).max)));
        if (recipient == address(pool)) return;
        Note storage n = notes[bound(noteSeed, 0, notes.length - 1)];
        if (n.spent) return;
        uint256 amount = pool.denominations(n.idx);
        uint256 fee = bound(feeSeed, 0, amount);
        uint256[2] memory a;
        uint256[2][2] memory b;
        uint256[2] memory c;
        pool.withdraw(n.idx, a, b, c, pool.getLastRoot(n.idx), n.nullifier, payable(recipient), relayer, fee);
        n.spent = true;
        ghostUnspent -= amount;
    }
}

contract ShieldedPoolInvariantTest is ShieldedPoolTestBase {
    ShieldedPoolHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new ShieldedPoolHandler(pool, usdc);
        targetContract(address(handler));
    }

    /// PROPERTY: the pool's token balance always equals the sum of unspent deposits.
    /// forge-config: default.invariant.runs = 32
    /// forge-config: default.invariant.depth = 100
    function invariant_PoolBalanceEqualsUnspentDeposits() public view {
        assertEq(usdc.balanceOf(address(pool)), handler.ghostUnspent());
    }

    /// PROPERTY: every tree's leaf count never exceeds the number of deposits made.
    /// forge-config: default.invariant.runs = 32
    /// forge-config: default.invariant.depth = 100
    function invariant_LeafCountsMatchDeposits() public view {
        uint256 total;
        for (uint8 i = 0; i < 3; ++i) {
            total += pool.nextLeafIndex(i);
        }
        assertEq(total, handler.counter());
    }
}

contract ShieldedPoolFuzzTest is ShieldedPoolTestBase {
    function testFuzz_Deposit_PullsExactDenomination(uint8 idx, uint256 seed, bytes calldata ct) public {
        idx = uint8(bound(idx, 0, 2));
        bytes32 commitment = bytes32(bound(seed, 1, FIELD - 1));
        vm.assume(ct.length <= 512);
        uint256 amount = denoms[idx];
        uint256 poolBefore = usdc.balanceOf(address(pool));
        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        pool.deposit(idx, commitment, bytes32(seed), ct);

        assertEq(usdc.balanceOf(address(pool)) - poolBefore, amount);
        assertEq(aliceBefore - usdc.balanceOf(alice), amount);
        assertEq(pool.nextLeafIndex(idx), 1);
        assertTrue(pool.commitmentSeen(commitment));
    }

    function testFuzz_Deposit_RevertsOnOutOfRangeIndex(uint8 idx) public {
        idx = uint8(bound(idx, 3, 255));
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.InvalidDenominationIndex.selector);
        pool.deposit(idx, _c(1), bytes32(0), "");
    }

    function testFuzz_Deposit_RevertsOnOutOfFieldCommitment(uint256 v) public {
        v = bound(v, FIELD, type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.InvalidCommitment.selector);
        pool.deposit(0, bytes32(v), bytes32(0), "");
    }

    function testFuzz_Deposit_RevertsOnOversizedCiphertext(uint256 len) public {
        len = bound(len, 513, 4096);
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.CiphertextTooLarge.selector);
        pool.deposit(0, _c(1), bytes32(0), new bytes(len));
    }

    function testFuzz_Withdraw_SplitsDenominationBetweenRecipientAndRelayer(
        uint8 idx,
        uint256 fee,
        address recipient,
        address relayer_
    ) public {
        idx = uint8(bound(idx, 0, 2));
        vm.assume(recipient != address(0) && relayer_ != address(0) && recipient != relayer_);
        vm.assume(recipient != address(pool) && relayer_ != address(pool));
        uint256 amount = denoms[idx];
        fee = bound(fee, 0, amount);
        _deposit(idx, _c(1));

        _withdraw(idx, pool.getLastRoot(idx), _n(1), recipient, relayer_, fee);

        assertEq(usdc.balanceOf(recipient), amount - fee);
        assertEq(usdc.balanceOf(relayer_), fee);
        assertEq(usdc.balanceOf(address(pool)), 0);
    }

    function testFuzz_Withdraw_RevertsWhenFeeAboveDenomination(uint8 idx, uint256 extra) public {
        idx = uint8(bound(idx, 0, 2));
        extra = bound(extra, 1, type(uint128).max);
        _deposit(idx, _c(1));
        bytes32 root = pool.getLastRoot(idx);
        vm.expectRevert(ShieldedPool.FeeExceedsDenomination.selector);
        _withdraw(idx, root, _n(1), bob, relayer, denoms[idx] + extra);
    }
}
