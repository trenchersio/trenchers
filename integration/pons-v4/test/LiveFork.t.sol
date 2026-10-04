// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./Harness.sol";

/// @dev The launch params of the factory source currently on GitHub HEAD (adds a CREATE2 `salt`).
///      The deployed factory is believed to match HEAD (snipe tax, salts, launch-and-buy router),
///      but its curve/deployer source is not public, so the live test tries this layout first.
struct TokenParamsHead {
    string name; string symbol; string logo; string description; Socials socials;
    address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt;
}
interface IFactoryHead { function launchToken(TokenParamsHead calldata, uint256, address) external payable returns (address, address); }
interface IFactoryAdmin {
    function owner() external view returns (address);
    function launchConfigCount() external view returns (uint256);
    function getLaunchConfig(uint256) external view returns (LaunchConfig memory);
    function setWhitelistedLauncher(address, bool) external;
}

/// @notice The same agent flow, against the REAL deployed Pons V2 on Robinhood Chain (4663), on a fork:
///
///     RH_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --mc LiveRobinhoodForkTest -vvv
///
///         It deploys the Trenchers stack on the fork, launches a fresh ETH coin through the live factory
///         (pranking the factory owner to whitelist the test creator), measures the live snipe tax against
///         the engine's quote/timing, checks the live event layouts against engine/src/abis.ts, then runs
///         buy/sell on the curve, graduation, and buy/sell on the live v4 pool through PonsAdapter.
///
///         Without RH_RPC_URL it runs the same code against the local stack (a self-test of this file).
contract LiveRobinhoodForkTest is TrenchersHarness {
    address constant LIVE_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    uint256 constant ENGINE_SNIPE_WAIT_SEC = 6; // engine default SNIPE_WAIT_SEC

    bool live;
    uint256 configId;

    function setUp() public {
        string memory rpc = vm.envOr("RH_RPC_URL", string(""));
        live = bytes(rpc).length != 0;
        if (live) {
            vm.createSelectFork(rpc);
            assertEq(block.chainid, 4663, "not Robinhood Chain mainnet");
            factory = IFactory(LIVE_FACTORY);
            pm = factory.poolManager();
            hook = factory.memeHook();
            launchDeployer = factory.launchDeployer();
            ponsOwner = IFactoryAdmin(LIVE_FACTORY).owner();
            vm.deal(creator, 10 ether); vm.deal(whale, 100_000 ether); vm.deal(holder, 10 ether); vm.deal(keeper, 1 ether);
            if (ERC6551_REGISTRY.code.length == 0) deployCodeTo(_o("ERC6551Registry"), ERC6551_REGISTRY);
            console2.log("LIVE fork at block %s; factory owner %s", block.number, ponsOwner);
            console2.log("  poolManager %s, memeHook %s", pm, hook);
        } else {
            _deployLocalStack();
        }
        assertEq(hook, LIVE_MEME_HOOK, "meme hook address");
        _deployTrenchers();
        _awakenAgent();
        _launchOnFactory();
    }

    // -------------------------------------------------------------------------------- launch

    function _launchOnFactory() internal {
        uint256 fee = factory.launchFee();
        vm.prank(ponsOwner);
        IFactoryAdmin(address(factory)).setWhitelistedLauncher(creator, true);
        uint256 n = IFactoryAdmin(address(factory)).launchConfigCount();
        for (uint256 i; i < n; i++) if (IFactoryAdmin(address(factory)).getLaunchConfig(i).enabled) { configId = i; break; }
        LaunchConfig memory cfg = IFactoryAdmin(address(factory)).getLaunchConfig(configId);
        console2.log("launch config %s: supply %e, phantom %e", configId, cfg.supply, cfg.phantomQuote);
        console2.log("  threshold %e, curveFeeBps %s, tickSpacing", cfg.graduationThreshold, cfg.curveFeeBps, uint256(int256(cfg.tickSpacing)));
        _logOptional(address(factory), "snipeTaxStartBps()");
        _logOptional(address(factory), "snipeTaxSeconds()");

        Socials memory so = Socials("", "", "", "", "");
        vm.recordLogs();
        vm.prank(creator);
        (bool ok, bytes memory ret) = address(factory).call{value: fee}(abi.encodeCall(IFactoryHead.launchToken,
            (TokenParamsHead("Trenchers Fork Test", "TFT", "", "", so, creator, 200, false, bytes32(0), keccak256("trenchers-fork")), configId, address(0))));
        if (!ok) {
            console2.log("launchToken with the GitHub-HEAD params layout failed; trying the verified-snapshot layout");
            vm.prank(creator);
            (ok, ret) = address(factory).call{value: fee}(abi.encodeCall(IFactory.launchToken,
                (TokenParams("Trenchers Fork Test", "TFT", "", "", so, creator, 200, false, bytes32(0)), configId, address(0))));
        } else {
            console2.log("launchToken accepted the GitHub-HEAD params layout (with salt)");
        }
        assertTrue(ok, "could not launch through the factory with either known ABI");
        (address t, address c) = abi.decode(ret, (address, address));
        token = t; curve = ICurve(c); launchTime = block.timestamp;

        Vm.Log[] memory logs = vm.getRecordedLogs();
        (Vm.Log memory l, bool found) = _findLog(logs, TOPIC_TOKEN_LAUNCHED, address(factory));
        assertTrue(found, "TokenLaunched (engine ABI) not emitted by the factory");
        assertEq(l.topics.length, 4); assertEq(l.data.length, 96, "TokenLaunched data layout");
        assertEq(address(uint160(uint256(l.topics[1]))), token);
        assertEq(address(uint160(uint256(l.topics[2]))), address(curve));
        LaunchedToken memory rec = factory.getLaunchedToken(token);
        assertEq(rec.token, token); assertEq(rec.curve, address(curve)); assertEq(rec.phase, 0); assertTrue(rec.exists);
        assertEq(adapter.venue(token), 0);
    }

    function _logOptional(address target, string memory sig) internal view {
        (bool ok, bytes memory r) = target.staticcall(abi.encodeWithSignature(sig));
        if (ok && r.length == 32) console2.log("  %s = %s", sig, abi.decode(r, (uint256)));
        else console2.log("  %s: not available", sig);
    }

    // -------------------------------------------------------------------------------- tests

    /// @notice Snipe tax vs the engine: what an agent buy of 0.01 ETH gets at each second after launch,
    ///         against the engine's fee-less quote, and whether the engine's minOut (15%) would pass.
    function test_Live_SnipeTaxProfile() public {
        uint256[13] memory dts = [uint256(0), 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 60];
        bool passAtWait;
        for (uint256 i; i < dts.length; i++) {
            uint256 snap = vm.snapshotState();
            vm.warp(launchTime + dts[i]);
            (uint256 exp, uint256 minOut) = _engineMinOutBuyCurve(0.01 ether);
            uint256 got = _engineBuy(0.01 ether, 0);
            console2.log("t+%ss: %s bps below the fee-less quote, engine minOut %s", dts[i], (exp - got) * 10_000 / exp, got >= minOut ? "passes" : "FAILS");
            if (dts[i] == ENGINE_SNIPE_WAIT_SEC) passAtWait = got >= minOut;
            _assertAdapterEmpty(token);
            vm.revertToState(snap);
        }
        assertTrue(passAtWait, "engine buys at SNIPE_WAIT_SEC would revert (minOut) on the live curve");
    }

    /// @notice CurveBuy / CurveSell as the engine decodes them (topic0, 2 indexed, 4 words of data).
    function test_Live_CurveEventsMatchEngineAbi() public {
        vm.warp(launchTime + 120);
        vm.recordLogs();
        uint256 got = _engineBuy(0.02 ether, 0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (Vm.Log memory b, bool fb) = _findLog(logs, TOPIC_CURVE_BUY, address(curve));
        if (!fb) for (uint256 i; i < logs.length; i++) if (logs[i].emitter == address(curve)) console2.logBytes32(logs[i].topics[0]);
        assertTrue(fb, "live curve does not emit the engine's CurveBuy signature");
        assertEq(b.topics.length, 3); assertEq(b.data.length, 128, "CurveBuy data layout");
        (uint256 quoteIn, uint256 tokensOut,,) = abi.decode(b.data, (uint256, uint256, uint256, uint256));
        assertEq(quoteIn, 0.02 ether); assertEq(tokensOut, got);

        vm.recordLogs();
        _engineSell(token, got, 0);
        logs = vm.getRecordedLogs();
        (Vm.Log memory s, bool fs) = _findLog(logs, TOPIC_CURVE_SELL, address(curve));
        assertTrue(fs, "live curve does not emit the engine's CurveSell signature");
        assertEq(s.topics.length, 3); assertEq(s.data.length, 128, "CurveSell data layout");
        // engine reads
        curve.getReserves(); curve.trackedQuote(); curve.graduated();
        IERC20x(token).symbol(); IERC20x(token).totalSupply();
    }

    /// @notice Curve buy/sell, graduation (crossing buy by the agent), then v4 buy/sell, all via the agent wallet.
    function test_Live_AgentLifecycle() public {
        _liveCurveAndGraduation();
        _livePool();
    }

    function _liveCurveAndGraduation() internal {
        vm.warp(launchTime + 120);
        // curve buy + sell
        (, uint256 minB) = _engineMinOutBuyCurve(0.05 ether);
        uint256 got = _engineBuy(0.05 ether, minB);
        (, uint256 minS) = _engineMinOutSellCurve(got / 2);
        uint256 w = address(agent).balance;
        uint256 out = _engineSell(token, got / 2, minS);
        assertEq(address(agent).balance, w + out);
        _assertAdapterEmpty(token);

        // graduation: whale leaves 0.2 ETH, the agent's 1 ETH buy crosses (partial fill + refund)
        _whaleBuyToNearGraduation(0.2 ether);
        uint256 left = curve.sellableTokens();
        w = address(agent).balance;
        uint256 gotX = _engineBuy(1 ether, 0);
        assertEq(gotX, left, "partial fill = remaining allocation");
        assertLt(w - address(agent).balance, 0.3 ether, "refund");
        _assertAdapterEmpty(token);
        uint8 ph = _phase(token);
        console2.log("phase after the crossing buy: %s", ph);
        if (ph == 0) { vm.prank(keeper); factory.graduate(token); ph = _phase(token); }
        if (ph == 1) { vm.prank(keeper); factory.createGraduatedPool(token); }
        assertEq(_phase(token), 2, "PoolCreated");
    }

    function _livePool() internal {
        uint256 w;
        // v4: the pool the adapter computes is the pool Pons created
        LaunchedToken memory rec = factory.getLaunchedToken(token);
        PoolKey memory key = PoolKey(address(0), token, rec.poolFee, rec.tickSpacing, hook);
        uint160 sp = _slot0SqrtPrice(key);
        assertGt(sp, 0, "pool exists for the adapter's key");
        assertEq(adapter.poolPrice(token), sp);

        uint256 bal = IERC20x(token).balanceOf(address(agent));
        (, uint256 minV) = _engineMinOutSellPool(bal / 10);
        _engineSell(token, bal / 10, minV);
        uint256 simB = _simulateBuy(0.1 ether);
        _engineBuy(0.1 ether, simB * (100 - ENGINE_SLIPPAGE_PCT) / 100);
        uint256 all = IERC20x(token).balanceOf(address(agent));
        uint256 simS = _simulateSell(all);
        w = address(agent).balance;
        uint256 outAll = _engineSell(token, all, simS * (100 - ENGINE_SLIPPAGE_PCT) / 100);
        assertEq(address(agent).balance, w + outAll);
        assertEq(IERC20x(token).balanceOf(address(agent)), 0);
        _assertAdapterEmpty(token);
        assertEq(adapter.poolPrice(token), _slot0SqrtPrice(key));

        // v4 slippage protection
        vm.prank(engine);
        vm.expectRevert(_callFailed(abi.encodeWithSelector(IErrs.Slippage.selector)));
        agent.trade(0.01 ether, abi.encodeCall(IAdapter.buy, (token, type(uint128).max)));
    }

    /// @notice Optional: an already-graduated live coin (LIVE_GRADUATED_TOKEN=0x...), bought and sold on its v4 pool.
    function test_Live_ExistingGraduatedCoin() public {
        address g = vm.envOr("LIVE_GRADUATED_TOKEN", address(0));
        if (!live || g == address(0)) { vm.skip(true); return; }
        token = g;
        assertEq(adapter.venue(g), 2, "not a graduated ETH-paired Pons coin");
        uint256 got = _engineBuy(0.01 ether, _simulateBuy(0.01 ether) * 85 / 100);
        uint256 out = _engineSell(g, got, _simulateSell(got) * 85 / 100);
        console2.log("existing graduated coin round trip: 0.01 ETH -> %e tokens -> %e ETH", got, out);
        _assertAdapterEmpty(g);
    }
}
