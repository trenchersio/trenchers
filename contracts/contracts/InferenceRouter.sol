// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IPonsAdapterBuy {
    function buy(address token, uint256 minTokensOut) external payable returns (uint256 tokensOut);
}

/// @title InferenceRouter
/// @notice Pay for Trenchers Inference Markets credit in ETH, in one transaction: the ETH buys $TRENCHERS through
///         the Trenchers Pons adapter (bonding curve before graduation, Uniswap v4 pool after), and every token
///         bought goes straight to the inference desk. The desk credits the buyer named in CreditBought.
///         Holds nothing between calls and has no owner: the adapter, the token and the desk are fixed for good.
contract InferenceRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IPonsAdapterBuy public immutable adapter;
    IERC20 public immutable token;
    /// @notice The inference desk's deposit address. Every token this router buys ends up here.
    address public immutable desk;

    event CreditBought(address indexed buyer, uint256 ethIn, uint256 tokensOut);

    error ZeroAddress();
    error ZeroAmount();
    error Slippage();
    error RefundFailed();
    error NotAdapter();

    constructor(IPonsAdapterBuy adapter_, IERC20 token_, address desk_) {
        if (address(adapter_) == address(0) || address(token_) == address(0) || desk_ == address(0)) revert ZeroAddress();
        adapter = adapter_;
        token = token_;
        desk = desk_;
    }

    /// @notice Buys $TRENCHERS with all the ETH sent and delivers it to the desk. Unspent ETH (a curve that
    ///         sells out mid-buy refunds the rest) goes back to the caller.
    /// @param minTokensOut the fewest tokens to accept; the whole call reverts below it.
    /// @param beneficiary the wallet the desk credits (zero: the caller). Lets a smart wallet buy for its owner.
    function buyCredit(uint256 minTokensOut, address beneficiary) external payable nonReentrant returns (uint256 tokensOut) {
        if (msg.value == 0) revert ZeroAmount();
        uint256 ethBefore = address(this).balance - msg.value;
        uint256 before = token.balanceOf(address(this));
        adapter.buy{value: msg.value}(address(token), minTokensOut);
        tokensOut = token.balanceOf(address(this)) - before;
        if (tokensOut == 0 || tokensOut < minTokensOut) revert Slippage();
        token.safeTransfer(desk, tokensOut);
        uint256 refund = address(this).balance - ethBefore;
        if (refund > 0) {
            (bool ok, ) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundFailed();
        }
        emit CreditBought(beneficiary == address(0) ? msg.sender : beneficiary, msg.value - refund, tokensOut);
    }

    /// @dev Only the adapter sends ETH here (a partial-fill refund, forwarded in the same call).
    receive() external payable {
        if (msg.sender != address(adapter)) revert NotAdapter();
    }
}
