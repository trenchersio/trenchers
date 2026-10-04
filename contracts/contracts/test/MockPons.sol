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
    uint256 public trackedQuote;             // real ETH taken in by the curve
    bool public graduated;
    event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax);
    event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax);

    function getReserves() external view returns (uint256, uint256) { return (quoteReserve, tokenReserve); }
    function setGraduated() external { graduated = true; }
    /// @dev Graduation: hands the curve's ETH and tokens to the factory, which seeds the pool.
    function drain(address payable to) external returns (uint256 eth, uint256 tokens) {
        graduated = true;
        tokens = ERC20(token).balanceOf(address(this)); ERC20(token).transfer(to, tokens);
        eth = address(this).balance; (bool ok, ) = to.call{value: eth}(""); require(ok);
    }

    function init(address token_, uint256 supply, uint256 maxSpend_) external {
        token = token_; tokenReserve = supply; maxSpend = maxSpend_;
    }

    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 out) {
        require(msg.value == quoteIn && quoteIn > 0, "quote");
        uint256 spent = quoteIn > maxSpend ? maxSpend : quoteIn;
        uint256 net = spent - spent * FEE_BPS / 10_000;
        out = tokenReserve * net / (quoteReserve + net);
        require(out >= minTokensOut, "slippage");
        require(!graduated, "graduated");
        quoteReserve += net; tokenReserve -= out; trackedQuote += net;
        ERC20(token).transfer(recipient, out);
        emit CurveBuy(msg.sender, recipient, spent, out, spent - net, 0);
        if (quoteIn > spent) { (bool ok, ) = msg.sender.call{value: quoteIn - spent}(""); require(ok, "refund"); }
    }

    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256 out) {
        ERC20(token).transferFrom(msg.sender, address(this), tokensIn);
        uint256 gross = quoteReserve * tokensIn / (tokenReserve + tokensIn);
        out = gross - gross * FEE_BPS / 10_000;
        require(out >= minQuoteOut, "slippage");
        require(!graduated, "graduated");
        quoteReserve -= gross; tokenReserve += tokensIn; trackedQuote = trackedQuote > gross ? trackedQuote - gross : 0;
        (bool ok, ) = recipient.call{value: out}(""); require(ok, "pay");
        emit CurveSell(msg.sender, recipient, tokensIn, out, gross - out, 0);
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
    event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount);

    MockPoolManager public immutable poolManager = new MockPoolManager();
    address public constant memeHook = address(0x40c0);

    /// @dev Moves the curve's reserves into a Uniswap-v4-style pool and marks the launch PoolCreated (2).
    function graduate(address token) external {
        (uint256 eth, uint256 tokens) = MockPonsCurve(payable(launched[token].curve)).drain(payable(address(this)));
        ERC20(token).transfer(address(poolManager), tokens);
        poolManager.seed{value: eth}(token, tokens, launched[token].poolFee, launched[token].tickSpacing, memeHook);
        launched[token].phase = 2;
        emit PoolGraduated(token, 1, tokens, eth);
    }
    receive() external payable {}

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


