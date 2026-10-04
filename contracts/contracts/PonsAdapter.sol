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
        uint8 phase;
    }
    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
}

interface IPonsV2Curve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut);
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256 quoteOut);
}

interface IAgentCoin {
    function coin() external view returns (address);
}

/// @title PonsAdapter
/// @notice The single "router" Trenchers agent wallets trade through. An agent wallet's engine trade
///         can only call the router set in AgentConfig, but every Pons coin trades on its own bonding
///         curve, so this adapter looks the curve up in the Pons V2 factory (so only genuine Pons
///         launches can be traded) and forwards the trade:
///           - buy:  ETH from the agent goes to the curve; tokens and any refund go back to the agent.
///           - sell: tokens the agent approved are sold on the curve; the ETH goes back to the agent.
///         The adapter never holds funds between calls and refuses the agent's own coin.
/// @dev    Bonding-curve phase only (ETH-paired launches). Graduated coins trade on Uniswap V4 and
///         need a separate route; the curve reverts with CurveGraduated for them.
contract PonsAdapter is ReentrancyGuard, InstantRescue {
    using SafeERC20 for IERC20;

    IPonsV2Factory public immutable factory;
    /// @notice Can sweep anything left in the adapter by mistake (it never holds funds between calls).
    address public immutable owner;

    event Bought(address indexed agent, address indexed token, uint256 ethIn, uint256 tokensOut, uint256 refund);
    event Sold(address indexed agent, address indexed token, uint256 tokensIn, uint256 ethOut);

    error NotPonsToken();
    error NotEthPaired();
    error OwnCoin();
    error ZeroAmount();
    error TransferFailed();

    constructor(IPonsV2Factory factory_, address owner_) {
        factory = factory_;
        owner = owner_;
    }

    function _rescueOwner() internal view override returns (address) { return owner; }

    /// @notice Buys `token` with all ETH sent; tokens and any refund go to the caller (the agent wallet).
    function buy(address token, uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        if (msg.value == 0) revert ZeroAmount();
        address curve = _curve(token);
        uint256 before = address(this).balance - msg.value;
        tokensOut = IPonsV2Curve(curve).buy{value: msg.value}(msg.value, minTokensOut, msg.sender);
        uint256 refund = address(this).balance - before;
        if (refund > 0) _sendEth(msg.sender, refund);
        emit Bought(msg.sender, token, msg.value - refund, tokensOut, refund);
    }

    /// @notice Sells `tokensIn` of `token` from the caller (who approved this adapter); ETH goes to the caller.
    function sell(address token, uint256 tokensIn, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        if (tokensIn == 0) revert ZeroAmount();
        address curve = _curve(token);
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);
        IERC20(token).safeApprove(curve, 0);
        IERC20(token).safeApprove(curve, tokensIn);
        ethOut = IPonsV2Curve(curve).sell(tokensIn, minEthOut, msg.sender);
        emit Sold(msg.sender, token, tokensIn, ethOut);
    }

    /// @dev The curve of a genuine, ETH-paired Pons launch, and never the calling agent's own coin.
    function _curve(address token) internal view returns (address curve) {
        IPonsV2Factory.LaunchedToken memory t = factory.getLaunchedToken(token);
        if (t.token != token || t.curve == address(0)) revert NotPonsToken();
        if (t.pairToken != address(0)) revert NotEthPaired();
        (bool ok, bytes memory r) = msg.sender.staticcall(abi.encodeCall(IAgentCoin.coin, ()));
        if (ok && r.length == 32 && abi.decode(r, (address)) == token) revert OwnCoin();
        curve = t.curve;
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev Curves refund unspent ETH to the adapter mid-buy; it is forwarded in the same call.
    receive() external payable {}
}
