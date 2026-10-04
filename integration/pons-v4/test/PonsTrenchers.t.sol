// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./Harness.sol";

/// @notice Real Pons V2 (verified-source snapshot) + real Uniswap v4 + real Trenchers, all deployed locally.
contract PonsTrenchersLocalTest is TrenchersHarness {
    function setUp() public {
        _deployLocalStack();
        _deployTrenchers();
        _awakenAgent();
        _launchCoin();
    }

    // =====================================================================================================
    // 1-5: the whole life of an ETH-paired Pons coin, traded by a Trenchers agent through PonsAdapter.
    // =====================================================================================================

    function test_FullLifecycle_CurveToV4() public {
        _stage1_Sanity();
        _stage2a_BuyLaunchSecond();
        _stage2b_BuyAfterWindow();
        _stage3_SellOnCurve();
        _stage4_CrossingBuy();
        _stage6b_Swept();
        _stage4b_CreatePool();
        _stage5a_SellV4();
        _stage5b_BuyV4();
        _stage5c_SellAllV4();
        _stage5d_PriceSanity();
        _stage5e_SlippageV4();
    }

    function _stage1_Sanity() internal {
        // ------------------------------------------------------------ sanity: adapter sees the real record
        LaunchedToken memory rec = factory.getLaunchedToken(token);
        assertEq(rec.token, token); assertEq(rec.curve, address(curve)); assertEq(rec.pairToken, address(0));
        assertEq(rec.poolFee, 0); assertEq(rec.tickSpacing, TICK_SPACING); assertEq(rec.phase, 0); assertTrue(rec.exists);
        assertEq(adapter.venue(token), 0, "venue = curve");
        // engine reads (abis.ts): getReserves, trackedQuote, graduated, symbol, totalSupply
        (uint256 q0, uint256 k0) = curve.getReserves();
        assertEq(q0, PHANTOM); assertEq(k0, SUPPLY);
        assertEq(curve.trackedQuote(), 0); assertFalse(curve.graduated());
        assertEq(IERC20x(token).symbol(), "PEPE"); assertEq(IERC20x(token).totalSupply(), SUPPLY);

    }

    function _stage2a_BuyLaunchSecond() internal {
        // ------------------------------------------------------------ 2a. BUY in the launch second
        assertEq(block.timestamp, launchTime);
        uint256 w0 = address(agent).balance;
        (uint256 exp0, uint256 min0) = _engineMinOutBuyCurve(0.01 ether);
        vm.recordLogs();
        got0 = _engineBuy(0.01 ether, min0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (uint256 quoteIn0, uint256 tokensOut0) = _checkCurveLog(logs, TOPIC_CURVE_BUY, address(agent));
        assertEq(quoteIn0, 0.01 ether); assertEq(tokensOut0, got0);
        assertEq(IERC20x(token).balanceOf(address(agent)), got0, "tokens to agent");
        assertEq(address(agent).balance, w0 - 0.01 ether, "spent exactly 0.01");
        _assertAdapterEmpty(token);
        {
            (Vm.Log memory b, bool f) = _findLog(logs, TOPIC_BOUGHT, address(adapter));
            assertTrue(f, "Bought");
            assertEq(address(uint160(uint256(b.topics[1]))), address(agent));
            assertEq(address(uint160(uint256(b.topics[2]))), token);
            (uint256 ethIn, uint256 tOut, uint256 refund) = abi.decode(b.data, (uint256, uint256, uint256));
            assertEq(ethIn, 0.01 ether); assertEq(tOut, got0); assertEq(refund, 0);
        }
        console2.log("launch-second buy: engine expected %e, got %e (%s bps below the fee-less quote)",
            exp0, got0, (exp0 - got0) * 10_000 / exp0);

    }

    function _stage2b_BuyAfterWindow() internal {
        // ------------------------------------------------------------ 2b. BUY after the (live) snipe window
        vm.warp(launchTime + 60);
        (, uint256 min1) = _engineMinOutBuyCurve(0.2 ether);
        got1 = _engineBuy(0.2 ether, min1);
        assertGt(got1, 0);
        held = IERC20x(token).balanceOf(address(agent));
        assertEq(held, got0 + got1);
        _assertAdapterEmpty(token);

        // slippage on the curve: an impossible minOut reverts (curve's SlippageExceeded, wrapped by the wallet)
        vm.prank(engine);
        vm.expectRevert();
        agent.trade(0.01 ether, abi.encodeCall(IAdapter.buy, (token, type(uint128).max)));

    }

    function _stage3_SellOnCurve() internal {
        // ------------------------------------------------------------ 3. approveRouter + SELL on the curve
        uint256 sellAmt = got1 / 2;
        (, uint256 minS) = _engineMinOutSellCurve(sellAmt);
        uint256 wBefore = address(agent).balance;
        vm.recordLogs();
        uint256 ethOut = _engineSell(token, sellAmt, minS);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (uint256 tokensIn, uint256 quoteOut) = _checkCurveLog(logs, TOPIC_CURVE_SELL, address(agent));
        assertEq(tokensIn, sellAmt); assertEq(quoteOut, ethOut);
        assertGt(ethOut, 0);
        assertEq(address(agent).balance, wBefore + ethOut, "ETH back in agent");
        assertEq(IERC20x(token).balanceOf(address(agent)), held - sellAmt);
        _assertAdapterEmpty(token);
        console2.log("curve sell: %e tokens -> %e ETH", sellAmt, ethOut);

    }

    function _stage4_CrossingBuy() internal {
        // ------------------------------------------------------------ 4. push to graduation
        // A whale buys until 0.2 ETH (gross) is left; the agent's 1 ETH buy then crosses: partial fill + refund,
        // and the crossing buy auto-graduates (phase 1 Swept) inside the same transaction.
        _whaleBuyToNearGraduation(0.2 ether);
        uint256 sellableLeft = curve.sellableTokens();
        uint256 agentTokBefore = IERC20x(token).balanceOf(address(agent));
        uint256 wBefore = address(agent).balance;
        vm.recordLogs();
        uint256 gotX = _engineBuy(1 ether, 0); // see test_EngineMinOut_PartialFill for minOut semantics
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(gotX, sellableLeft, "filled exactly the remaining sellable allocation");
        assertEq(IERC20x(token).balanceOf(address(agent)), agentTokBefore + gotX);
        uint256 spentX = wBefore - address(agent).balance;
        assertLt(spentX, 0.25 ether, "only ~0.2 ETH spent");
        assertGt(spentX, 0.15 ether);
        {
            (Vm.Log memory b,) = _findLog(logs, TOPIC_BOUGHT, address(adapter));
            (uint256 ethIn, , uint256 refund) = abi.decode(b.data, (uint256, uint256, uint256));
            assertEq(ethIn, spentX, "Bought.ethIn = net spent");
            assertEq(refund, 1 ether - spentX, "Bought.refund");
        }
        _assertAdapterEmpty(token);
        assertEq(_phase(token), 1, "auto-graduated to Swept inside the crossing buy");
        assertTrue(curve.graduated());

    }

    function _stage6b_Swept() internal {
        // ------------------------------------------------------------ 6b. Swept: not tradable anywhere
        // The venue view reports "not tradable" while no pool exists; an actual trade through the (now
        // patched-in) adapter would create the pool first: covered by test_Patched_SellDuringSwept_*.
        vm.expectRevert(IErrs.NotTradable.selector);
        adapter.venue(token);

    }

    function _stage4b_CreatePool() internal {
        // ------------------------------------------------------------ 4b. createGraduatedPool (permissionless)
        uint256 positionId = IPosm(posm).nextTokenId();
        vm.recordLogs();
        vm.prank(keeper);
        factory.createGraduatedPool(token);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_phase(token), 2, "PoolCreated");
        assertEq(adapter.venue(token), 2);
        assertTrue(ILocker(locker).isLocked(token));
        assertEq(IPosm(posm).ownerOf(positionId), locker, "LP NFT locked");
        {
            (Vm.Log memory g, bool f) = _findLog(logs, TOPIC_POOL_GRADUATED, address(factory));
            assertTrue(f, "PoolGraduated");
            assertEq(g.topics.length, 2);
            assertEq(address(uint160(uint256(g.topics[1]))), token);
            (uint256 pid, uint256 tAmt, uint256 qAmt) = abi.decode(g.data, (uint256, uint256, uint256));
            assertEq(pid, positionId); assertGt(tAmt, 0); assertGt(qAmt, THRESHOLD * 9 / 10);
            // pool initialized with the adapter's key: (ETH, coin, fee 0, tickSpacing, meme hook)
            (Vm.Log memory ini, bool fi) = _findLog(logs, TOPIC_V4_INIT, pm);
            assertTrue(fi, "Initialize");
            assertEq(ini.topics[1], keccak256(abi.encode(_poolKey())), "PoolId == keccak(adapter key)");
            assertEq(address(uint160(uint256(ini.topics[2]))), address(0), "currency0 = ETH");
            assertEq(address(uint160(uint256(ini.topics[3]))), token, "currency1 = coin");
            (uint24 fee, int24 ts, address hk, uint160 sp,) = abi.decode(ini.data, (uint24, int24, address, uint160, int24));
            assertEq(fee, 0); assertEq(ts, TICK_SPACING); assertEq(hk, hook);
            assertEq(adapter.poolPrice(token), sp, "poolPrice == initial sqrtPrice");
            // sanity: pool opens at the curve's terminal price, reserved / (phantom + threshold) coins per ETH
            uint256 coinsPerEth0 = (uint256(sp) * uint256(sp)) >> 192;
            uint256 terminal = SUPPLY * PHANTOM / ((PHANTOM + THRESHOLD) * (PHANTOM + THRESHOLD) / 1 ether) / 1 ether;
            console2.log("pool opens at %e coins/ETH; curve terminal price %e", coinsPerEth0, terminal);
            assertApproxEqRel(coinsPerEth0, terminal, 0.02e18, "pool opens at the curve's terminal price");
        }
        (bool registered,, address memecoin, address quote) = IHookView(hook).launches(keccak256(abi.encode(_poolKey())));
        assertTrue(registered); assertEq(memecoin, token); assertEq(quote, address(0));
        assertGt(_slot0SqrtPrice(_poolKey()), 0, "pool exists");

    }

    function _stage5a_SellV4() internal {
        // ------------------------------------------------------------ 5a. SELL pre-graduation tokens on v4
        uint256 bal = IERC20x(token).balanceOf(address(agent));
        uint256 sellV4 = bal / 10; // small vs the pool: the engine's spot-price quote is fine here
        (uint256 expS, uint256 minSV4) = _engineMinOutSellPool(sellV4);
        uint256 wBefore = address(agent).balance;
        vm.recordLogs();
        uint256 ethV4 = _engineSell(token, sellV4, minSV4);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(address(agent).balance, wBefore + ethV4, "ETH from v4 into agent");
        assertEq(IERC20x(token).balanceOf(address(agent)), bal - sellV4);
        _assertAdapterEmpty(token);
        {
            (Vm.Log memory s, bool f) = _findLog(logs, TOPIC_V4_SWAP, pm);
            assertTrue(f, "v4 Swap");
            (,, uint160 spAfter,,,) = abi.decode(s.data, (int128, int128, uint160, uint128, int24, uint24));
            assertEq(adapter.poolPrice(token), spAfter, "poolPrice == slot0 after swap");
            assertEq(adapter.poolPrice(token), _slot0SqrtPrice(_poolKey()));
        }
        console2.log("v4 sell: engine expected %e ETH, got %e", expS, ethV4);

    }

    function _stage5b_BuyV4() internal {
        // ------------------------------------------------------------ 5b. BUY on v4
        (uint256 expB, uint256 minB) = _engineMinOutBuyPool(0.3 ether);
        uint256 tokBefore = IERC20x(token).balanceOf(address(agent));
        uint256 wBefore = address(agent).balance;
        uint256 gotV4 = _engineBuy(0.3 ether, minB);
        assertEq(IERC20x(token).balanceOf(address(agent)), tokBefore + gotV4);
        assertEq(address(agent).balance, wBefore - 0.3 ether, "full 0.3 ETH spent, no refund");
        _assertAdapterEmpty(token);
        console2.log("v4 buy: engine expected %e tokens, got %e", expB, gotV4);

    }

    function _stage5c_SellAllV4() internal {
        // ------------------------------------------------------------ 5c. SELL again on v4 (everything)
        uint256 all = IERC20x(token).balanceOf(address(agent));
        (uint256 expAll,) = _engineMinOutSellPool(all);
        // Proposed engine fix: quote by simulating the exact trade (minOut 0), then apply the slippage.
        uint256 simAll = _simulateSell(all);
        uint256 minAll = simAll * (100 - ENGINE_SLIPPAGE_PCT) / 100;
        console2.log("v4 sell-all: %e coins; engine spot quote %e ETH; simulated %e ETH", all, expAll, simAll);
        uint256 wBefore = address(agent).balance;
        uint256 ethAll = _engineSell(token, all, minAll);
        assertEq(IERC20x(token).balanceOf(address(agent)), 0);
        assertEq(address(agent).balance, wBefore + ethAll);
        _assertAdapterEmpty(token);

    }

    function _stage5d_PriceSanity() internal {
        // ------------------------------------------------------------ 5d. poolPrice sanity
        // sqrtPriceX96 = sqrt(coins per ETH) * 2^96. Curve's terminal price ~ (SUPPLY*PHANTOM/(PHANTOM+THR)) / (PHANTOM+THR)
        uint256 sp2 = adapter.poolPrice(token);
        assertEq(sp2, _slot0SqrtPrice(_poolKey()));
        assertGt(sp2, 4295128739); assertLt(sp2, 1461446703485210103287273052203988822378723970342);
        console2.log("pool coins/ETH after the agent's trades %e", (sp2 * sp2) >> 192);

    }

    function _stage5e_SlippageV4() internal {
        // ------------------------------------------------------------ 5e. v4 slippage protection
        vm.prank(engine);
        vm.expectRevert(_callFailed(abi.encodeWithSelector(IErrs.Slippage.selector)));
        agent.trade(0.05 ether, abi.encodeCall(IAdapter.buy, (token, type(uint128).max)));
        // sell side: whale sells some to the agent... the agent has none left, so buy a little first
        uint256 small = _engineBuy(0.05 ether, 0);
        vm.prank(engine);
        agent.approveRouter(token, small);
        vm.prank(engine);
        vm.expectRevert(_callFailed(abi.encodeWithSelector(IErrs.Slippage.selector)));
        agent.trade(0, abi.encodeCall(IAdapter.sell, (token, small, 10 ether)));
        _assertAdapterEmpty(token);
    }

    // =====================================================================================================
    // 6. edge cases
    // =====================================================================================================

    /// @notice Engine-style minOut on a buy that will be partially filled: the curve treats minTokensOut as a
    ///         PRICE bound (spent * minOut <= received * tokensOut), so the engine's full-size quote still works.
    function test_EngineMinOut_PartialFill() public {
        vm.warp(launchTime + 60);
        _whaleBuyToNearGraduation(0.2 ether);
        uint256 left = curve.sellableTokens();
        (, uint256 minOut) = _engineMinOutBuyCurve(1 ether);
        uint256 got = _engineBuy(1 ether, minOut);
        assertEq(got, left);
        assertEq(_phase(token), 1);
        _assertAdapterEmpty(token);
    }

    /// @notice ENGINE ISSUE: after graduation the engine quotes from the pool's spot price (poolPrice * 0.98),
    ///         ignoring price impact. A sell worth a meaningful share of the pool's ETH side lands below
    ///         quote*(1-15%) and the adapter correctly reverts Slippage(), so the position can't be exited.
    function test_EngineQuote_PoolIgnoresPriceImpact() public {
        vm.warp(launchTime + 60);
        _engineBuy(1 ether, 0);                 // a 1 ETH curve position (the per-trade cap here)
        _whaleBuyToNearGraduation(0.2 ether);
        vm.prank(whale);
        curve.buy{value: 1 ether}(1 ether, 0, whale);   // crosses: Swept
        vm.prank(keeper);
        factory.createGraduatedPool(token);
        uint256 bal = IERC20x(token).balanceOf(address(agent));
        (uint256 exp, uint256 minOut) = _engineMinOutSellPool(bal);
        uint256 real = _simulateSell(bal);
        console2.log("1 ETH position after graduation: engine quote %e ETH, pool pays %e (%s bps short)",
            exp, real, (exp - real) * 10_000 / exp);
        vm.prank(engine); agent.approveRouter(token, bal);
        vm.prank(engine);
        vm.expectRevert(_callFailed(abi.encodeWithSelector(IErrs.Slippage.selector)));
        agent.trade(0, abi.encodeCall(IAdapter.sell, (token, bal, minOut)));
        // with a simulated quote the same exit goes through
        uint256 got = _engineSell(token, bal, real * (100 - ENGINE_SLIPPAGE_PCT) / 100);
        assertEq(got, real);
        _assertAdapterEmpty(token);
    }

    /// @notice The engine's fee-less curve quote vs the real fee stack: with the max creator tax (10%) plus a
    ///         1% curve fee the engine's 15% slippage still clears small buys; it fails once price impact eats the rest.
    function test_EngineSlippage_MaxCreatorTax() public {
        vm.prank(creator);
        (address t, address c) = factory.launchToken{value: LAUNCH_FEE}(_params("Taxed", "TAX", creator, 1000, false), 0, address(0));
        token = t; curve = ICurve(c);
        vm.warp(block.timestamp + 60);
        (uint256 exp, uint256 minOut) = _engineMinOutBuyCurve(0.1 ether);
        uint256 got = _engineBuy(0.1 ether, minOut);
        console2.log("max-tax coin: engine expected %e, got %e (%s bps short)", exp, got, (exp - got) * 10_000 / exp);
        assertGe(got, minOut);
        // a sell of everything also clears the engine's minOut
        (, uint256 minS) = _engineMinOutSellCurve(got);
        _engineSell(token, got, minS);
        // a 1 ETH buy (perTrade cap) still clears
        (, uint256 minBig) = _engineMinOutBuyCurve(1 ether);
        _engineBuy(1 ether, minBig);
    }

    function test_Reject_NonEthPair() public {
        address usd = vm.deployCode(_o("PairTokenMock"));
        vm.startPrank(ponsOwner);
        factory.setPairTokenEconomics(usd, PHANTOM, THRESHOLD, 18);
        factory.setPairTokenApproved(usd, true);
        vm.stopPrank();
        vm.prank(creator);
        (address t,) = factory.launchToken{value: LAUNCH_FEE}(_params("UsdCoin", "UC", creator, 0, false), 0, usd);
        assertEq(factory.getLaunchedToken(t).pairToken, usd);
        vm.expectRevert(IErrs.NotEthPaired.selector);
        adapter.venue(t);
        vm.prank(engine);
        vm.expectRevert(_callFailed(abi.encodeWithSelector(IErrs.NotEthPaired.selector)));
        agent.trade(0.01 ether, abi.encodeCall(IAdapter.buy, (t, 0)));
    }

    function test_Reject_NotPonsToken() public {
        address fake = vm.deployCode(_o("PairTokenMock"));
        vm.prank(engine);
        vm.expectRevert(_callFailed(abi.encodeWithSelector(IErrs.NotPonsToken.selector)));
        agent.trade(0.01 ether, abi.encodeCall(IAdapter.buy, (fake, 0)));
    }

    /// @notice The agent launches its own coin through the real factory (launchCoin), then the engine tries to
    ///         buy and to sell it: both refused (adapter OwnCoin, wallet NotAllowed on approveRouter).
    function test_Reject_OwnCoin() public {
        // CREATE addresses: the deployer creates the curve, then the token.
        uint64 n = vm.getNonce(launchDeployer);
        address predictedToken = vm.computeCreateAddress(launchDeployer, n + 1);
        bytes memory data = abi.encodeCall(IFactory.launchToken, (_params("Agent6", "AG6", address(0), 0, false), 0, address(0)));
        vm.prank(holder);
        agent.launchCoin(data, LAUNCH_FEE, predictedToken);
        assertEq(agent.coin(), predictedToken);
        LaunchedToken memory rec = factory.getLaunchedToken(predictedToken);
        assertEq(rec.token, predictedToken, "predicted address is the real coin");
        assertEq(rec.deployer, address(agent));
        vm.warp(block.timestamp + 60);
        vm.prank(engine);
        vm.expectRevert(_callFailed(abi.encodeWithSelector(IErrs.OwnCoin.selector)));
        agent.trade(0.01 ether, abi.encodeCall(IAdapter.buy, (predictedToken, 0)));
        vm.prank(engine);
        vm.expectRevert(IErrs.NotAllowed.selector);
        agent.approveRouter(predictedToken, 1);
        // the adapter itself still serves other callers for that coin
        vm.prank(whale);
        assertGt(adapter.buy{value: 0.01 ether}(predictedToken, 0), 0);
    }

    /// @notice If the crossing buy's auto-graduation fails (e.g. starved of gas), the launch sits in
    ///         NotGraduated with sellable == 0: the curve refuses both sides and the adapter reverts until
    ///         someone calls factory.graduate + createGraduatedPool (both permissionless).
    function test_StuckReadyToGraduate_NeedsPermissionlessGraduate() public {
        vm.warp(launchTime + 60);
        _engineBuy(0.1 ether, 0);
        _whaleBuyToNearGraduation(0.2 ether);
        // Simulate a failed auto-graduation: make factory.graduate revert during the crossing buy only.
        vm.mockCallRevert(address(factory), abi.encodeCall(IFactory.graduate, (token)), "starved");
        vm.prank(whale);
        curve.buy{value: 1 ether}(1 ether, 0, whale);
        vm.clearMockedCalls();
        assertTrue(curve.readyToGraduate());
        assertEq(_phase(token), 0, "still NotGraduated");
        assertEq(adapter.venue(token), 0, "adapter still routes to the curve");
        uint256 bal = IERC20x(token).balanceOf(address(agent));
        vm.prank(engine);
        agent.approveRouter(token, bal);
        // The adapter finishes the graduation itself (both permissionless steps), then sells on the pool.
        uint256 out = _engineSell(token, bal, 0);
        assertEq(_phase(token), 2);
        assertGt(out, 0);
        _assertAdapterEmpty(token);
    }

    // ----------------------------------------------------------------------------- proposed adapter fix

    /// @dev Swaps the agents' router to the patched adapter through AgentConfig's real 48h timelock.
    function _usePatchedAdapter() internal {
        address patched = vm.deployCode(_t("PonsAdapterPatched"), abi.encode(address(factory), safe));
        config.propose(1, patched);
        vm.warp(block.timestamp + 48 hours);
        config.execute(1);
        assertEq(config.router(), patched);
        adapter = IAdapter(patched);
    }

    /// @notice PATCH: a sell during Swept finishes graduation (createGraduatedPool) and sells on the new v4 pool.
    function test_Patched_SellDuringSwept_CreatesPoolAndSells() public {
        vm.warp(launchTime + 60);
        uint256 got = _engineBuy(0.2 ether, 0);
        _usePatchedAdapter();
        _whaleBuyToNearGraduation(0.2 ether);
        vm.prank(whale);
        curve.buy{value: 1 ether}(1 ether, 0, whale);
        assertEq(_phase(token), 1, "Swept");
        uint256 w = address(agent).balance;
        uint256 out = _engineSell(token, got, 0);
        assertEq(_phase(token), 2, "pool created by the agent's own sell");
        assertEq(address(agent).balance, w + out);
        assertGt(out, 0);
        _assertAdapterEmpty(token);
    }

    /// @notice PATCH: a buy on a curve whose auto-graduation failed runs graduate + createGraduatedPool, then buys on v4.
    function test_Patched_BuyOnStuckCurve_GraduatesAndBuysOnPool() public {
        vm.warp(launchTime + 60);
        _usePatchedAdapter();
        _whaleBuyToNearGraduation(0.2 ether);
        vm.mockCallRevert(address(factory), abi.encodeCall(IFactory.graduate, (token)), "starved");
        vm.prank(whale);
        curve.buy{value: 1 ether}(1 ether, 0, whale);
        vm.clearMockedCalls();
        assertEq(_phase(token), 0); assertTrue(curve.readyToGraduate());
        uint256 got = _engineBuy(0.1 ether, 1);
        assertEq(_phase(token), 2);
        assertEq(IERC20x(token).balanceOf(address(agent)), got);
        _assertAdapterEmpty(token);
    }

    /// @notice PATCH: while graduation cannot complete (seed reverts), behaviour is unchanged: NotTradable.
    function test_Patched_SweptButSeedFails_StillNotTradable() public {
        vm.warp(launchTime + 60);
        uint256 got = _engineBuy(0.2 ether, 0);
        _usePatchedAdapter();
        _whaleBuyToNearGraduation(0.2 ether);
        vm.prank(whale);
        curve.buy{value: 1 ether}(1 ether, 0, whale);
        vm.mockCallRevert(address(factory), abi.encodeCall(IFactory.createGraduatedPool, (token)), "seed fails");
        vm.prank(engine); agent.approveRouter(token, got);
        vm.prank(engine);
        vm.expectRevert(_callFailed(abi.encodeWithSelector(IErrs.NotTradable.selector)));
        agent.trade(0, abi.encodeCall(IAdapter.sell, (token, got, 0)));
    }

    /// @notice The adapter's unlockCallback can only be entered by the PoolManager during the adapter's own swap.
    function test_UnlockCallback_NotCallableFromOutside() public {
        vm.expectRevert(bytes4(keccak256("NotPoolManager()")));
        IUnlockCb(address(adapter)).unlockCallback(hex"00");
        vm.prank(pm); // even the PoolManager, outside the adapter's own unlock
        vm.expectRevert(bytes4(keccak256("NotPoolManager()")));
        IUnlockCb(address(adapter)).unlockCallback(hex"00");
    }

    /// @notice Engine trades spend the locked starter balance too (by design); it stays in the wallet as tokens.
    function test_StarterOnlyAgent_CanTrade() public {
        // a second Trencher whose wallet holds only the 0.01 ETH starter
        address h2 = makeAddr("holder2"); vm.deal(h2, 1 ether);
        vm.startPrank(h2);
        INFT(nft).mint{value: 0.02 ether}(1);
        IFund(fund).claim(7);
        IAgent a2 = IAgent(IFund(fund).agentWallet(7));
        a2.setPolicy(0.01 ether, 0.01 ether, true, keccak256("r"), "r");
        vm.stopPrank();
        vm.warp(launchTime + 60);
        vm.prank(engine);
        a2.trade(0.01 ether, abi.encodeCall(IAdapter.buy, (token, 0)));
        assertGt(IERC20x(token).balanceOf(address(a2)), 0);
        assertEq(address(a2).balance, 0);
        // the sale proceeds stay counted as starter (lockedNow = min(starterLocked, balance)): by design
        uint256 b = IERC20x(token).balanceOf(address(a2));
        vm.prank(engine); a2.approveRouter(token, b);
        vm.prank(engine); a2.trade(0, abi.encodeCall(IAdapter.sell, (token, b, 0)));
        console2.log("starter-only agent after round trip: balance %e, lockedNow %e, withdrawable %e",
            address(a2).balance, a2.lockedNow(), a2.withdrawable());
    }
}
