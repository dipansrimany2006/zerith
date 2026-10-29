// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Groth16 verifier for the fixed recipient-bound withdrawal circuit.
interface IVerifier {
    /// @notice Verifies public signals ordered as root, nullifier, recipient, relayer, fee.
    function verifyProof(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[5] calldata pubSignals
    ) external view returns (bool);
}

/// @notice Interface to the separately deployed, circomlib-compatible Poseidon hasher.
interface IPoseidonT3 {
    /// @notice Hashes two field elements using an external STATICCALL.
    function hash(uint256[2] memory input) external pure returns (uint256);
}

/// @title ShieldedPool
/// @notice Fixed-denomination USDC pool with recipient-bound notes and independent Merkle trees.
/// @dev Non-upgradeable. The owner can pause deposits, but cannot pause withdrawals or recover funds.
contract ShieldedPool is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant LEVELS = 20;
    uint256 public constant ROOT_HISTORY_SIZE = 30;
    uint256 public constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant MAX_CIPHERTEXT = 512;

    IERC20 public immutable usdc;
    IVerifier public immutable verifier;
    IPoseidonT3 public immutable poseidon;

    /// @notice Allowed token amounts in base units; populated only during construction.
    uint256[] public denominations;
    /// @notice Empty subtree hashes, from the empty leaf through the empty depth-20 root.
    uint256[21] public zeros;
    /// @notice Globally spent nullifier hashes, across all denominations.
    mapping(bytes32 => bool) public spent;
    /// @notice Globally deposited commitments, across all denominations.
    mapping(bytes32 => bool) public commitmentSeen;

    struct MerkleTree {
        uint256[20] filledSubtrees;
        bytes32[30] roots;
        uint32 nextIndex;
        uint32 currentRootIndex;
    }

    mapping(uint8 => MerkleTree) private _trees;

    error ZeroAddress();
    error InvalidDenominationsLength();
    error ZeroDenomination();
    error DuplicateDenomination();
    error InvalidDenominationIndex();
    error InvalidCommitment();
    error CommitmentAlreadySeen();
    error CiphertextTooLarge();
    error TreeFull();
    error IncorrectDepositAmount();
    error InvalidRecipient();
    error InvalidRelayer();
    error FeeExceedsDenomination();
    error NullifierAlreadySpent();
    error NullifierNotInField();
    error RootNotInField();
    error UnknownRoot();
    error InvalidProof();
    error OwnershipRenunciationDisabled();

    event Deposit(uint8 indexed denomIndex, bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp, bytes32 ephemeralPub, bytes ciphertext);
    event Withdrawal(uint8 indexed denomIndex, address indexed recipient, bytes32 nullifierHash, address relayer, uint256 fee);

    /// @notice Sets permanent dependencies and denominations and initializes every empty tree.
    /// @param _usdc Token held and paid by this pool.
    /// @param _verifier Verifier for the fixed withdrawal circuit.
    /// @param _poseidon Separately deployed PoseidonT3 contract; never linked as a library.
    /// @param _owner Initial owner for two-step ownership and deposit pausing.
    /// @param _denominations One to eight distinct, nonzero token amounts in base units.
    constructor(
        IERC20 _usdc,
        IVerifier _verifier,
        IPoseidonT3 _poseidon,
        address _owner,
        uint256[] memory _denominations
    ) Ownable(_owner) {
        if (
            address(_usdc) == address(0) || address(_verifier) == address(0)
                || address(_poseidon) == address(0) || _owner == address(0)
        ) revert ZeroAddress();
        uint256 length = _denominations.length;
        if (length == 0 || length > 8) revert InvalidDenominationsLength();

        usdc = _usdc;
        verifier = _verifier;
        poseidon = _poseidon;

        for (uint256 i = 0; i < length; ++i) {
            if (_denominations[i] == 0) revert ZeroDenomination();
            for (uint256 j = 0; j < i; ++j) {
                if (_denominations[i] == _denominations[j]) revert DuplicateDenomination();
            }
        }
        denominations = _denominations;

        // zeros[0] is the default zero-valued empty leaf. Pure interface calls use STATICCALL.
        for (uint256 i = 0; i < LEVELS; ++i) {
            zeros[i + 1] = _poseidon.hash([zeros[i], zeros[i]]);
        }
        for (uint256 i = 0; i < length; ++i) {
            MerkleTree storage tree = _trees[uint8(i)];
            for (uint256 level = 0; level < LEVELS; ++level) {
                tree.filledSubtrees[level] = zeros[level];
            }
            tree.roots[0] = bytes32(zeros[LEVELS]);
        }
    }

    /// @notice Deposits exactly one denomination and publishes encrypted note-delivery data.
    /// @dev Commits tree effects before pulling tokens; any token or balance-check failure rolls back all effects.
    /// @param denomIndex Index of the denomination and its independent tree.
    /// @param commitment Nonzero, globally unique note commitment in the scalar field.
    /// @param ephemeralPub Ephemeral public key for encrypted note delivery.
    /// @param ciphertext Opaque encrypted note payload, at most MAX_CIPHERTEXT bytes.
    function deposit(
        uint8 denomIndex,
        bytes32 commitment,
        bytes32 ephemeralPub,
        bytes calldata ciphertext
    ) external nonReentrant whenNotPaused {
        _checkDenominationIndex(denomIndex);
        if (commitment == bytes32(0) || uint256(commitment) >= FIELD_SIZE) revert InvalidCommitment();
        if (commitmentSeen[commitment]) revert CommitmentAlreadySeen();
        if (ciphertext.length > MAX_CIPHERTEXT) revert CiphertextTooLarge();

        commitmentSeen[commitment] = true;
        uint32 leafIndex = _insert(denomIndex, uint256(commitment));
        emit Deposit(denomIndex, commitment, leafIndex, block.timestamp, ephemeralPub, ciphertext);

        uint256 amount = denominations[denomIndex];
        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = usdc.balanceOf(address(this));
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) {
            revert IncorrectDepositAmount();
        }
    }

    /// @notice Redeems a proven note and optionally pays its proof-bound relayer fee, even while paused.
    /// @dev The proof binds the exact root, nullifier, recipient, relayer and fee in that order.
    /// @param denomIndex Denomination tree containing the note.
    /// @param a Groth16 proof A.
    /// @param b Groth16 proof B in the verifier's expected coordinate order.
    /// @param c Groth16 proof C.
    /// @param root A retained root of the selected denomination tree.
    /// @param nullifierHash Globally unique spend nullifier.
    /// @param recipient Nonzero payout address bound by the proof.
    /// @param relayer Proof-bound relayer; must be nonzero if fee is positive.
    /// @param fee Relayer payment in token base units, at most the denomination.
    function withdraw(
        uint8 denomIndex,
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        bytes32 root,
        bytes32 nullifierHash,
        address payable recipient,
        address relayer,
        uint256 fee
    ) external nonReentrant {
        _checkDenominationIndex(denomIndex);
        if (recipient == address(0)) revert InvalidRecipient();
        if (fee > denominations[denomIndex]) revert FeeExceedsDenomination();
        if (spent[nullifierHash]) revert NullifierAlreadySpent();
        if (uint256(nullifierHash) >= FIELD_SIZE) revert NullifierNotInField();
        if (uint256(root) >= FIELD_SIZE) revert RootNotInField();
        if (!isKnownRoot(denomIndex, root)) revert UnknownRoot();
        if (fee > 0 && relayer == address(0)) revert InvalidRelayer();

        uint256[5] memory signals;
        signals[0] = uint256(root);
        signals[1] = uint256(nullifierHash);
        signals[2] = uint256(uint160(address(recipient)));
        signals[3] = uint256(uint160(relayer));
        signals[4] = fee;
        if (!verifier.verifyProof(a, b, c, signals)) revert InvalidProof();

        spent[nullifierHash] = true;
        usdc.safeTransfer(recipient, denominations[denomIndex] - fee);
        if (fee > 0) usdc.safeTransfer(relayer, fee);
        emit Withdrawal(denomIndex, recipient, nullifierHash, relayer, fee);
    }

    /// @notice Returns whether a nonzero root is retained in the selected tree's root history.
    /// @dev Scans backward from the current root, wrapping around the 30-entry ring buffer.
    function isKnownRoot(uint8 denomIndex, bytes32 root) public view returns (bool) {
        _checkDenominationIndex(denomIndex);
        if (root == bytes32(0)) return false;
        MerkleTree storage tree = _trees[denomIndex];
        uint32 current = tree.currentRootIndex;
        uint32 index = current;
        do {
            if (tree.roots[index] == root) return true;
            if (index == 0) index = uint32(ROOT_HISTORY_SIZE);
            index -= 1;
        } while (index != current);
        return false;
    }

    /// @notice Returns the latest Merkle root for a valid denomination index.
    function getLastRoot(uint8 denomIndex) external view returns (bytes32) {
        _checkDenominationIndex(denomIndex);
        MerkleTree storage tree = _trees[denomIndex];
        return tree.roots[tree.currentRootIndex];
    }

    /// @notice Returns the next insertion index, or 2**20 when the selected tree is full.
    function nextLeafIndex(uint8 denomIndex) external view returns (uint32) {
        _checkDenominationIndex(denomIndex);
        return _trees[denomIndex].nextIndex;
    }

    /// @notice Returns the number of permanently configured denominations.
    function denominationsLength() external view returns (uint256) {
        return denominations.length;
    }

    /// @notice Returns every denomination in token base units, in constructor order.
    function getDenominations() external view returns (uint256[] memory) {
        return denominations;
    }

    /// @notice Returns all empty subtree hashes, including the empty depth-20 root.
    function getZeros() external view returns (uint256[21] memory) {
        return zeros;
    }

    /// @notice Pauses deposits only; withdrawals remain available.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes deposits.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Always reverts: ownership can be transferred in two steps but never renounced.
    function renounceOwnership() public pure override {
        revert OwnershipRenunciationDisabled();
    }

    function _checkDenominationIndex(uint8 denomIndex) private view {
        if (uint256(denomIndex) >= denominations.length) revert InvalidDenominationIndex();
    }

    function _insert(uint8 denomIndex, uint256 leaf) private returns (uint32 leafIndex) {
        MerkleTree storage tree = _trees[denomIndex];
        leafIndex = tree.nextIndex;
        if (uint256(leafIndex) == 2 ** LEVELS) revert TreeFull();

        uint256 currentIndex = leafIndex;
        uint256 currentHash = leaf;
        for (uint256 level = 0; level < LEVELS; ++level) {
            if (currentIndex % 2 == 0) {
                tree.filledSubtrees[level] = currentHash;
                currentHash = poseidon.hash([currentHash, zeros[level]]);
            } else {
                currentHash = poseidon.hash([tree.filledSubtrees[level], currentHash]);
            }
            currentIndex /= 2;
        }

        uint32 newRootIndex = uint32((uint256(tree.currentRootIndex) + 1) % ROOT_HISTORY_SIZE);
        tree.currentRootIndex = newRootIndex;
        tree.roots[newRootIndex] = bytes32(currentHash);
        tree.nextIndex = leafIndex + 1;
    }
}
