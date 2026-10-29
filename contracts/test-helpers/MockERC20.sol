// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only ERC-20 with settable decimals, open mint, and an optional transfer tax
///      (burned on wallet-to-wallet transfers) to simulate fee-on-transfer tokens.
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;
    uint256 public taxBps;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setTaxBps(uint256 bps) external {
        taxBps = bps;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (taxBps > 0 && from != address(0) && to != address(0)) {
            uint256 t = (value * taxBps) / 10_000;
            super._update(from, address(0), t);
            value -= t;
        }
        super._update(from, to, value);
    }
}
