// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./TimelockedRescue.sol";

/// @dev The parts of Pons V2 the adapter uses (github.com/ponsdotdev/pons-labs, contractsV2).
interface IPonsV2Factory {
    struct LaunchedToken {
        address token;
        address curve;
        address deployer;
        address creatorFeeRecipient;
        address pairToken;
        uint256 graduationThreshold;
        uint24 poolFee;
        int24 tickSpacing;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        uint8 phase; // GraduationPhase: 0 NotGraduated, 1 Swept, 2 PoolCreated, 3 Rescued
    }
    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
    function poolManager() external view returns (address);
    function memeHook() external view returns (address);
}

interface IPonsV2Curve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut);
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256 quoteOut);
}

/// @dev Uniswap v4 PoolManager (v4-core), only what a single exact-input swap needs.
interface IPoolManagerV4 {
    struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }
    struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256 delta);
    function sync(address currency) external;
    function settle() external payable returns (uint256 paid);
    function take(address currency, address to, uint256 amount) external;
    function extsload(bytes32 slot) external view returns (bytes32);
}

interface IAgentCoin {
    function coin() external view returns (address);
}

/// @title PonsAdapter
/// @notice The single "router" Trenchers agent wallets trade through. An agent wallet's engine trade
///         can only call the router set in AgentConfig, so this adapter routes every Pons coin to
///         wherever it trades right now, after checking with the Pons V2 factory that it is a genuine,
///         ETH-paired Pons launch (and never the calling agent's own coin):
///           - before graduation: its bonding curve;
///           - after graduation:  its Uniswap v4 pool (the pool Pons created, with Pons's meme hook).
///         buy:  ETH from the agent → coins (and any refund) back to the agent.
///         sell: coins the agent approved → ETH back to the agent.
///         The adapter never holds funds between calls.
contract PonsAdapter is ReentrancyGuard, InstantRescue {
    using SafeERC20 for IERC20;

    IPonsV2Factory public immutable factory;
    /// @notice Can sweep anything left in the adapter by mistake (it never holds funds between calls).
    address public immutable owner;

    uint160 internal constant MIN_SQRT_PRICE = 4295128739;
    uint160 internal constant MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342;
    uint8 internal constant NOT_GRADUATED = 0;
    uint8 internal constant POOL_CREATED = 2;

    event Bought(address indexed agent, address indexed token, uint256 ethIn, uint256 tokensOut, uint256 refund);
    event Sold(address indexed agent, address indexed token, uint256 tokensIn, uint256 ethOut);

    error NotPonsToken();
    error NotEthPaired();
    error NotTradable();
    error OwnCoin();
    error ZeroAmount();
    error TransferFailed();
    error Slippage();
    error NotPoolManager();

    /// @dev Set only for the length of one v4 swap, so the callback can't be triggered from outside.
    address private _pm;

    constructor(IPonsV2Factory factory_, address owner_) {
        factory = factory_;
        owner = owner_;
    }

    function _rescueOwner() internal view override returns (address) { return owner; }

    /// @notice Buys `token` with all ETH sent; tokens and any refund go to the caller (the agent wallet).
    function buy(address token, uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        if (msg.value == 0) revert ZeroAmount();
        IPonsV2Factory.LaunchedToken memory t = _launch(token);
        uint256 before = address(this).balance - msg.value;
        if (t.phase == NOT_GRADUATED) {
            tokensOut = IPonsV2Curve(t.curve).buy{value: msg.value}(msg.value, minTokensOut, msg.sender);
        } else {
            tokensOut = _swapV4(t, true, msg.value, minTokensOut, msg.sender);
        }
        uint256 refund = address(this).balance - before;
        if (refund > 0) _sendEth(msg.sender, refund);
        emit Bought(msg.sender, token, msg.value - refund, tokensOut, refund);
    }

    /// @notice Sells `tokensIn` of `token` from the caller (who approved this adapter); ETH goes to the caller.
    function sell(address token, uint256 tokensIn, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        if (tokensIn == 0) revert ZeroAmount();
        IPonsV2Factory.LaunchedToken memory t = _launch(token);
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);
        if (t.phase == NOT_GRADUATED) {
            IERC20(token).safeApprove(t.curve, 0);
            IERC20(token).safeApprove(t.curve, tokensIn);
            ethOut = IPonsV2Curve(t.curve).sell(tokensIn, minEthOut, msg.sender);
        } else {
            ethOut = _swapV4(t, false, tokensIn, minEthOut, msg.sender);
        }
        emit Sold(msg.sender, token, tokensIn, ethOut);
    }

    /// @notice Where `token` trades now: 0 = bonding curve, 2 = its Uniswap v4 pool. Reverts if not tradable.
    function venue(address token) external view returns (uint8) { return _launch(token).phase; }

    /// @notice The v4 pool price of a graduated coin (Uniswap's sqrtPriceX96, coins per ETH), for valuing positions.
    function poolPrice(address token) external view returns (uint160 sqrtPriceX96) {
        IPonsV2Factory.LaunchedToken memory t = _launch(token);
        if (t.phase != POOL_CREATED) revert NotTradable();
        bytes32 id = keccak256(abi.encode(_key(t)));
        bytes32 data = IPoolManagerV4(factory.poolManager()).extsload(keccak256(abi.encodePacked(id, bytes32(uint256(6)))));
        sqrtPriceX96 = uint160(uint256(data));
    }

    // ------------------------------------------------------------------ Uniswap v4

    struct SwapJob { IPoolManagerV4.PoolKey key; bool ethIn; uint256 amountIn; uint256 minOut; address recipient; }

    function _key(IPonsV2Factory.LaunchedToken memory t) internal view returns (IPoolManagerV4.PoolKey memory) {
        // ETH (address 0) always sorts first, so it is currency0 and the coin is currency1.
        return IPoolManagerV4.PoolKey(address(0), t.token, t.poolFee, t.tickSpacing, factory.memeHook());
    }

    function _swapV4(IPonsV2Factory.LaunchedToken memory t, bool ethIn, uint256 amountIn, uint256 minOut, address recipient)
        internal returns (uint256 out)
    {
        address pm = factory.poolManager();
        _pm = pm;
        bytes memory r = IPoolManagerV4(pm).unlock(abi.encode(SwapJob(_key(t), ethIn, amountIn, minOut, recipient)));
        _pm = address(0);
        out = abi.decode(r, (uint256));
    }

    /// @dev Called by the PoolManager inside `unlock`: swap, pay what we owe, take what we're owed.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != _pm || _pm == address(0)) revert NotPoolManager();
        SwapJob memory j = abi.decode(data, (SwapJob));
        IPoolManagerV4 pm = IPoolManagerV4(msg.sender);
        int256 delta = pm.swap(j.key, IPoolManagerV4.SwapParams({
            zeroForOne: j.ethIn,
            amountSpecified: -int256(j.amountIn),
            sqrtPriceLimitX96: j.ethIn ? MIN_SQRT_PRICE + 1 : MAX_SQRT_PRICE - 1
        }), "");
        int128 d0 = int128(delta >> 128);      // ETH
        int128 d1 = int128(delta);             // coin
        (int128 paidIn, int128 got) = j.ethIn ? (d0, d1) : (d1, d0);
        uint256 owed = paidIn < 0 ? uint256(uint128(-paidIn)) : 0;   // at most amountIn (less if the pool ran dry)
        uint256 out = got > 0 ? uint256(uint128(got)) : 0;
        if (out < j.minOut) revert Slippage();
        if (j.ethIn) {
            pm.sync(address(0));
            pm.settle{value: owed}();                                // unspent ETH stays here and is refunded by buy()
            pm.take(j.key.currency1, j.recipient, out);
        } else {
            pm.sync(j.key.currency1);
            IERC20(j.key.currency1).safeTransfer(address(pm), owed);
            pm.settle();
            if (owed < j.amountIn) IERC20(j.key.currency1).safeTransfer(j.recipient, j.amountIn - owed);
            pm.take(address(0), j.recipient, out);
        }
        return abi.encode(out);
    }

    // ------------------------------------------------------------------ checks

    /// @dev A genuine, ETH-paired Pons launch that trades on its curve or its v4 pool, and never the
    ///      calling agent's own coin.
    function _launch(address token) internal view returns (IPonsV2Factory.LaunchedToken memory t) {
        t = factory.getLaunchedToken(token);
        if (t.token != token || t.curve == address(0)) revert NotPonsToken();
        if (t.pairToken != address(0)) revert NotEthPaired();
        if (t.phase != NOT_GRADUATED && t.phase != POOL_CREATED) revert NotTradable();
        (bool ok, bytes memory r) = msg.sender.staticcall(abi.encodeCall(IAgentCoin.coin, ()));
        if (ok && r.length == 32 && abi.decode(r, (address)) == token) revert OwnCoin();
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev Curves refund unspent ETH to the adapter mid-buy, and v4 pays sells here; both are forwarded in the same call.
    receive() external payable {}
}