/// @dev A tiny stand-in for Uniswap v4's PoolManager: one ETH/token constant-product pool per token,
///      exact-input swaps only, the unlock / settle / take flow, a 1% LP fee and a 1% hook tax on the
///      output (like Pons's meme hook). Enough to test the adapter's accounting, not v4's math.
contract MockPoolManager {
    struct Key { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }
    struct Params { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }
    struct Pool { uint256 eth; uint256 tokens; uint24 fee; int24 tickSpacing; address hooks; }
    mapping(address => Pool) public pools;
    bool internal unlocked;
    int256 internal ethDelta;     // + owed to the caller, - owed by the caller
    int256 internal tokenDelta;
    address internal tokenOfSwap;
    address internal synced; uint256 internal syncedBalance;

    mapping(bytes32 => address) internal tokenOfSlot;

    function seed(address token, uint256 tokens, uint24 fee, int24 tickSpacing, address hooks) external payable {
        pools[token] = Pool(msg.value, tokens, fee, tickSpacing, hooks);
        bytes32 poolId = keccak256(abi.encode(Key(address(0), token, fee, tickSpacing, hooks)));
        tokenOfSlot[keccak256(abi.encodePacked(poolId, bytes32(uint256(6))))] = token;
    }

    /// @dev Like v4's extsload on a pool's state slot: sqrtPriceX96 in the low 160 bits.
    function extsload(bytes32 slot) external view returns (bytes32) {
        address token = tokenOfSlot[slot];
        if (token == address(0)) return bytes32(0);
        return bytes32(uint256(sqrtPriceX96(token)));
    }

    function unlock(bytes calldata data) external returns (bytes memory r) {
        require(!unlocked, "locked"); unlocked = true;
        r = IUnlockCb(msg.sender).unlockCallback(data);
        require(ethDelta == 0 && tokenDelta == 0, "CurrencyNotSettled");
        unlocked = false;
    }

    function swap(Key memory key, Params memory p, bytes calldata) external returns (int256 delta) {
        require(unlocked, "not unlocked");
        require(key.currency0 == address(0), "eth pool");
        Pool storage pool = pools[key.currency1];
        require(pool.tokens > 0 && key.fee == pool.fee && key.tickSpacing == pool.tickSpacing && key.hooks == pool.hooks, "no pool");
        require(p.amountSpecified < 0, "exact in only");
        uint256 amountIn = uint256(-p.amountSpecified);
        uint256 inNet = amountIn - amountIn / 100;
        tokenOfSwap = key.currency1;
        int128 a0; int128 a1;
        if (p.zeroForOne) { // ETH in, tokens out
            uint256 out = pool.tokens * inNet / (pool.eth + inNet);
            pool.eth += amountIn; pool.tokens -= out;
            out -= out / 100; // hook tax on the output
            a0 = -int128(int256(amountIn)); a1 = int128(int256(out));
        } else { // tokens in, ETH out
            uint256 out = pool.eth * inNet / (pool.tokens + inNet);
            pool.tokens += amountIn; pool.eth -= out;
            out -= out / 100;
            a0 = int128(int256(out)); a1 = -int128(int256(amountIn));
        }
        ethDelta += a0; tokenDelta += a1;
        delta = (int256(a0) << 128) | int256(uint256(uint128(a1)));
    }

    function sync(address currency) external { synced = currency; syncedBalance = currency == address(0) ? 0 : ERC20(currency).balanceOf(address(this)); }

    function settle() external payable returns (uint256 paid) {
        if (synced == address(0)) { paid = msg.value; ethDelta += int256(paid); }
        else { paid = ERC20(synced).balanceOf(address(this)) - syncedBalance; tokenDelta += int256(paid); synced = address(0); }
    }

    function take(address currency, address to, uint256 amount) external {
        if (currency == address(0)) { ethDelta -= int256(amount); (bool ok, ) = to.call{value: amount}(""); require(ok, "take"); }
        else { tokenDelta -= int256(amount); ERC20(currency).transfer(to, amount); }
    }

    /// @dev Pool price as Uniswap's sqrtPriceX96 (token1 per token0), like StateLibrary.getSlot0 reads it.
    function sqrtPriceX96(address token) public view returns (uint160) {
        Pool memory pool = pools[token];
        return uint160(_sqrt(pool.tokens * (1 << 96) / pool.eth * (1 << 96)));
    }
    function _sqrt(uint256 x) internal pure returns (uint256 y) { if (x == 0) return 0; uint256 z = (x + 1) / 2; y = x; while (z < y) { y = z; z = (x / z + z) / 2; } }

    receive() external payable {}
}

interface IUnlockCb { function unlockCallback(bytes calldata data) external returns (bytes memory); }
