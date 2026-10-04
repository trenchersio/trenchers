// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPonsV2FeeEscrow} from "../../src/pons/interfaces/ILaunchpadV2.sol";

/// @notice Pons does not publish its PonsV2FeeEscrow source (only IPonsV2FeeEscrow). This is a
///         straightforward implementation of that interface as documented in ILaunchpadV2.sol:
///         permissionless ETH credit (caller attaches the ETH), token credit pulled via transferFrom,
///         per-recipient claim. Trenchers never touches the escrow; it only has to accept fees.
contract PonsV2FeeEscrowLite is IPonsV2FeeEscrow {
    using SafeERC20 for IERC20;

    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override balanceOfToken;

    function credit(address recipient) external payable override {
        balanceOf[recipient] += msg.value;
    }

    function creditToken(address recipient, address token, uint256 amount) external override {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        balanceOfToken[recipient][token] += amount;
    }

    function claim() external override returns (uint256 amount) {
        return _claim(balanceOf[msg.sender]);
    }

    function claim(uint256 amount) external override returns (uint256) {
        return _claim(amount);
    }

    function _claim(uint256 amount) private returns (uint256) {
        balanceOf[msg.sender] -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "send");
        return amount;
    }

    function claimToken(address token) external override returns (uint256 amount) {
        amount = balanceOfToken[msg.sender][token];
        balanceOfToken[msg.sender][token] = 0;
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    function claimToken(address token, uint256 amount) external override returns (uint256) {
        balanceOfToken[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        return amount;
    }
}
