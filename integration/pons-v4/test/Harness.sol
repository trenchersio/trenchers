// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, Vm, console2} from "forge-std/Test.sol";

// -----------------------------------------------------------------------------------------------
// Local ABI views of the REAL contracts. Everything below is deployed from its own source with
// vm.deployCode (Pons V2 + Uniswap v4 with solc 0.8.26/via-IR, Permit2 + ERC-6551 registry with
// 0.8.17, Trenchers with 0.8.24 + OZ 4.8.3) and only talked to through these interfaces.
// -----------------------------------------------------------------------------------------------

struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }
struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }
struct TokenParams {
    string name; string symbol; string logo; string description; Socials socials;
    address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics;
}
struct LaunchConfig {
    uint256 supply; uint256 curveFeeBps; uint256 phantomQuote; uint256 graduationThreshold;
    uint24 poolFee; int24 tickSpacing; bool enabled;
}
/// @dev The FULL record (IPonsV2LaunchFactory.LaunchedToken). The adapter declares only the first 11 fields.
struct LaunchedToken {
    address token; address curve; address deployer; address creatorFeeRecipient; address pairToken;
    uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled;
    uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists;
}

interface IFactory {
    function launchToken(TokenParams calldata, uint256 launchConfigId, address pairToken) external payable returns (address, address);
    function addLaunchConfig(LaunchConfig calldata) external returns (uint256);
    function setLaunchEnabled(bool) external;
    function setGraduationExecutor(address) external;
    function setLaunchDeployer(address) external;
    function setPairTokenEconomics(address, uint256, uint256, uint8) external;
    function setPairTokenApproved(address, bool) external;
    function getLaunchedToken(address) external view returns (LaunchedToken memory);
    function graduate(address) external;
    function createGraduatedPool(address) external returns (uint256);
    function poolManager() external view returns (address);
    function memeHook() external view returns (address);
    function launchFee() external view returns (uint256);
    function launchDeployer() external view returns (address);
}
interface ICurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256);
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256);
    function getReserves() external view returns (uint256 quoteReserve, uint256 tokenReserve);
    function trackedQuote() external view returns (uint256);
    function graduated() external view returns (bool);
    function readyToGraduate() external view returns (bool);
    function sellableTokens() external view returns (uint256);
    function realQuoteReserve() external view returns (uint256);
    function feeBps() external view returns (uint256);
    function creatorTaxBps() external view returns (uint256);
    function phantomQuote() external view returns (uint256);
}
interface IERC20x {
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function symbol() external view returns (string memory);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}
interface IOwnableSetFactory { function setFactory(address) external; function setBuybackVault(address) external; }
interface IHookView { function launches(bytes32) external view returns (bool registered, bool memecoinIsCurrency0, address memecoin, address quoteToken); }
interface IPM { function extsload(bytes32) external view returns (bytes32); }
interface IPosm { function poolManager() external view returns (address); function nextTokenId() external view returns (uint256); function ownerOf(uint256) external view returns (address); }
interface ILocker { function isLocked(address) external view returns (bool); function lockedPositions(address) external view returns (uint256); }

interface IAdapter {
    function buy(address token, uint256 minTokensOut) external payable returns (uint256);
    function sell(address token, uint256 tokensIn, uint256 minEthOut) external returns (uint256);
    function venue(address token) external view returns (uint8);
    function poolPrice(address token) external view returns (uint160);
    function factory() external view returns (address);
}
interface IAgent {
    function setPolicy(uint128 perTrade, uint128 dailyCap, bool live, bytes32 ruleHash, string calldata ruleUri) external;
    function trade(uint256 value, bytes calldata data) external returns (bytes memory);
    function approveRouter(address token, uint256 amount) external;
    function launchCoin(bytes calldata data, uint256 value, address coin) external returns (bytes memory);
    function coin() external view returns (address);
    function owner() external view returns (address);
    function lockedNow() external view returns (uint256);
    function withdrawable() external view returns (uint256);
    function starterLocked() external view returns (uint256);
}
interface IUnlockCb { function unlockCallback(bytes calldata) external returns (bytes memory); }
interface IConfig { function execute(uint8 key) external; function propose(uint8 key, address value) external; function seal() external; function router() external view returns (address); }
interface IFund { function setAccount(address, bytes32) external; function claim(uint256) external; function agentWallet(uint256) external view returns (address); }
interface INFT { function setTransferValidator(address) external; function getTransferValidator() external view returns (address); function setMintOpen(bool) external; function mint(uint256) external payable; function setStarterFund(address) external; function ownerOf(uint256) external view returns (address); }
interface ISplitter { function setPrimarySeller(address) external; function proposeDestination(uint8, address) external; }

