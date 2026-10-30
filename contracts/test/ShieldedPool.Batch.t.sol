// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {console2, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ShieldedPool, IVerifier, IPoseidonT3} from "../ShieldedPool.sol";
import {ShieldedPoolTestBase} from "./ShieldedPool.Base.t.sol";

contract ShieldedPoolBatchTest is ShieldedPoolTestBase {
    uint256 internal constant SEED = 5000;

    struct Snap {
        uint256 poolBal;
        uint256 aliceBal;
        uint32[3] next;
        bytes32[3] roots;
    }

    // ------------------------------------------------------------------ helpers

    function _mk(uint256 nI, uint256 nC, uint256 nE, uint256 nCt)
        internal
        pure
        returns (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts)
    {
        di = new uint8[](nI);
        cs = new bytes32[](nC);
        es = new bytes32[](nE);
        cts = new bytes[](nCt);
        for (uint256 i = 0; i < nI; ++i) di[i] = uint8(i % 3);
        for (uint256 i = 0; i < nC; ++i) cs[i] = _c(SEED + i);
        for (uint256 i = 0; i < nE; ++i) es[i] = bytes32(uint256(1000 + i));
        for (uint256 i = 0; i < nCt; ++i) cts[i] = abi.encodePacked("ct", uint8(i));
    }

    function _batch(uint256 n)
        internal
        pure
        returns (uint8[] memory, bytes32[] memory, bytes32[] memory, bytes[] memory)
    {
        return _mk(n, n, n, n);
    }

    function _sum(uint8[] memory di) internal view returns (uint256 total) {
        for (uint256 i = 0; i < di.length; ++i) total += denoms[di[i]];
    }

    function _snap() internal view returns (Snap memory s) {
        s.poolBal = usdc.balanceOf(address(pool));
        s.aliceBal = usdc.balanceOf(alice);
        for (uint8 i = 0; i < 3; ++i) {
            s.next[i] = pool.nextLeafIndex(i);
            s.roots[i] = pool.getLastRoot(i);
        }
    }

    function _assertSame(Snap memory s, bytes32[] memory cs) internal view {
        Snap memory t = _snap();
        assertEq(t.poolBal, s.poolBal, "pool balance changed");
        assertEq(t.aliceBal, s.aliceBal, "alice balance changed");
        for (uint8 i = 0; i < 3; ++i) {
            assertEq(t.next[i], s.next[i], "leaf index changed");
            assertEq(t.roots[i], s.roots[i], "root changed");
        }
        // Only commitments that were not seen before the call must still be unseen.
        for (uint256 i = 0; i < cs.length; ++i) {
            if (cs[i] != _c(SEED - 1)) assertFalse(pool.commitmentSeen(cs[i]), "commitment marked");
        }
    }

    function _depositMany(uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) internal {
        vm.prank(alice);
        pool.depositMany(di, cs, es, cts);
    }

    /// @dev Calls depositMany expecting `sel`, then asserts no state or balance changed.
    function _expectAtomicRevert(
        bytes4 sel,
        uint8[] memory di,
        bytes32[] memory cs,
        bytes32[] memory es,
        bytes[] memory cts
    ) internal {
        Snap memory s = _snap();
        vm.prank(alice);
        vm.expectRevert(sel);
        pool.depositMany(di, cs, es, cts);
        _assertSame(s, cs);
    }

    function _leaves(uint8[] memory di, bytes32[] memory cs, uint8 tree) internal pure returns (uint256[] memory out) {
        uint256 n;
        for (uint256 i = 0; i < di.length; ++i) if (di[i] == tree) ++n;
        out = new uint256[](n);
        uint256 k;
        for (uint256 i = 0; i < di.length; ++i) {
            if (di[i] == tree) out[k++] = uint256(cs[i]);
        }
    }

    function _prefix(uint256[] memory a, uint256 len) internal pure returns (uint256[] memory out) {
        out = new uint256[](len);
        for (uint256 i = 0; i < len; ++i) out[i] = a[i];
    }

    // ------------------------------------------------------------------ constant

    function test_MaxBatch_IsTen() public view {
        assertEq(pool.MAX_BATCH(), 10);
    }

    // ------------------------------------------------------------------ happy paths

    function test_DepositMany_BatchOfOne() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(1);
        uint256 poolBefore = usdc.balanceOf(address(pool));
        uint256 aliceBefore = usdc.balanceOf(alice);
        _depositMany(di, cs, es, cts);
        assertEq(usdc.balanceOf(address(pool)) - poolBefore, denoms[0]);
        assertEq(aliceBefore - usdc.balanceOf(alice), denoms[0]);
        assertEq(pool.nextLeafIndex(0), 1);
        assertTrue(pool.commitmentSeen(cs[0]));
    }

    function test_DepositMany_BatchOfMaxBatch() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(pool.MAX_BATCH());
        uint256 total = _sum(di);
        uint256 poolBefore = usdc.balanceOf(address(pool));
        uint256 aliceBefore = usdc.balanceOf(alice);
        _depositMany(di, cs, es, cts);
        assertEq(usdc.balanceOf(address(pool)) - poolBefore, total);
        assertEq(aliceBefore - usdc.balanceOf(alice), total);
        for (uint256 i = 0; i < cs.length; ++i) assertTrue(pool.commitmentSeen(cs[i]));
        assertEq(uint256(pool.nextLeafIndex(0)) + pool.nextLeafIndex(1) + pool.nextLeafIndex(2), 10);
    }

    function test_DepositMany_PullsSummedAmountInSingleTransfer() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(10);
        uint256 total = _sum(di); // 4*1e6 + 3*10e6 + 3*100e6
        assertEq(total, 4e6 + 30e6 + 300e6);
        vm.expectCall(address(usdc), abi.encodeCall(IERC20.transferFrom, (alice, address(pool), total)), 1);
        vm.recordLogs();
        _depositMany(di, cs, es, cts);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 transfers;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter == address(usdc) && logs[i].topics[0] == IERC20.Transfer.selector) {
                ++transfers;
                assertEq(address(uint160(uint256(logs[i].topics[1]))), alice);
                assertEq(address(uint160(uint256(logs[i].topics[2]))), address(pool));
                assertEq(abi.decode(logs[i].data, (uint256)), total);
            }
        }
        assertEq(transfers, 1, "exactly one token transfer");
    }

    function test_DepositMany_EmitsOneDepositPerNoteWithConsecutiveLeafIndices() public {
        // Pre-fill so leaf indices are not trivially 0.
        _deposit(0, _c(SEED - 1));
        _deposit(2, _c(SEED - 2));
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(10);
        uint256[3] memory expectedIdx = [uint256(1), 0, 1];
        vm.warp(1_700_000_000);
        vm.recordLogs();
        _depositMany(di, cs, es, cts);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 seen;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter != address(pool)) continue;
            assertEq(logs[i].topics[0], ShieldedPool.Deposit.selector);
            assertEq(uint256(logs[i].topics[1]), di[seen], "denom index topic");
            assertEq(logs[i].topics[2], cs[seen], "commitment topic");
            (uint32 leafIndex, uint256 ts, bytes32 eph, bytes memory ct) =
                abi.decode(logs[i].data, (uint32, uint256, bytes32, bytes));
            assertEq(leafIndex, expectedIdx[di[seen]], "leaf index");
            assertEq(ts, 1_700_000_000);
            assertEq(eph, es[seen]);
            assertEq(ct, cts[seen]);
            ++expectedIdx[di[seen]];
            ++seen;
        }
        assertEq(seen, 10, "one Deposit per note");
        assertEq(pool.nextLeafIndex(0), 5);
        assertEq(pool.nextLeafIndex(1), 3);
        assertEq(pool.nextLeafIndex(2), 4);
    }

    function test_DepositMany_MixedDenominationTreesAreIndependent() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(10);
        _depositMany(di, cs, es, cts);
        assertEq(pool.nextLeafIndex(0), 4);
        assertEq(pool.nextLeafIndex(1), 3);
        assertEq(pool.nextLeafIndex(2), 3);
        // A root of one tree is not a retained root in the others.
        assertFalse(pool.isKnownRoot(1, pool.getLastRoot(0)));
        assertFalse(pool.isKnownRoot(2, pool.getLastRoot(0)));
        assertFalse(pool.isKnownRoot(0, pool.getLastRoot(1)));
        // A batch touching only tree 1 leaves trees 0 and 2 untouched.
        bytes32 r0 = pool.getLastRoot(0);
        bytes32 r2 = pool.getLastRoot(2);
        uint8[] memory d1 = new uint8[](2);
        d1[0] = 1;
        d1[1] = 1;
        bytes32[] memory c1 = new bytes32[](2);
        c1[0] = _c(9001);
        c1[1] = _c(9002);
        bytes32[] memory e1 = new bytes32[](2);
        bytes[] memory t1 = new bytes[](2);
        _depositMany(d1, c1, e1, t1);
        assertEq(pool.getLastRoot(0), r0);
        assertEq(pool.getLastRoot(2), r2);
        assertEq(pool.nextLeafIndex(1), 5);
    }

    function test_DepositMany_RootsMatchReferenceTree() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(10);
        _depositMany(di, cs, es, cts);
        for (uint8 t = 0; t < 3; ++t) {
            uint256[] memory leaves = _leaves(di, cs, t);
            assertEq(uint256(pool.getLastRoot(t)), _refRoot(leaves), "final root");
            // every intermediate root produced inside the batch is retained
            for (uint256 k = 1; k <= leaves.length; ++k) {
                assertTrue(pool.isKnownRoot(t, bytes32(_refRoot(_prefix(leaves, k)))), "intermediate root");
            }
        }
    }

    function test_DepositMany_RootMatchesSequentialSingleDeposits() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(10);
        _depositMany(di, cs, es, cts);
        bytes32[3] memory batched = [pool.getLastRoot(0), pool.getLastRoot(1), pool.getLastRoot(2)];

        // fresh pool, same leaves via single deposits
        pool = new ShieldedPool(
            IERC20(address(usdc)), IVerifier(address(verifier)), IPoseidonT3(poseidon), owner, denoms
        );
        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);
        for (uint256 i = 0; i < 10; ++i) _deposit(di[i], cs[i]);
        for (uint8 t = 0; t < 3; ++t) assertEq(pool.getLastRoot(t), batched[t]);
    }

    function test_DepositMany_ThenWithdrawOneOfItsNotes() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(10);
        _depositMany(di, cs, es, cts);
        uint8 idx = di[4]; // 4 % 3 == 1 -> 10e6 tree
        assertEq(idx, 1);
        bytes32 root = pool.getLastRoot(idx);
        uint256 poolBefore = usdc.balanceOf(address(pool));
        _withdraw(idx, root, _n(1), bob, relayer, 1e6);
        assertEq(usdc.balanceOf(bob), 9e6);
        assertEq(usdc.balanceOf(relayer), 1e6);
        assertEq(poolBefore - usdc.balanceOf(address(pool)), 10e6);
        assertTrue(pool.spent(_n(1)));
    }

    // ------------------------------------------------------------------ InvalidBatch

    function test_DepositMany_RevertsOnEmptyBatch() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(0);
        _expectAtomicRevert(ShieldedPool.InvalidBatch.selector, di, cs, es, cts);
    }

    function test_DepositMany_RevertsOnBatchOfEleven() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(11);
        _expectAtomicRevert(ShieldedPool.InvalidBatch.selector, di, cs, es, cts);
    }

    function test_DepositMany_RevertsWhenDenomIndicesLengthMismatched() public {
        uint256[3] memory lens = [uint256(0), 2, 4];
        for (uint256 k = 0; k < 3; ++k) {
            (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _mk(lens[k], 3, 3, 3);
            _expectAtomicRevert(ShieldedPool.InvalidBatch.selector, di, cs, es, cts);
        }
    }

    function test_DepositMany_RevertsWhenCommitmentsLengthMismatched() public {
        uint256[3] memory lens = [uint256(0), 2, 4];
        for (uint256 k = 0; k < 3; ++k) {
            (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _mk(3, lens[k], 3, 3);
            _expectAtomicRevert(ShieldedPool.InvalidBatch.selector, di, cs, es, cts);
        }
    }

    function test_DepositMany_RevertsWhenEphemeralPubsLengthMismatched() public {
        uint256[3] memory lens = [uint256(0), 2, 4];
        for (uint256 k = 0; k < 3; ++k) {
            (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _mk(3, 3, lens[k], 3);
            _expectAtomicRevert(ShieldedPool.InvalidBatch.selector, di, cs, es, cts);
        }
    }

    function test_DepositMany_RevertsWhenCiphertextsLengthMismatched() public {
        uint256[3] memory lens = [uint256(0), 2, 4];
        for (uint256 k = 0; k < 3; ++k) {
            (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _mk(3, 3, 3, lens[k]);
            _expectAtomicRevert(ShieldedPool.InvalidBatch.selector, di, cs, es, cts);
        }
    }

    // ------------------------------------------------------------------ atomic reverts (failure mid-batch)

    function test_DepositMany_RevertsAtomicallyOnDuplicateInsideBatch() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(5);
        cs[3] = cs[1];
        _expectAtomicRevert(ShieldedPool.CommitmentAlreadySeen.selector, di, cs, es, cts);
    }

    function test_DepositMany_RevertsAtomicallyOnDuplicateInsideBatchAcrossDenominations() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(5);
        cs[4] = cs[0]; // commitments are unique globally, not per tree
        assertTrue(di[4] != di[0]);
        _expectAtomicRevert(ShieldedPool.CommitmentAlreadySeen.selector, di, cs, es, cts);
    }

    function test_DepositMany_RevertsAtomicallyOnPreviouslySeenCommitment() public {
        _deposit(0, _c(SEED - 1));
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(5);
        cs[2] = _c(SEED - 1);
        _expectAtomicRevert(ShieldedPool.CommitmentAlreadySeen.selector, di, cs, es, cts);
        assertEq(pool.nextLeafIndex(0), 1);
    }

    function test_DepositMany_RevertsAtomicallyOnZeroCommitment() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(5);
        cs[2] = bytes32(0);
        _expectAtomicRevert(ShieldedPool.InvalidCommitment.selector, di, cs, es, cts);
    }

    function test_DepositMany_RevertsAtomicallyOnCommitmentAtOrAboveField() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(5);
        cs[2] = bytes32(FIELD);
        _expectAtomicRevert(ShieldedPool.InvalidCommitment.selector, di, cs, es, cts);
        cs[2] = bytes32(type(uint256).max);
        _expectAtomicRevert(ShieldedPool.InvalidCommitment.selector, di, cs, es, cts);
        // FIELD - 1 is the largest valid commitment
        cs[2] = bytes32(FIELD - 1);
        _depositMany(di, cs, es, cts);
        assertTrue(pool.commitmentSeen(bytes32(FIELD - 1)));
    }

    function test_DepositMany_RevertsAtomicallyOnBadDenominationIndex() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(5);
        di[2] = 3;
        _expectAtomicRevert(ShieldedPool.InvalidDenominationIndex.selector, di, cs, es, cts);
        di[2] = 255;
        _expectAtomicRevert(ShieldedPool.InvalidDenominationIndex.selector, di, cs, es, cts);
    }

    function test_DepositMany_RevertsAtomicallyOnOversizeCiphertextInMiddle() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(5);
        cts[2] = new bytes(513);
        _expectAtomicRevert(ShieldedPool.CiphertextTooLarge.selector, di, cs, es, cts);
        // exactly MAX_CIPHERTEXT is accepted
        cts[2] = new bytes(512);
        _depositMany(di, cs, es, cts);
        assertEq(pool.nextLeafIndex(2), 1);
    }

    // ------------------------------------------------------------------ funds failures

    function test_DepositMany_RevertsWithInsufficientAllowance() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(10);
        uint256 total = _sum(di);
        address carol = makeAddr("carol");
        usdc.mint(carol, total);
        vm.prank(carol);
        usdc.approve(address(pool), total - 1);
        vm.prank(carol);
        vm.expectRevert();
        pool.depositMany(di, cs, es, cts);
        assertEq(usdc.balanceOf(carol), total);
        assertEq(usdc.balanceOf(address(pool)), 0);
        for (uint8 i = 0; i < 3; ++i) assertEq(pool.nextLeafIndex(i), 0);
        for (uint256 i = 0; i < cs.length; ++i) assertFalse(pool.commitmentSeen(cs[i]));
    }

    function test_DepositMany_RevertsWithInsufficientBalance() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(10);
        uint256 total = _sum(di);
        address carol = makeAddr("carol");
        usdc.mint(carol, total - 1);
        vm.prank(carol);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(carol);
        vm.expectRevert();
        pool.depositMany(di, cs, es, cts);
        assertEq(usdc.balanceOf(carol), total - 1);
        assertEq(usdc.balanceOf(address(pool)), 0);
        for (uint8 i = 0; i < 3; ++i) assertEq(pool.nextLeafIndex(i), 0);
        for (uint256 i = 0; i < cs.length; ++i) assertFalse(pool.commitmentSeen(cs[i]));
    }

    function test_DepositMany_RevertsOnFeeOnTransferToken() public {
        usdc.setTaxBps(100);
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(3);
        _expectAtomicRevert(ShieldedPool.IncorrectDepositAmount.selector, di, cs, es, cts);
    }

    // ------------------------------------------------------------------ pause

    function test_DepositMany_RevertsWhenPaused_WithdrawStillWorks() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(3);
        _depositMany(di, cs, es, cts);
        bytes32 root = pool.getLastRoot(0);

        vm.prank(owner);
        pool.pause();

        (uint8[] memory d2, bytes32[] memory c2, bytes32[] memory e2, bytes[] memory t2) = _batch(2);
        c2[0] = _c(777);
        c2[1] = _c(778);
        Snap memory s = _snap();
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.depositMany(d2, c2, e2, t2);
        _assertSame(s, c2);

        _withdraw(0, root, _n(1), bob, address(0), 0);
        assertEq(usdc.balanceOf(bob), denoms[0]);

        vm.prank(owner);
        pool.unpause();
        _depositMany(d2, c2, e2, t2);
        assertTrue(pool.commitmentSeen(c2[0]));
    }

    // ------------------------------------------------------------------ gas

    function test_DepositMany_GasForMaxBatchBelowBlockBudget() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(10);
        vm.prank(alice);
        uint256 g = gasleft();
        pool.depositMany(di, cs, es, cts);
        uint256 used = g - gasleft();
        console2.log("depositMany gas, 10 notes (short ciphertexts):", used);
        assertLt(used, 12_000_000);
    }

    function test_DepositMany_GasForMaxBatchWithMaxCiphertexts() public {
        (uint8[] memory di, bytes32[] memory cs, bytes32[] memory es, bytes[] memory cts) = _batch(10);
        for (uint256 i = 0; i < 10; ++i) cts[i] = new bytes(512);
        vm.prank(alice);
        uint256 g = gasleft();
        pool.depositMany(di, cs, es, cts);
        uint256 used = g - gasleft();
        console2.log("depositMany gas, 10 notes (512-byte ciphertexts):", used);
        assertLt(used, 12_000_000);
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzz_DepositMany_RandomBatch(uint256 n, uint256 idxSeed, uint256 cSeed) public {
        n = bound(n, 1, 10);
        uint8[] memory di = new uint8[](n);
        bytes32[] memory cs = new bytes32[](n);
        bytes32[] memory es = new bytes32[](n);
        bytes[] memory cts = new bytes[](n);
        uint256 total;
        uint256[3] memory counts;
        for (uint256 i = 0; i < n; ++i) {
            di[i] = uint8(uint256(keccak256(abi.encode(idxSeed, i))) % 3);
            cs[i] = _c(uint256(keccak256(abi.encode(cSeed, i))));
            es[i] = bytes32(uint256(keccak256(abi.encode("e", cSeed, i))));
            cts[i] = new bytes(i * 7);
            total += denoms[di[i]];
            ++counts[di[i]];
        }
        uint256 poolBefore = usdc.balanceOf(address(pool));
        uint256 aliceBefore = usdc.balanceOf(alice);

        _depositMany(di, cs, es, cts);

        assertEq(usdc.balanceOf(address(pool)) - poolBefore, total);
        assertEq(aliceBefore - usdc.balanceOf(alice), total);
        for (uint8 t = 0; t < 3; ++t) {
            assertEq(pool.nextLeafIndex(t), counts[t]);
            assertEq(uint256(pool.getLastRoot(t)), _refRoot(_leaves(di, cs, t)), "root vs reference");
        }
        for (uint256 i = 0; i < n; ++i) assertTrue(pool.commitmentSeen(cs[i]));
    }
}
