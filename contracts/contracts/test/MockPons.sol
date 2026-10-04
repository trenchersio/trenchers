// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test stand-in for Pons V2: a factory registry and an ETH bonding curve with the same
///      buy/sell signatures and refund behaviour (refund to msg.sender, tokens to recipient).
contract MockPonsToken is ERC20 {
    constructor(string memory n, address to, uint256 supply) ERC20(n, n) { _mint(to, supply); }
}

contract MockPonsCurve {
    address public token;
    uint256 public quoteReserve = 1 ether;   // phantom ETH reserve
    uint256 public tokenReserve;
    uint256 public maxSpend;                 // a buy above this is partly refunded (like near graduation)
    uint256 public constant FEE_BPS = 100;   // 1%

    function init(address token_, uint256 supply, uint256 maxSpend_) external {
        token = token_; tokenReserve = supply; maxSpend = maxSpend_;
    }

    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 out) {
        require(msg.value == quoteIn && quoteIn > 0, "quote");
        uint256 spent = quoteIn > maxSpend ? maxSpend : quoteIn;
        uint256 net = spent - spent * FEE_BPS / 10_000;
        out = tokenReserve * net / (quoteReserve + net);
        require(out >= minTokensOut, "slippage");
        quoteReserve += net; tokenReserve -= out;
        ERC20(token).transfer(recipient, out);
        if (quoteIn > spent) { (bool ok, ) = msg.sender.call{value: quoteIn - spent}(""); require(ok, "refund"); }
    }

    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256 out) {
        ERC20(token).transferFrom(msg.sender, address(this), tokensIn);
        uint256 gross = quoteReserve * tokensIn / (tokenReserve + tokensIn);
        out = gross - gross * FEE_BPS / 10_000;
        require(out >= minQuoteOut, "slippage");
        quoteReserve -= gross; tokenReserve += tokensIn;
        (bool ok, ) = recipient.call{value: out}(""); require(ok, "pay");
    }

    receive() external payable {}
}

contract MockPonsFactory {
    struct LaunchedToken {
        address token; address curve; address deployer; address creatorFeeRecipient; address pairToken;
        uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase;
    }
    mapping(address => LaunchedToken) internal launched;
    event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold);

    /// @dev Launches a coin with an ETH curve; the curve gets some ETH so sells can pay out.
    function launch(string calldata name, uint256 maxSpend) external payable returns (address token, address curve) {
        MockPonsCurve c = new MockPonsCurve();
        MockPonsToken t = new MockPonsToken(name, address(c), 1_000_000_000 ether);
        c.init(address(t), 1_000_000_000 ether, maxSpend);
        if (msg.value > 0) { (bool ok, ) = address(c).call{value: msg.value}(""); require(ok); }
        token = address(t); curve = address(c);
        launched[token] = LaunchedToken(token, curve, msg.sender, msg.sender, address(0), 4.2 ether, 10000, 200, 0, false, 0);
        emit TokenLaunched(token, curve, msg.sender, address(0), 0, 4.2 ether);
    }

    /// @dev A launch paired with an ERC-20 instead of ETH (the adapter must refuse it).
    function registerNonEth(address token, address curve, address pair) external {
        launched[token] = LaunchedToken(token, curve, msg.sender, msg.sender, pair, 0, 0, 0, 0, false, 0);
    }

    function getLaunchedToken(address token) external view returns (LaunchedToken memory) { return launched[token]; }
}