// Trenchers / Pons error selectors (declared here only to build expected revert data).
interface IErrs {
    error CallFailed(bytes reason);
    error NotPonsToken();
    error NotEthPaired();
    error NotTradable();
    error OwnCoin();
    error Slippage();
    error NotAllowed();
    error SlippageExceeded(uint256 actual, uint256 minimum);
    error CurveGraduated();
}

/// @notice Shared deployment + engine helpers for the local stack test and the live-fork test.
abstract contract TrenchersHarness is Test {
    // Live addresses reused so the test also checks they are compatible (hook flag bits, canonical singletons).
    address constant LIVE_MEME_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044; // pons v2 meme hook on 4663
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant ERC6551_REGISTRY = 0x000000006551c19487814612e58FE06813775758;

    // Pons launch config used here (the live config is not public; values chosen to be realistic).
    uint256 constant SUPPLY = 1_000_000_000 ether;
    uint256 constant CURVE_FEE_BPS = 100;          // same as the hook's default hookFeeBps
    uint256 constant PHANTOM = 1.5 ether;
    uint256 constant THRESHOLD = 4 ether;
    int24 constant TICK_SPACING = 200;
    uint16 constant CREATOR_TAX = 200;            // 2% creator tax on top
    uint256 constant LAUNCH_FEE = 0.001 ether;
    uint256 constant ENGINE_SLIPPAGE_PCT = 15;     // engine default SLIPPAGE_PCT

    // actors
    address ponsOwner = makeAddr("ponsOwner");
    address protocolFeeRecipient = makeAddr("protocolFeeRecipient");
    address creator = makeAddr("creator");
    address whale = makeAddr("whale");
    address keeper = makeAddr("keeper");
    address safe = makeAddr("safe");
    address devSafe = makeAddr("devSafe");
    address team = makeAddr("team");
    address engine = makeAddr("engine");
    address holder = makeAddr("holder");

    // Uniswap + Pons
    address pm; address posm; address hook; address escrow; address locker; address vault;
    IFactory factory; address executor; address launchDeployer;
    // Trenchers
    address splitter; address nft; address fund; IConfig config; address logic; address walletImpl;
    IAdapter adapter;
    IAgent agent; // the agent wallet (ERC-6551 account) of Trencher #6

    // lifecycle state shared between stages
    uint256 got0; uint256 got1; uint256 held;

    // the coin
    address token; ICurve curve; uint256 launchTime;


    // ===================================================================== deployment

    function _deployLocalStack() internal {
        vm.deal(ponsOwner, 10 ether); vm.deal(creator, 10 ether); vm.deal(whale, 100 ether);
        vm.deal(holder, 10 ether); vm.deal(keeper, 1 ether);
        _deployUniswap();
        _deployPons();
    }

    function _deployUniswap() internal {
        pm = vm.deployCode(_o("PoolManager"), abi.encode(ponsOwner));
        deployCodeTo(_o("Permit2"), PERMIT2);
        // PositionManager(poolManager, permit2, unsubscribeGasLimit, descriptor, weth9): the descriptor and
        // WETH are only used for tokenURI / wrapping, which no Pons or Trenchers path touches.
        posm = vm.deployCode(_o("PositionManager"),
            abi.encode(pm, PERMIT2, uint256(300_000), address(0), makeAddr("weth9")));
        deployCodeTo(_o("ERC6551Registry"), ERC6551_REGISTRY);
    }

    function _deployPons() internal {
        escrow = vm.deployCode(_o("PonsV2FeeEscrowLite"));
        // The meme hook at the LIVE hook's address: its low 14 bits (0x2044 = beforeInitialize | afterSwap |
        // afterSwapReturnDelta) must match getHookPermissions() or BaseHook's constructor reverts.
        deployCodeTo(_o("PonsV2MemeHook"), abi.encode(pm, escrow, protocolFeeRecipient, ponsOwner), LIVE_MEME_HOOK);
        hook = LIVE_MEME_HOOK;
        locker = vm.deployCode(_o("PonsV2LaunchLocker"), abi.encode(ponsOwner, posm));
        vault = vm.deployCode(_o("PonsV2BuybackVault"), abi.encode(ponsOwner, hook, escrow));
        factory = IFactory(vm.deployCode(_o("PonsV2LaunchFactory"),
            abi.encode(ponsOwner, pm, posm, PERMIT2, locker, hook, escrow, vault, LAUNCH_FEE)));
        executor = vm.deployCode(_o("PonsV2GraduationExecutor"), abi.encode(posm, PERMIT2, locker, address(factory)));
        launchDeployer = vm.deployCode(_o("PonsV2LaunchDeployer"), abi.encode(address(factory)));

        // One-time wiring, exactly what _requireLaunchDependenciesWired() checks.
        vm.startPrank(ponsOwner);
        factory.setGraduationExecutor(executor);
        factory.setLaunchDeployer(launchDeployer);
        IOwnableSetFactory(hook).setFactory(address(factory));
        IOwnableSetFactory(hook).setBuybackVault(vault);
        IOwnableSetFactory(vault).setFactory(address(factory));
        IOwnableSetFactory(locker).setFactory(address(factory));
        factory.addLaunchConfig(LaunchConfig(SUPPLY, CURVE_FEE_BPS, PHANTOM, THRESHOLD, 0, TICK_SPACING, true));
        factory.setLaunchEnabled(true);
        vm.stopPrank();
    }

    /// @dev Mirrors contracts/scripts/deploy.js (deployer = this test contract), plus fund.setAccount by the Safe.
    function _deployTrenchers() internal {
        splitter = vm.deployCode(_t("RevenueSplitter"), abi.encode(address(this), devSafe, block.timestamp));
        nft = vm.deployCode(_t("TrenchersNFT"), abi.encode(splitter, team, "ipfs://pre", "ipfs://c", 0.02 ether));
        fund = vm.deployCode(_t("AgentStarterFund"), abi.encode(safe, nft, ERC6551_REGISTRY, 0.01 ether, 48 hours));
        config = IConfig(vm.deployCode(_t("AgentConfig"), abi.encode(address(this))));
        logic = vm.deployCode(_t("TrenchersAgentAccount"), abi.encode(address(config), fund));
        config.propose(4, logic);
        walletImpl = vm.deployCode(_t("TrenchersAgentWallet"), abi.encode(address(config)));
        config.propose(3, fund);
        INFT(nft).setStarterFund(fund);
        // On a Robinhood fork Limit Break's validator may be live; it only matters for NFT transfers, not trading.
        if (INFT(nft).getTransferValidator() != address(0)) INFT(nft).setTransferValidator(address(0));
        config.propose(0, engine);
        adapter = IAdapter(vm.deployCode(_t("PonsAdapter"), abi.encode(address(factory), safe)));
        config.propose(1, address(adapter));
        // Test only: deploy.js leaves the launcher unset (added later behind the 48h timelock). Set here so
        // the agent can launch its own coin through the real Pons factory (for the OwnCoin check).
        config.propose(2, address(factory));
        ISplitter(splitter).setPrimarySeller(nft);
        ISplitter(splitter).proposeDestination(3, fund);
        config.seal();
        vm.prank(safe);
        IFund(fund).setAccount(walletImpl, bytes32(0));
        INFT(nft).setMintOpen(true);
    }

    function _awakenAgent() internal {
        vm.startPrank(holder);
        INFT(nft).mint{value: 0.02 ether}(1); // Trencher #6 (1-5 are the house agents)
        assertEq(INFT(nft).ownerOf(6), holder);
        vm.recordLogs();
        IFund(fund).claim(6);                 // creates the ERC-6551 wallet via the canonical registry, pays 0.01 ETH
        agent = IAgent(IFund(fund).agentWallet(6));
        {   // engine: "Claimed(uint256 indexed tokenId, address indexed holder, address indexed agentWallet, uint256 amount)"
            (Vm.Log memory c, bool f) = _findLog(vm.getRecordedLogs(), keccak256("Claimed(uint256,address,address,uint256)"), fund);
            assertTrue(f, "Claimed"); assertEq(c.topics.length, 4);
            assertEq(address(uint160(uint256(c.topics[3]))), address(agent));
        }
        assertGt(address(agent).code.length, 0, "agent wallet deployed");
        assertEq(address(agent).balance, 0.01 ether, "starter balance");
        assertEq(agent.owner(), holder);
        // Top up with free ETH so the agent can make realistic trades (the 0.01 starter stays locked).
        (bool ok,) = address(agent).call{value: 3 ether}("");
        assertTrue(ok);
        agent.setPolicy(1 ether, 10 ether, true, keccak256("rule"), "buy every launch, sell after 60s");
        vm.stopPrank();
    }

    function _launchCoin() internal {
        TokenParams memory p = _params("Pepe on Robinhood", "PEPE", creator, CREATOR_TAX, true);
        vm.recordLogs();
        vm.prank(creator);
        (address t, address c) = factory.launchToken{value: LAUNCH_FEE}(p, 0, address(0));
        token = t; curve = ICurve(c); launchTime = block.timestamp;
        _checkTokenLaunchedLog(vm.getRecordedLogs());
    }

    /// @dev Artifacts by path, so filtered runs (--mt/--mc) find them too.
    function _o(string memory name) internal pure returns (string memory) {
        return string.concat("out/", name, ".sol/", name, ".json");
    }

    /// @dev Trenchers artifacts come from the trenchers-build sub-project (solc 0.8.24, OZ 4.8.3).
    function _t(string memory name) internal pure returns (string memory) {
        return string.concat("trenchers-build/out/", name, ".sol/", name, ".json");
    }

    function _params(string memory name, string memory sym, address feeTo, uint16 tax, bool buyback)
        internal pure returns (TokenParams memory)
    {
        return TokenParams(name, sym, "", "", Socials("", "", "", "", ""), feeTo, tax, buyback, bytes32(0));
    }

    // ===================================================================== engine helpers

    /// @dev What the engine sends: agent.trade(value, adapter.buy(token, minOut)).
    function _engineBuy(uint256 value, uint256 minOut) internal returns (uint256 tokensOut) {
        vm.prank(engine);
        bytes memory r = agent.trade(value, abi.encodeCall(IAdapter.buy, (token, minOut)));
        tokensOut = abi.decode(r, (uint256)); // trade() returns the adapter's raw returndata
    }

    /// @dev What the engine sends: agent.approveRouter(token, amount) then agent.trade(0, adapter.sell(...)).
    function _engineSell(address tok, uint256 amount, uint256 minOut) internal returns (uint256 ethOut) {
        vm.prank(engine);
        agent.approveRouter(tok, amount);
        vm.prank(engine);
        bytes memory r = agent.trade(0, abi.encodeCall(IAdapter.sell, (tok, amount, minOut)));
        ethOut = abi.decode(r, (uint256));
    }

    /// @dev engine.ts quoteBuy (curve): (k * eth) / (q + eth), then minOut = expected * (100 - SLIPPAGE_PCT) / 100.
    function _engineMinOutBuyCurve(uint256 eth) internal view returns (uint256 expected, uint256 minOut) {
        (uint256 q, uint256 k) = curve.getReserves();
        expected = (k * eth) / (q + eth);
        minOut = expected * (100 - ENGINE_SLIPPAGE_PCT) / 100;
    }
    /// @dev engine.ts quoteSell (curve): (q * coins) / (k + coins).
    function _engineMinOutSellCurve(uint256 coins) internal view returns (uint256 expected, uint256 minOut) {
        (uint256 q, uint256 k) = curve.getReserves();
        expected = (q * coins) / (k + coins);
        minOut = expected * (100 - ENGINE_SLIPPAGE_PCT) / 100;
    }
    /// @dev engine.ts quoteBuy (pool): ((eth * sp * sp) >> 192) * 98 / 100.
    function _engineMinOutBuyPool(uint256 eth) internal view returns (uint256 expected, uint256 minOut) {
        uint256 sp = adapter.poolPrice(token);
        // JS BigInt has no overflow; in Solidity split the 2^192 shift so the replica stays exact enough.
        expected = (((eth * sp) >> 96) * sp >> 96) * 98 / 100;
        minOut = expected * (100 - ENGINE_SLIPPAGE_PCT) / 100;
    }
    /// @dev engine.ts quoteSell (pool): ((coins << 192) / (sp * sp)) * 98 / 100.
    function _engineMinOutSellPool(uint256 coins) internal view returns (uint256 expected, uint256 minOut) {
        uint256 sp = adapter.poolPrice(token);
        expected = ((((coins << 96) / sp) << 96) / sp) * 98 / 100;
        minOut = expected * (100 - ENGINE_SLIPPAGE_PCT) / 100;
    }

    /// @dev What an eth_call of agent.trade(0, adapter.sell(token, amount, 0)) from the engine returns.
    function _simulateSell(uint256 amount) internal returns (uint256 out) {
        uint256 snap = vm.snapshotState();
        out = _engineSell(token, amount, 0);
        vm.revertToState(snap);
    }
    function _simulateBuy(uint256 value) internal returns (uint256 out) {
        uint256 snap = vm.snapshotState();
        out = _engineBuy(value, 0);
        vm.revertToState(snap);
    }

    function _assertAdapterEmpty(address tok) internal view {
        assertEq(address(adapter).balance, 0, "adapter holds ETH");
        assertEq(IERC20x(tok).balanceOf(address(adapter)), 0, "adapter holds tokens");
    }

    function _phase(address tok) internal view returns (uint8) { return factory.getLaunchedToken(tok).phase; }

    function _callFailed(bytes memory inner) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IErrs.CallFailed.selector, inner);
    }

    /// @dev Pushes the curve to just `leftEth` (gross quote) short of selling out, with a third-party buyer.
    function _whaleBuyToNearGraduation(uint256 leftEth) internal {
        uint256 sellable = curve.sellableTokens();
        (uint256 q, uint256 k) = curve.getReserves();
        uint256 net = (q * sellable) / (k - sellable) + 1;
        uint256 gross = (net * 10_000) / (10_000 - curve.feeBps() - curve.creatorTaxBps()) + 1;
        require(gross > leftEth, "already close");
        vm.prank(whale);
        curve.buy{value: gross - leftEth}(gross - leftEth, 0, whale);
        assertFalse(curve.readyToGraduate(), "whale must not graduate it");
    }

    function _poolKey() internal view returns (PoolKey memory) {
        return PoolKey(address(0), token, 0, TICK_SPACING, hook);
    }
    function _slot0SqrtPrice(PoolKey memory key) internal view returns (uint160) {
        bytes32 id = keccak256(abi.encode(key));
        return uint160(uint256(IPM(pm).extsload(keccak256(abi.encodePacked(id, bytes32(uint256(6)))))));
    }

    // ===================================================================== engine ABI checks (abis.ts)

    bytes32 constant TOPIC_TOKEN_LAUNCHED = keccak256("TokenLaunched(address,address,address,address,uint256,uint256)");
    bytes32 constant TOPIC_POOL_GRADUATED = keccak256("PoolGraduated(address,uint256,uint256,uint256)");
    bytes32 constant TOPIC_CURVE_BUY = keccak256("CurveBuy(address,address,uint256,uint256,uint256,uint256)");
    bytes32 constant TOPIC_CURVE_SELL = keccak256("CurveSell(address,address,uint256,uint256,uint256,uint256)");
    bytes32 constant TOPIC_BOUGHT = keccak256("Bought(address,address,uint256,uint256,uint256)");
    bytes32 constant TOPIC_SOLD = keccak256("Sold(address,address,uint256,uint256)");
    bytes32 constant TOPIC_V4_SWAP = keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
    bytes32 constant TOPIC_V4_INIT = keccak256("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)");

    function _checkTokenLaunchedLog(Vm.Log[] memory logs) internal view {
        bool seen;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] != TOPIC_TOKEN_LAUNCHED) continue;
            seen = true;
            // engine: "TokenLaunched(address indexed token, address indexed curve, address indexed deployer,
            //          address pairToken, uint256 launchConfigId, uint256 graduationThreshold)"
            assertEq(logs[i].emitter, address(factory));
            assertEq(logs[i].topics.length, 4, "3 indexed");
            assertEq(address(uint160(uint256(logs[i].topics[1]))), token);
            assertEq(address(uint160(uint256(logs[i].topics[2]))), address(curve));
            assertEq(address(uint160(uint256(logs[i].topics[3]))), creator);
            (address pair, uint256 cfg, uint256 thr) = abi.decode(logs[i].data, (address, uint256, uint256));
            assertEq(pair, address(0)); assertEq(cfg, 0); assertEq(thr, THRESHOLD);
        }
        assertTrue(seen, "TokenLaunched");
    }

    /// @dev Finds the CurveBuy/CurveSell the engine would read and checks its layout against abis.ts.
    function _checkCurveLog(Vm.Log[] memory logs, bytes32 topic, address expRecipient) internal view returns (uint256 a, uint256 b) {
        bool seen;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] != topic || logs[i].emitter != address(curve)) continue;
            seen = true;
            assertEq(logs[i].topics.length, 3, "2 indexed (buyer/seller, recipient)");
            // buyer/seller is msg.sender of the curve, i.e. the ADAPTER; recipient is the agent wallet.
            assertEq(address(uint160(uint256(logs[i].topics[1]))), address(adapter), "buyer/seller = adapter");
            assertEq(address(uint160(uint256(logs[i].topics[2]))), expRecipient, "recipient = agent");
            (a, b,,) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
        }
        assertTrue(seen, "curve event");
    }

    function _findLog(Vm.Log[] memory logs, bytes32 topic, address emitter) internal pure returns (Vm.Log memory l, bool found) {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == topic && logs[i].emitter == emitter) { l = logs[i]; found = true; }
        }
    }
}
