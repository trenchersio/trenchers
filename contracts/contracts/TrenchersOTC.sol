// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title TrenchersOTC
/// @notice Peer-to-peer orders for $TRENCHERS and agent coins against ETH. No curve, no slippage, no fee, no owner.
///         An ask escrows the tokens being sold; a bid escrows the ETH offered. Anyone can fill any part of an open
///         order at its fixed price (or only the named taker, for a private order). The maker can cancel at any
///         time, and anyone can return an expired order's escrow to its maker.
///         Buying from asks takes a `recipient`, so tokens can be delivered straight to someone else, such as the
///         Trenchers inference desk to turn them into credit.
contract TrenchersOTC is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Order {
        address maker;
        uint40 expiry;    // 0 = never
        bool isAsk;       // true: maker sells tokens for ETH; false: maker buys tokens with ETH
        address token;
        address taker;    // 0 = anyone
        uint128 tokenTotal;
        uint128 ethTotal;
        uint128 tokenLeft;
        uint128 ethLeft;
    }

    mapping(uint256 => Order) public orders;
    uint256 public nextId = 1;

    event Placed(uint256 indexed id, address indexed maker, address indexed token, bool isAsk, uint128 tokenAmount, uint128 ethAmount, uint40 expiry, address taker);
    event Filled(uint256 indexed id, address indexed taker, address recipient, uint128 tokenAmount, uint256 ethAmount);
    event Cancelled(uint256 indexed id);

    error ZeroAmount();
    error BadExpiry();
    error TaxedToken();
    error NotOpen();
    error Expired();
    error NotTaker();
    error TooMuch();
    error WrongSide();
    error NotEnoughEth();
    error Slippage();
    error NotMaker();
    error EthTransferFailed();
    error LengthMismatch();

    // ------------------------------------------------------------------ make

    /// @notice Sell `tokenAmount` of `token` for `ethAmount` wei in total. The tokens are escrowed here.
    function ask(address token, uint128 tokenAmount, uint128 ethAmount, uint40 expiry, address taker) external nonReentrant returns (uint256 id) {
        if (tokenAmount == 0 || ethAmount == 0) revert ZeroAmount();
        if (expiry != 0 && expiry <= block.timestamp) revert BadExpiry();
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);
        if (IERC20(token).balanceOf(address(this)) - before != tokenAmount) revert TaxedToken();
        id = _store(token, true, tokenAmount, ethAmount, expiry, taker);
    }

    /// @notice Buy `tokenAmount` of `token` for all the ETH sent. The ETH is escrowed here.
    function bid(address token, uint128 tokenAmount, uint40 expiry, address taker) external payable nonReentrant returns (uint256 id) {
        if (tokenAmount == 0 || msg.value == 0) revert ZeroAmount();
        if (msg.value > type(uint128).max) revert TooMuch();
        if (expiry != 0 && expiry <= block.timestamp) revert BadExpiry();
        id = _store(token, false, tokenAmount, uint128(msg.value), expiry, taker);
    }

    function _store(address token, bool isAsk, uint128 tokenAmount, uint128 ethAmount, uint40 expiry, address taker) internal returns (uint256 id) {
        id = nextId++;
        orders[id] = Order(msg.sender, expiry, isAsk, token, taker, tokenAmount, ethAmount, tokenAmount, ethAmount);
        emit Placed(id, msg.sender, token, isAsk, tokenAmount, ethAmount, expiry, taker);
    }

    // ------------------------------------------------------------------ take

    /// @notice Wei for `tokenAmount` of order `id` at its price. Asks round up (the buyer pays the last wei),
    ///         bids round down (the seller gets no more than offered). Filling the rest takes exactly what is left.
    function quote(uint256 id, uint128 tokenAmount) public view returns (uint256 eth) {
        Order storage o = orders[id];
        if (o.tokenLeft == 0) revert NotOpen();
        if (tokenAmount > o.tokenLeft) revert TooMuch();
        if (tokenAmount == o.tokenLeft) return o.ethLeft;
        uint256 num = uint256(tokenAmount) * o.ethTotal;
        eth = o.isAsk ? (num + o.tokenTotal - 1) / o.tokenTotal : num / o.tokenTotal;
        if (eth > o.ethLeft) eth = o.ethLeft;
    }

    /// @notice Buy from one or more asks. Pays each maker, sends every token to `recipient` (the caller if zero)
    ///         and refunds any ETH not needed.
    function buy(uint256[] calldata ids, uint128[] calldata amounts, address recipient) external payable nonReentrant returns (uint256 ethSpent) {
        if (ids.length != amounts.length) revert LengthMismatch();
        address to = recipient == address(0) ? msg.sender : recipient;
        for (uint256 i; i < ids.length; ++i) {
            Order storage o = orders[ids[i]];
            if (!o.isAsk) revert WrongSide();
            _check(o, amounts[i]);
            uint256 eth = quote(ids[i], amounts[i]);
            o.tokenLeft -= amounts[i];
            o.ethLeft -= uint128(eth);
            ethSpent += eth;
            if (ethSpent > msg.value) revert NotEnoughEth();
            _sendEth(o.maker, eth);
            IERC20(o.token).safeTransfer(to, amounts[i]);
            emit Filled(ids[i], msg.sender, to, amounts[i], eth);
        }
        if (msg.value > ethSpent) _sendEth(msg.sender, msg.value - ethSpent);
    }

    /// @notice Sell `tokenAmount` into bid `id`. The tokens go to the bid's maker; the ETH comes to the caller.
    function sell(uint256 id, uint128 tokenAmount, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        Order storage o = orders[id];
        if (o.isAsk) revert WrongSide();
        _check(o, tokenAmount);
        ethOut = quote(id, tokenAmount);
        if (ethOut == 0 || ethOut < minEthOut) revert Slippage();
        o.tokenLeft -= tokenAmount;
        o.ethLeft -= uint128(ethOut);
        address maker = o.maker;
        uint256 before = IERC20(o.token).balanceOf(maker);
        IERC20(o.token).safeTransferFrom(msg.sender, maker, tokenAmount);
        if (IERC20(o.token).balanceOf(maker) - before != tokenAmount) revert TaxedToken();
        _sendEth(msg.sender, ethOut);
        emit Filled(id, msg.sender, maker, tokenAmount, ethOut);
    }

    function _check(Order storage o, uint128 amount) internal view {
        if (amount == 0) revert ZeroAmount();
        if (o.tokenLeft == 0) revert NotOpen();
        if (o.expiry != 0 && o.expiry <= block.timestamp) revert Expired();
        if (o.taker != address(0) && o.taker != msg.sender) revert NotTaker();
        if (amount > o.tokenLeft) revert TooMuch();
    }

    // ------------------------------------------------------------------ cancel

    /// @notice Closes an order and returns what is left of its escrow to the maker. The maker can always cancel;
    ///         anyone can close an expired order (the escrow still only goes to the maker).
    function cancel(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        if (o.tokenLeft == 0) revert NotOpen();
        bool expired = o.expiry != 0 && o.expiry <= block.timestamp;
        if (msg.sender != o.maker && !expired) revert NotMaker();
        uint128 tokens = o.tokenLeft;
        uint128 eth = o.ethLeft;
        o.tokenLeft = 0;
        o.ethLeft = 0;
        if (o.isAsk) IERC20(o.token).safeTransfer(o.maker, tokens);
        else _sendEth(o.maker, eth);
        emit Cancelled(id);
    }

    function _sendEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }
}
