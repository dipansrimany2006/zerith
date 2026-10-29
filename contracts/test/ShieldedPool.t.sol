// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ShieldedPool, IVerifier, IPoseidonT3} from "../ShieldedPool.sol";
import {ShieldedPoolTestBase} from "./ShieldedPool.Base.t.sol";

contract ShieldedPoolTest is ShieldedPoolTestBase {
    // ------------------------------------------------------------------ constructor

    function test_Constructor_SetsState() public view {
        assertEq(address(pool.usdc()), address(usdc));
        assertEq(address(pool.verifier()), address(verifier));
        assertEq(address(pool.poseidon()), poseidon);
        assertEq(pool.owner(), owner);
        assertEq(pool.denominationsLength(), 3);
        uint256[] memory d = pool.getDenominations();
        assertEq(d[0], 1e6);
        assertEq(d[1], 10e6);
        assertEq(d[2], 100e6);
        for (uint8 i = 0; i < 3; ++i) {
            assertEq(pool.getLastRoot(i), bytes32(pool.getZeros()[20]));
            assertEq(pool.nextLeafIndex(i), 0);
        }
    }

    function test_Constructor_ZerosMatchPoseidonChain() public view {
        uint256[21] memory z = pool.getZeros();
        assertEq(z[0], 0);
        uint256 h = 0;
        for (uint256 i = 0; i < 20; ++i) {
            h = _hash(h, h);
            assertEq(z[i + 1], h);
        }
        // circomlib Poseidon([0,0])
        assertEq(z[1], 0x2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864);
    }

    function test_Constructor_RevertsOnZeroAddresses() public {
        IERC20 u = IERC20(address(usdc));
        IVerifier v = IVerifier(address(verifier));
        IPoseidonT3 p = IPoseidonT3(poseidon);
        vm.expectRevert(ShieldedPool.ZeroAddress.selector);
        new ShieldedPool(IERC20(address(0)), v, p, owner, denoms);
        vm.expectRevert(ShieldedPool.ZeroAddress.selector);
        new ShieldedPool(u, IVerifier(address(0)), p, owner, denoms);
        vm.expectRevert(ShieldedPool.ZeroAddress.selector);
        new ShieldedPool(u, v, IPoseidonT3(address(0)), owner, denoms);
        // OZ Ownable rejects a zero owner before our own check runs
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new ShieldedPool(u, v, p, address(0), denoms);
    }

    function test_Constructor_RevertsOnBadDenominations() public {
        IERC20 u = IERC20(address(usdc));
        IVerifier v = IVerifier(address(verifier));
        IPoseidonT3 p = IPoseidonT3(poseidon);
        uint256[] memory empty = new uint256[](0);
        vm.expectRevert(ShieldedPool.InvalidDenominationsLength.selector);
        new ShieldedPool(u, v, p, owner, empty);

        uint256[] memory nine = new uint256[](9);
        for (uint256 i = 0; i < 9; ++i) nine[i] = i + 1;
        vm.expectRevert(ShieldedPool.InvalidDenominationsLength.selector);
        new ShieldedPool(u, v, p, owner, nine);

        uint256[] memory zero = new uint256[](2);
        zero[0] = 1;
        vm.expectRevert(ShieldedPool.ZeroDenomination.selector);
        new ShieldedPool(u, v, p, owner, zero);

        uint256[] memory dup = new uint256[](2);
        dup[0] = 5;
        dup[1] = 5;
        vm.expectRevert(ShieldedPool.DuplicateDenomination.selector);
        new ShieldedPool(u, v, p, owner, dup);
    }

    // ------------------------------------------------------------------ deposit

    function test_Deposit_HappyPath_StateAndBalanceDelta() public {
        uint256 poolBefore = usdc.balanceOf(address(pool));
        uint256 aliceBefore = usdc.balanceOf(alice);
        bytes32 rootBefore = pool.getLastRoot(1);

        _deposit(1, _c(1));

        assertEq(usdc.balanceOf(address(pool)) - poolBefore, 10e6);
        assertEq(aliceBefore - usdc.balanceOf(alice), 10e6);
        assertTrue(pool.commitmentSeen(_c(1)));
        assertEq(pool.nextLeafIndex(1), 1);
        assertEq(pool.nextLeafIndex(0), 0, "other trees untouched");
        assertTrue(pool.getLastRoot(1) != rootBefore);
        assertTrue(pool.isKnownRoot(1, pool.getLastRoot(1)));
        assertTrue(pool.isKnownRoot(1, rootBefore), "previous root retained");
    }

    function test_Deposit_EmitsEvent() public {
        bytes memory ct = hex"deadbeef";
        vm.warp(1_700_000_000);
        vm.expectEmit(true, true, false, true, address(pool));
        emit ShieldedPool.Deposit(2, _c(5), 0, 1_700_000_000, bytes32(uint256(99)), ct);
        vm.prank(alice);
        pool.deposit(2, _c(5), bytes32(uint256(99)), ct);

        vm.expectEmit(true, true, false, true, address(pool));
        emit ShieldedPool.Deposit(2, _c(6), 1, 1_700_000_000, bytes32(uint256(98)), ct);
        vm.prank(alice);
        pool.deposit(2, _c(6), bytes32(uint256(98)), ct);
    }

    function test_Deposit_EmptyAndMaxCiphertextAllowed() public {
        vm.prank(alice);
        pool.deposit(0, _c(1), bytes32(0), "");
        vm.prank(alice);
        pool.deposit(0, _c(2), bytes32(0), new bytes(512));
        assertEq(pool.nextLeafIndex(0), 2);
    }

    function test_Deposit_RevertsOnDuplicateCommitment() public {
        _deposit(0, _c(1));
        vm.expectRevert(ShieldedPool.CommitmentAlreadySeen.selector);
        _deposit(0, _c(1));
        // duplicates are global across denominations
        vm.expectRevert(ShieldedPool.CommitmentAlreadySeen.selector);
        _deposit(1, _c(1));
    }

    function test_Deposit_RevertsOnZeroCommitment() public {
        vm.expectRevert(ShieldedPool.InvalidCommitment.selector);
        _deposit(0, bytes32(0));
    }

    function test_Deposit_RevertsOnCommitmentAtOrAboveField() public {
        vm.expectRevert(ShieldedPool.InvalidCommitment.selector);
        _deposit(0, bytes32(FIELD));
        vm.expectRevert(ShieldedPool.InvalidCommitment.selector);
        _deposit(0, bytes32(type(uint256).max));
        // FIELD - 1 is the largest valid value
        _deposit(0, bytes32(FIELD - 1));
        assertEq(pool.nextLeafIndex(0), 1);
    }

    function test_Deposit_RevertsOnBadDenominationIndex() public {
        vm.expectRevert(ShieldedPool.InvalidDenominationIndex.selector);
        _deposit(3, _c(1));
        vm.expectRevert(ShieldedPool.InvalidDenominationIndex.selector);
        _deposit(255, _c(1));
    }

    function test_Deposit_RevertsOnCiphertextTooLarge() public {
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.CiphertextTooLarge.selector);
        pool.deposit(0, _c(1), bytes32(0), new bytes(513));
    }

    function test_Deposit_RevertsWithoutAllowanceOrBalance() public {
        vm.prank(bob);
        vm.expectRevert();
        pool.deposit(0, _c(1), bytes32(0), "");
        // failed deposit must not mark the commitment
        assertFalse(pool.commitmentSeen(_c(1)));
        assertEq(pool.nextLeafIndex(0), 0);
    }

    function test_Deposit_RevertsOnFeeOnTransferToken() public {
        usdc.setTaxBps(100);
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.IncorrectDepositAmount.selector);
        pool.deposit(0, _c(1), bytes32(0), "");
        assertFalse(pool.commitmentSeen(_c(1)));
        assertEq(usdc.balanceOf(address(pool)), 0);
    }

    function test_Deposit_RevertsWhenPaused() public {
        vm.prank(owner);
        pool.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        _deposit(0, _c(1));
        vm.prank(owner);
        pool.unpause();
        _deposit(0, _c(1));
        assertEq(pool.nextLeafIndex(0), 1);
    }

    function test_Deposit_RevertsWhenTreeFull() public {
        // _trees is at storage slot 26; nextIndex is the uint32 at offset 0 of struct slot 50.
        bytes32 base = keccak256(abi.encode(uint256(0), uint256(26)));
        vm.store(address(pool), bytes32(uint256(base) + 50), bytes32(uint256(1 << 20)));
        assertEq(pool.nextLeafIndex(0), 1 << 20);
        vm.expectRevert(ShieldedPool.TreeFull.selector);
        _deposit(0, _c(1));
    }

    // ------------------------------------------------------------------ merkle tree

    function test_Tree_RootMatchesReferenceAfterNInserts() public {
        uint256 n = 7;
        uint256[] memory leaves = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            leaves[i] = uint256(_c(100 + i));
            _deposit(1, bytes32(leaves[i]));
            uint256[] memory part = new uint256[](i + 1);
            for (uint256 j = 0; j <= i; ++j) part[j] = leaves[j];
            assertEq(uint256(pool.getLastRoot(1)), _refRoot(part), "root after insert");
            assertEq(pool.nextLeafIndex(1), i + 1);
        }
        // empty tree reference
        assertEq(uint256(pool.getLastRoot(0)), _refRoot(new uint256[](0)));
    }

    function test_Tree_DenominationsHaveIndependentTrees() public {
        _deposit(0, _c(1));
        _deposit(1, _c(1 + 1000));
        uint256[] memory a = new uint256[](1);
        a[0] = uint256(_c(1));
        uint256[] memory b = new uint256[](1);
        b[0] = uint256(_c(1001));
        assertEq(uint256(pool.getLastRoot(0)), _refRoot(a));
        assertEq(uint256(pool.getLastRoot(1)), _refRoot(b));
        assertEq(pool.nextLeafIndex(2), 0);
        // root of tree 0 is not valid in tree 1
        assertFalse(pool.isKnownRoot(1, pool.getLastRoot(0)));
    }

    function test_IsKnownRoot_ZeroAndRandomFalse() public {
        assertFalse(pool.isKnownRoot(0, bytes32(0)));
        assertFalse(pool.isKnownRoot(0, bytes32(uint256(1234))));
        assertTrue(pool.isKnownRoot(0, pool.getLastRoot(0)), "empty root known initially");
    }

    function test_IsKnownRoot_RevertsOnBadIndex() public {
        vm.expectRevert(ShieldedPool.InvalidDenominationIndex.selector);
        pool.isKnownRoot(3, bytes32(uint256(1)));
        vm.expectRevert(ShieldedPool.InvalidDenominationIndex.selector);
        pool.getLastRoot(3);
        vm.expectRevert(ShieldedPool.InvalidDenominationIndex.selector);
        pool.nextLeafIndex(3);
    }

    function test_RootHistory_Retains30AndEvictsOlder() public {
        bytes32 emptyRoot = pool.getLastRoot(0);
        _deposit(0, _c(0));
        bytes32 root1 = pool.getLastRoot(0);
        bytes32 root2;
        for (uint256 i = 1; i < 29; ++i) {
            _deposit(0, _c(i));
            if (i == 1) root2 = pool.getLastRoot(0);
        }
        // 29 inserts so far: empty root + 29 roots = 30 retained
        assertTrue(pool.isKnownRoot(0, emptyRoot), "empty root retained after 29");
        _deposit(0, _c(29)); // 30th insert evicts the empty root
        assertFalse(pool.isKnownRoot(0, emptyRoot), "empty root evicted after 30");
        assertTrue(pool.isKnownRoot(0, root1), "root1 retained after 30");
        _deposit(0, _c(30)); // 31st insert evicts root1
        assertFalse(pool.isKnownRoot(0, root1), "root1 evicted after 31");
        assertTrue(pool.isKnownRoot(0, root2), "root2 still retained");
        assertTrue(pool.isKnownRoot(0, pool.getLastRoot(0)));
    }

    // ------------------------------------------------------------------ withdraw

    function _fund(uint8 idx, uint256 n) internal returns (bytes32 root) {
        for (uint256 i = 0; i < n; ++i) {
            _deposit(idx, _c(i + 1));
        }
        root = pool.getLastRoot(idx);
    }

    function test_Withdraw_HappyPath_NoFee() public {
        bytes32 root = _fund(1, 1);
        uint256 poolBefore = usdc.balanceOf(address(pool));
        vm.expectEmit(true, true, false, true, address(pool));
        emit ShieldedPool.Withdrawal(1, bob, _n(1), address(0), 0);
        _withdraw(1, root, _n(1), bob, address(0), 0);
        assertEq(usdc.balanceOf(bob), 10e6);
        assertEq(poolBefore - usdc.balanceOf(address(pool)), 10e6);
        assertTrue(pool.spent(_n(1)));
    }

    function test_Withdraw_HappyPath_WithFee() public {
        bytes32 root = _fund(1, 1);
        uint256 fee = 2e6;
        vm.expectEmit(true, true, false, true, address(pool));
        emit ShieldedPool.Withdrawal(1, bob, _n(1), relayer, fee);
        _withdraw(1, root, _n(1), bob, relayer, fee);
        assertEq(usdc.balanceOf(bob), 10e6 - fee);
        assertEq(usdc.balanceOf(relayer), fee);
        assertEq(usdc.balanceOf(address(pool)), 0);
    }

    function test_Withdraw_FeeEqualToDenominationAllowed() public {
        bytes32 root = _fund(0, 1);
        _withdraw(0, root, _n(1), bob, relayer, 1e6);
        assertEq(usdc.balanceOf(bob), 0);
        assertEq(usdc.balanceOf(relayer), 1e6);
    }

    function test_Withdraw_WorksWhilePaused() public {
        bytes32 root = _fund(1, 1);
        vm.prank(owner);
        pool.pause();
        _withdraw(1, root, _n(1), bob, relayer, 1e6);
        assertEq(usdc.balanceOf(bob), 9e6);
        assertEq(usdc.balanceOf(relayer), 1e6);
    }

    function test_Withdraw_AnyRetainedRootAccepted() public {
        bytes32 oldRoot = _fund(0, 1);
        _deposit(0, _c(50));
        _deposit(0, _c(51));
        _withdraw(0, oldRoot, _n(1), bob, address(0), 0);
        assertEq(usdc.balanceOf(bob), 1e6);
    }

    function test_Withdraw_RevertsOnDoubleSpend() public {
        bytes32 root = _fund(0, 2);
        _withdraw(0, root, _n(1), bob, address(0), 0);
        vm.expectRevert(ShieldedPool.NullifierAlreadySpent.selector);
        _withdraw(0, root, _n(1), alice, address(0), 0);
        // nullifiers are global across denominations
        _deposit(1, _c(77));
        bytes32 root1 = pool.getLastRoot(1);
        vm.expectRevert(ShieldedPool.NullifierAlreadySpent.selector);
        _withdraw(1, root1, _n(1), bob, address(0), 0);
    }

    function test_Withdraw_RevertsOnUnknownRoot() public {
        _fund(0, 1);
        vm.expectRevert(ShieldedPool.UnknownRoot.selector);
        _withdraw(0, bytes32(uint256(12345)), _n(1), bob, address(0), 0);
        vm.expectRevert(ShieldedPool.UnknownRoot.selector);
        _withdraw(0, bytes32(0), _n(1), bob, address(0), 0);
        // a root from a different denomination tree is unknown here
        _deposit(1, _c(90));
        bytes32 otherRoot = pool.getLastRoot(1);
        vm.expectRevert(ShieldedPool.UnknownRoot.selector);
        _withdraw(0, otherRoot, _n(1), bob, address(0), 0);
    }

    function test_Withdraw_RevertsOnStaleRootAfterMoreThan30Inserts() public {
        _deposit(0, _c(0));
        bytes32 staleRoot = pool.getLastRoot(0);
        for (uint256 i = 1; i <= 30; ++i) {
            _deposit(0, _c(i));
        }
        vm.expectRevert(ShieldedPool.UnknownRoot.selector);
        _withdraw(0, staleRoot, _n(1), bob, address(0), 0);
        // the latest root still works
        _withdraw(0, pool.getLastRoot(0), _n(1), bob, address(0), 0);
        assertEq(usdc.balanceOf(bob), 1e6);
    }

    function test_Withdraw_RevertsOnRootNotInField() public {
        _fund(0, 1);
        vm.expectRevert(ShieldedPool.RootNotInField.selector);
        _withdraw(0, bytes32(FIELD), _n(1), bob, address(0), 0);
    }

    function test_Withdraw_RevertsOnNullifierNotInField() public {
        bytes32 root = _fund(0, 1);
        vm.expectRevert(ShieldedPool.NullifierNotInField.selector);
        _withdraw(0, root, bytes32(FIELD), bob, address(0), 0);
    }

    function test_Withdraw_RevertsOnFeeAboveDenomination() public {
        bytes32 root = _fund(0, 1);
        vm.expectRevert(ShieldedPool.FeeExceedsDenomination.selector);
        _withdraw(0, root, _n(1), bob, relayer, 1e6 + 1);
    }

    function test_Withdraw_RevertsOnZeroRecipient() public {
        bytes32 root = _fund(0, 1);
        vm.expectRevert(ShieldedPool.InvalidRecipient.selector);
        _withdraw(0, root, _n(1), address(0), address(0), 0);
    }

    function test_Withdraw_RevertsOnFeeWithZeroRelayer() public {
        bytes32 root = _fund(0, 1);
        vm.expectRevert(ShieldedPool.InvalidRelayer.selector);
        _withdraw(0, root, _n(1), bob, address(0), 1);
    }

    function test_Withdraw_RevertsOnInvalidProof() public {
        bytes32 root = _fund(0, 1);
        verifier.setResult(false);
        vm.expectRevert(ShieldedPool.InvalidProof.selector);
        _withdraw(0, root, _n(1), bob, address(0), 0);
        assertFalse(pool.spent(_n(1)));
        verifier.setResult(true);
        _withdraw(0, root, _n(1), bob, address(0), 0);
    }

    function test_Withdraw_RevertsOnBadDenominationIndex() public {
        vm.expectRevert(ShieldedPool.InvalidDenominationIndex.selector);
        _withdraw(3, bytes32(uint256(1)), _n(1), bob, address(0), 0);
    }

    function test_Withdraw_PublicSignalsOrderAndProofForwarded() public {
        bytes32 root = _fund(1, 1);
        uint256 fee = 3e6;
        pA = [uint256(11), 12];
        pB = [[uint256(21), 22], [uint256(23), 24]];
        pC = [uint256(31), 32];
        uint256[5] memory sig = [uint256(root), uint256(_n(1)), uint256(uint160(bob)), uint256(uint160(relayer)), fee];

        // exact calldata the verifier must receive
        vm.expectCall(address(verifier), abi.encodeCall(IVerifier.verifyProof, (pA, pB, pC, sig)));
        verifier.setExpected(sig);
        _withdraw(1, root, _n(1), bob, relayer, fee);
        assertEq(usdc.balanceOf(bob), 10e6 - fee);
    }

    function test_Withdraw_WrongSignalOrderRejectedByVerifier() public {
        bytes32 root = _fund(1, 1);
        // swapped recipient/relayer order is NOT what the pool sends -> mock rejects
        verifier.setExpected([uint256(root), uint256(_n(1)), uint256(uint160(relayer)), uint256(uint160(bob)), 1e6]);
        vm.expectRevert(ShieldedPool.InvalidProof.selector);
        _withdraw(1, root, _n(1), bob, relayer, 1e6);
    }

    // ------------------------------------------------------------------ ownership / pause

    function test_Pause_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.pause();
        vm.prank(owner);
        pool.pause();
        assertTrue(pool.paused());
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.unpause();
        vm.prank(owner);
        pool.unpause();
        assertFalse(pool.paused());
    }

    function test_Pause_EmitsEvents() public {
        vm.expectEmit(false, false, false, true, address(pool));
        emit Pausable.Paused(owner);
        vm.prank(owner);
        pool.pause();
        vm.expectEmit(false, false, false, true, address(pool));
        emit Pausable.Unpaused(owner);
        vm.prank(owner);
        pool.unpause();
    }

    function test_Ownership_TwoStepTransfer() public {
        vm.prank(owner);
        pool.transferOwnership(bob);
        assertEq(pool.owner(), owner, "owner unchanged until accept");
        assertEq(pool.pendingOwner(), bob);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.acceptOwnership();

        vm.prank(bob);
        pool.acceptOwnership();
        assertEq(pool.owner(), bob);
        assertEq(pool.pendingOwner(), address(0));

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        pool.pause();
        vm.prank(bob);
        pool.pause();
    }

    function test_Ownership_TransferOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.transferOwnership(alice);
    }

    function test_RenounceOwnership_AlwaysReverts() public {
        vm.prank(owner);
        vm.expectRevert(ShieldedPool.OwnershipRenunciationDisabled.selector);
        pool.renounceOwnership();
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.OwnershipRenunciationDisabled.selector);
        pool.renounceOwnership();
        assertEq(pool.owner(), owner);
    }
}
