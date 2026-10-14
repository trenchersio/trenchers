// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseTest} from "./helpers/BaseTest.sol";
import {TrenchersCreditPool as Pool} from "../src/TrenchersCreditPool.sol";
import {CreditCalls} from "../src/CreditCalls.sol";
import {IAgentRegistry, IWETH} from "../src/interfaces/ICreditDeps.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockHook, WeirdHook, Mock1271Wallet, NoEth} from "./mocks/MockHooks.sol";

contract TrenchersCreditPoolTest is BaseTest {
    uint256 internal backerId;
    address internal backerOwner;
    uint256 internal agentId;
    address internal agentOwner;
    uint256 internal agentPk;

    uint64 internal constant T30 = 30 days;

    function setUp() public override {
        super.setUp();
        lend(alice, 10 ether);
        (backerId, backerOwner) = newBacker("backer", 1 ether);
        (agentId, agentOwner, agentPk) = newAgent("agent");
    }

    function _open(uint256 amount, uint256 premium) internal {
        openLineAs(backerOwner, backerId, agentId, agentOwner, agentPk, amount, premium);
    }

    function _borrow(uint256 amount, uint64 term) internal returns (uint256) {
        return borrowAs(agentOwner, agentId, amount, term);
    }

    // ================================================================== construction, seeding

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(Pool.InvalidParams.selector);
        new Pool(IWETH(address(0)), IAgentRegistry(address(registry)), buyback, timelock, guardian, defaultParams());
        vm.expectRevert(Pool.InvalidParams.selector);
        new Pool(IWETH(address(weth)), IAgentRegistry(address(0)), buyback, timelock, guardian, defaultParams());
        vm.expectRevert(Pool.InvalidParams.selector);
        new Pool(IWETH(address(weth)), IAgentRegistry(address(registry)), address(0), timelock, guardian, defaultParams());
    }

    function test_seed_wrongValue_andTwice() public {
        Pool p = new Pool(IWETH(address(weth)), IAgentRegistry(address(registry)), buyback, timelock, guardian, defaultParams());
        vm.expectRevert(abi.encodeWithSelector(Pool.WrongValue.selector, SEED - 1, SEED));
        p.seed{value: SEED - 1}();
        vm.expectRevert(abi.encodeWithSelector(Pool.WrongValue.selector, SEED + 1, SEED));
        p.seed{value: SEED + 1}();

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(Pool.NotSeeded.selector);
        p.deposit{value: 1 ether}(1 ether, alice, 0);

        p.seed{value: SEED}();
        assertTrue(p.seeded());
        assertEq(p.shares(p.DEAD()), SEED);
        assertEq(p.totalShares(), SEED);
        assertEq(p.poolLiquidity(), SEED);
        assertEq(weth.balanceOf(address(p)), SEED);

        vm.expectRevert(Pool.AlreadySeeded.selector);
        p.seed{value: SEED}();
    }

    function test_receive_rejectsNonWeth() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok, bytes memory ret) = address(pool).call{value: 1}("");
        assertFalse(ok);
        assertEq(bytes4(ret), Pool.NotWeth.selector);
    }

    // ================================================================== lenders

    function test_deposit_eth() public {
        uint256 price0 = sharePrice();
        uint256 minted = lend(bob, 2 ether);
        assertEq(minted, pool.convertToShares(2 ether));
        assertEq(pool.shares(bob), minted);
        assertEq(pool.lastDepositAt(bob), vm.getBlockTimestamp());
        assertEq(sharePrice(), price0);
        assertTrue(wethSolvent());
    }

    function test_deposit_weth() public {
        vm.deal(bob, 1 ether);
        vm.startPrank(bob);
        weth.deposit{value: 1 ether}();
        weth.approve(address(pool), 1 ether);
        uint256 minted = pool.deposit(1 ether, bob, 0);
        vm.stopPrank();
        assertEq(pool.shares(bob), minted);
        assertEq(weth.balanceOf(bob), 0);
    }

    function test_deposit_wethWithoutApproval_reverts() public {
        vm.deal(bob, 1 ether);
        vm.startPrank(bob);
        weth.deposit{value: 1 ether}();
        vm.expectRevert();
        pool.deposit(1 ether, bob, 0);
        vm.stopPrank();
    }

    function test_deposit_wrongValue_zero_slippage() public {
        vm.deal(bob, 10 ether);
        vm.startPrank(bob);
        vm.expectRevert(abi.encodeWithSelector(Pool.WrongValue.selector, 1 ether, 2 ether));
        pool.deposit{value: 1 ether}(2 ether, bob, 0);
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.deposit(0, bob, 0);
        uint256 expected = pool.convertToShares(1 ether);
        vm.expectRevert(abi.encodeWithSelector(Pool.SlippageShares.selector, expected, expected + 1));
        pool.deposit{value: 1 ether}(1 ether, bob, expected + 1);
        pool.deposit{value: 1 ether}(1 ether, bob, expected);
        vm.stopPrank();
    }

    function test_deposit_tooSmallForAShare_reverts() public {
        // push the share price above 1 so 1 wei mints 0 shares
        _open(0.25 ether, 0);
        uint256 id = _borrow(0.25 ether, T30);
        repayEth(id);
        assertGt(sharePrice(), 1e18);
        vm.deal(bob, 1);
        vm.prank(bob);
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.deposit{value: 1}(1, bob, 0);
    }

    function test_withdraw_earlyExitFee() public {
        uint256 s = pool.shares(alice);
        uint256 assets = pool.convertToAssets(s / 2);
        uint256 priceBefore = sharePrice();
        uint256 balBefore = alice.balance;
        vm.prank(alice);
        uint256 out = pool.withdraw(s / 2, alice, true);
        uint256 fee = assets * 50 / 10_000;
        assertEq(out, assets - fee);
        assertEq(alice.balance - balBefore, assets - fee);
        assertGt(sharePrice(), priceBefore, "exit fee stays with the lenders");
        assertTrue(wethSolvent());
    }

    function test_withdraw_afterHold_noFee() public {
        vm.warp(vm.getBlockTimestamp() + 7 days);
        uint256 s = pool.shares(alice);
        uint256 assets = pool.convertToAssets(s);
        vm.prank(alice);
        uint256 out = pool.withdraw(s, alice, true);
        assertEq(out, assets);
        assertEq(pool.shares(alice), 0);
    }

    function test_withdraw_justBeforeHold_paysFee() public {
        vm.warp(vm.getBlockTimestamp() + 7 days - 1);
        uint256 s = pool.shares(alice);
        uint256 assets = pool.convertToAssets(s);
        vm.prank(alice);
        uint256 out = pool.withdraw(s, alice, true);
        assertEq(out, assets - assets * 50 / 10_000);
    }

    function test_withdraw_asWeth() public {
        vm.warp(vm.getBlockTimestamp() + 8 days);
        uint256 s = pool.shares(alice);
        vm.prank(alice);
        uint256 out = pool.withdraw(s, bob, false);
        assertEq(weth.balanceOf(bob), out);
        assertEq(out, 10 ether);
    }

    function test_withdraw_reverts() public {
        vm.prank(alice);
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.withdraw(0, alice, true);

        // more shares than held: underflow
        uint256 s = pool.shares(alice);
        vm.prank(alice);
        vm.expectRevert();
        pool.withdraw(s + 1, alice, true);

        // a lender cannot take someone else's shares
        vm.prank(bob);
        vm.expectRevert();
        pool.withdraw(1 ether, bob, true);

        // a receiver that refuses ETH
        NoEth no = new NoEth();
        vm.prank(alice);
        vm.expectRevert(Pool.EthSendFailed.selector);
        pool.withdraw(1 ether, address(no), true);
    }

    function test_shareWeightedClock() public {
        uint256 t0 = vm.getBlockTimestamp();
        lend(bob, 1 ether);
        vm.warp(t0 + 6 days);
        // a dust deposit (from anyone) barely moves the clock
        address griefer = makeAddr("griefer");
        vm.deal(griefer, 1 gwei);
        vm.prank(griefer);
        pool.deposit{value: 1 gwei}(1 gwei, bob, 0);
        assertEq(pool.lastDepositAt(bob), t0);
        // an equal deposit moves it halfway
        lend(bob, 1 ether);
        uint256 clock = pool.lastDepositAt(bob);
        assertApproxEqAbs(clock, t0 + 3 days, 1);
        vm.warp(clock + 7 days);
        uint256 s = pool.shares(bob);
        uint256 assets = pool.convertToAssets(s);
        vm.prank(bob);
        assertEq(pool.withdraw(s, bob, true), assets);
    }

    function test_clock_resetsAfterFullExit() public {
        vm.warp(vm.getBlockTimestamp() + 30 days);
        uint256 s = pool.shares(alice);
        vm.prank(alice);
        pool.withdraw(s, alice, true);
        lend(alice, 1 ether);
        assertEq(pool.lastDepositAt(alice), vm.getBlockTimestamp());
    }

    function test_lendersCanAlwaysExit_whileLent() public {
        _open(0.25 ether, 0);
        _borrow(0.25 ether, T30);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        uint256 s = pool.shares(alice);
        uint256 assets = pool.convertToAssets(s);
        vm.prank(alice);
        assertEq(pool.withdraw(s, alice, true), assets);
    }

    function test_soloBacker_cannotUnlockWhatIsLent() public {
        // A pool with only the seed and one backer: the loan is the backer's own money.
        Pool p = new Pool(IWETH(address(weth)), IAgentRegistry(address(registry)), buyback, timelock, guardian, defaultParams());
        p.seed{value: SEED}();
        (uint256 b, address bo,) = newAgent("solo-backer");
        vm.deal(bo, 0.3 ether);
        vm.prank(bo);
        p.registerBacker{value: 0.3 ether}(b, 0.3 ether);
        (uint256 a, address ao, uint256 apk) = newAgent("solo-agent");
        Pool.Consent memory c = Pool.Consent(a, b, ao, 0, 0, vm.getBlockTimestamp() + 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(apk, p.consentDigest(c));
        vm.prank(bo);
        p.openLine(b, a, 0.25 ether, 0, c, abi.encodePacked(r, s, v));
        vm.prank(ao);
        p.borrow(a, 0.25 ether, T30, ao, type(uint256).max, true);
        // the DEAD shares can never be withdrawn, and the backer cannot unlock what stands behind the line
        uint256 all = p.backerShares(b);
        vm.prank(bo);
        vm.expectPartialRevert(Pool.InsufficientBacking.selector);
        p.unlockBacking(b, all, bo, true);
    }

    // ================================================================== backers

    function test_registerBacker() public {
        assertTrue(pool.getAgent(backerId).isBacker);
        assertEq(pool.backing(backerId), 1 ether);
        assertEq(pool.freeBacking(backerId), 1 ether);
        assertTrue(pool.getAgent(backerId).enrolled);
    }

    function test_registerBacker_reverts() public {
        // not the owner
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotOwnerOf.selector, backerId, alice));
        pool.registerBacker{value: 0.1 ether}(backerId, 0.1 ether);
        // twice
        vm.deal(backerOwner, 1 ether);
        vm.prank(backerOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.IsBacker.selector, backerId));
        pool.registerBacker{value: 0.1 ether}(backerId, 0.1 ether);
        // below the minimum
        (uint256 id, address o,) = newAgent("small");
        vm.deal(o, 1 ether);
        vm.prank(o);
        vm.expectRevert(abi.encodeWithSelector(Pool.BelowMinBacking.selector, 0.001 ether, 0.01 ether));
        pool.registerBacker{value: 0.001 ether}(id, 0.001 ether);
        // an agent with a line
        _open(0.1 ether, 0);
        vm.deal(agentOwner, 1 ether);
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.LoanOpen.selector, agentId));
        pool.registerBacker{value: 0.1 ether}(agentId, 0.1 ether);
        // an unknown identity
        vm.prank(o);
        vm.expectRevert(abi.encodeWithSelector(Pool.InvalidAgent.selector, 999));
        pool.registerBacker{value: 0.1 ether}(999, 0.1 ether);
    }

    function test_registerBacker_defaultedAgent_reverts() public {
        _open(0.1 ether, 0);
        uint256 id = _borrow(0.1 ether, T30);
        vm.warp(vm.getBlockTimestamp() + 34 days);
        pool.markDefault(id);
        // line cleared, but the agent is marked
        assertEq(pool.getAgent(agentId).backer, 0);
        vm.deal(agentOwner, 1 ether);
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.AgentDefaulted.selector, agentId));
        pool.registerBacker{value: 0.1 ether}(agentId, 0.1 ether);
    }

    function test_registerBacker_weth() public {
        (uint256 id, address o,) = newAgent("weth-backer");
        vm.deal(o, 1 ether);
        vm.startPrank(o);
        weth.deposit{value: 0.5 ether}();
        weth.approve(address(pool), 0.5 ether);
        pool.registerBacker(id, 0.5 ether);
        vm.stopPrank();
        assertEq(pool.backing(id), 0.5 ether);
    }

    function test_addBacking_byAnyone() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        pool.addBacking{value: 0.5 ether}(backerId, 0.5 ether);
        assertEq(pool.backing(backerId), 1.5 ether);
        // bob cannot take it out
        uint256 s = pool.backerShares(backerId);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotOwnerOf.selector, backerId, bob));
        pool.unlockBacking(backerId, s, bob, true);
        // only a backer can be backed
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotBacker.selector, agentId));
        pool.addBacking{value: 0.1 ether}(agentId, 0.1 ether);
    }

    function test_unlockBacking_free() public {
        vm.warp(vm.getBlockTimestamp() + 7 days); // past the hold: no exit fee
        uint256 s = pool.backerShares(backerId);
        uint256 bal = backerOwner.balance;
        vm.prank(backerOwner);
        uint256 out = pool.unlockBacking(backerId, s, backerOwner, true);
        assertEq(out, 1 ether, "no exit fee");
        assertEq(backerOwner.balance - bal, 1 ether);
        assertEq(pool.backerShares(backerId), 0);
    }

    function test_unlockBacking_weth_andZero() public {
        vm.prank(backerOwner);
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.unlockBacking(backerId, 0, backerOwner, false);
        uint256 s = pool.backerShares(backerId) / 4;
        vm.prank(backerOwner);
        uint256 out = pool.unlockBacking(backerId, s, bob, false);
        assertEq(weth.balanceOf(bob), out);
    }

    function test_unlockBacking_cannotUnlockLines() public {
        vm.warp(vm.getBlockTimestamp() + 7 days); // past the hold, so the free part comes out whole
        _open(0.6 ether, 0);
        uint256 s = pool.convertToShares(0.41 ether);
        vm.prank(backerOwner);
        vm.expectPartialRevert(Pool.InsufficientBacking.selector);
        pool.unlockBacking(backerId, s, backerOwner, true);
        // the free part can go
        s = pool.convertToShares(0.4 ether);
        vm.prank(backerOwner);
        pool.unlockBacking(backerId, s, backerOwner, true);
        assertEq(pool.freeBacking(backerId), 0);
    }

    function test_unlockBacking_cannotUnlockLockedFees() public {
        _open(0.9 ether, 0);
        _borrow(0.25 ether, T30); // fee 0.0025
        (uint256 fee,,,) = pool.quoteFee(agentId, 0.25 ether, T30);
        assertEq(pool.feeLocked(backerId), fee);
        assertEq(pool.freeBacking(backerId), 0.1 ether - fee);
        uint256 s = pool.convertToShares(0.1 ether);
        vm.prank(backerOwner);
        vm.expectPartialRevert(Pool.InsufficientBacking.selector);
        pool.unlockBacking(backerId, s, backerOwner, true);
        s = pool.convertToShares(0.1 ether - fee);
        vm.prank(backerOwner);
        pool.unlockBacking(backerId, s, backerOwner, true);
    }

    function test_unlockBacking_earlyExitFee() public {
        uint256 t0 = vm.getBlockTimestamp();
        assertEq(pool.lastBackingAt(backerId), t0);
        uint256 s = pool.backerShares(backerId) / 2;
        uint256 gross = pool.convertToAssets(s);
        uint256 price = sharePrice();
        uint256 bal = backerOwner.balance;
        vm.prank(backerOwner);
        uint256 out = pool.unlockBacking(backerId, s, backerOwner, true);
        assertEq(out, gross - gross * 50 / 10_000);
        assertEq(backerOwner.balance - bal, out);
        assertGt(sharePrice(), price, "the 0.5% stays in the pool");
        assertTrue(wethSolvent());

        // one second before the hold ends: still charged; at the end: free
        vm.warp(t0 + 7 days - 1);
        s = pool.backerShares(backerId) / 4;
        gross = pool.convertToAssets(s);
        vm.prank(backerOwner);
        assertEq(pool.unlockBacking(backerId, s, backerOwner, true), gross - gross * 50 / 10_000);
        vm.warp(t0 + 7 days);
        s = pool.backerShares(backerId) / 4;
        gross = pool.convertToAssets(s);
        vm.prank(backerOwner);
        assertEq(pool.unlockBacking(backerId, s, backerOwner, false), gross);
    }

    function test_backingClock_shareWeighted() public {
        uint256 t0 = vm.getBlockTimestamp();
        vm.warp(t0 + 6 days);
        // dust from anyone barely moves the clock
        vm.deal(bob, 2 ether);
        vm.prank(bob);
        pool.addBacking{value: 1 gwei}(backerId, 1 gwei);
        assertEq(pool.lastBackingAt(backerId), t0);
        // an equal amount moves it halfway
        uint256 sh = pool.backerShares(backerId);
        uint256 amt = pool.convertToAssets(sh);
        vm.prank(bob);
        pool.addBacking{value: amt}(backerId, amt);
        uint256 clock = pool.lastBackingAt(backerId);
        assertApproxEqAbs(clock, t0 + 3 days, 1);
        // fee until clock + 7 days
        vm.warp(clock + 7 days - 1);
        uint256 s = pool.backerShares(backerId) / 10;
        uint256 gross = pool.convertToAssets(s);
        vm.prank(backerOwner);
        assertEq(pool.unlockBacking(backerId, s, backerOwner, true), gross - gross * 50 / 10_000);
        vm.warp(clock + 7 days);
        s = pool.backerShares(backerId) / 10;
        gross = pool.convertToAssets(s);
        vm.prank(backerOwner);
        assertEq(pool.unlockBacking(backerId, s, backerOwner, true), gross);
    }

    function test_backingClock_resetsWhenEmpty() public {
        vm.warp(vm.getBlockTimestamp() + 30 days);
        uint256 s = pool.backerShares(backerId);
        vm.prank(backerOwner);
        pool.unlockBacking(backerId, s, backerOwner, true);
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        pool.addBacking{value: 0.1 ether}(backerId, 0.1 ether);
        assertEq(pool.lastBackingAt(backerId), vm.getBlockTimestamp());
    }

    function test_backingClock_lenderClockSeparate() public {
        // a backer owner who is also a lender: each clock stands on its own
        vm.warp(vm.getBlockTimestamp() + 10 days);
        lend(backerOwner, 1 ether);
        uint256 s = pool.backerShares(backerId);
        uint256 gross = pool.convertToAssets(s);
        vm.prank(backerOwner);
        assertEq(pool.unlockBacking(backerId, s, backerOwner, true), gross, "backing is past its hold");
        uint256 ls = pool.shares(backerOwner);
        uint256 la = pool.convertToAssets(ls);
        vm.prank(backerOwner);
        assertEq(pool.withdraw(ls, backerOwner, true), la - la * 50 / 10_000, "the deposit is not");
    }

    function test_push_zeroAddressReverts() public {
        // withdraw
        uint256 s = pool.shares(alice);
        vm.startPrank(alice);
        vm.expectRevert(Pool.InvalidParams.selector);
        pool.withdraw(s, address(0), true);
        vm.expectRevert(Pool.InvalidParams.selector);
        pool.withdraw(s, address(0), false);
        vm.stopPrank();
        // unlockBacking
        uint256 bs = pool.backerShares(backerId) / 2;
        vm.startPrank(backerOwner);
        vm.expectRevert(Pool.InvalidParams.selector);
        pool.unlockBacking(backerId, bs, address(0), true);
        vm.expectRevert(Pool.InvalidParams.selector);
        pool.unlockBacking(backerId, bs, address(0), false);
        vm.stopPrank();
        // borrow
        _open(0.25 ether, 0);
        vm.startPrank(agentOwner);
        vm.expectRevert(Pool.InvalidParams.selector);
        pool.borrow(agentId, 0.1 ether, T30, address(0), type(uint256).max, true);
        vm.expectRevert(Pool.InvalidParams.selector);
        pool.borrow(agentId, 0.1 ether, T30, address(0), type(uint256).max, false);
        vm.stopPrank();
        // claimBackerFees
        repayEth(_borrow(0.1 ether, T30));
        vm.startPrank(backerOwner);
        vm.expectRevert(Pool.InvalidParams.selector);
        pool.claimBackerFees(backerId, address(0), true);
        vm.expectRevert(Pool.InvalidParams.selector);
        pool.claimBackerFees(backerId, address(0), false);
        pool.claimBackerFees(backerId, backerOwner, false);
        vm.stopPrank();
        assertTrue(wethSolvent());
    }

    function test_retireBacker() public {
        vm.prank(backerOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.StillBacking.selector, backerId));
        pool.retireBacker(backerId);

        MockHook h = new MockHook();
        vm.prank(backerOwner);
        pool.setHook(backerId, address(h));

        uint256 s = pool.backerShares(backerId);
        vm.prank(backerOwner);
        pool.unlockBacking(backerId, s, backerOwner, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotOwnerOf.selector, backerId, alice));
        pool.retireBacker(backerId);
        vm.prank(backerOwner);
        pool.retireBacker(backerId);
        assertFalse(pool.getAgent(backerId).isBacker);
        assertEq(pool.hook(backerId), address(0));
        vm.prank(backerOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotBacker.selector, backerId));
        pool.retireBacker(backerId);
    }

    function test_retireBacker_withLineButNoShares_blocked() public {
        _open(0.1 ether, 0);
        // cannot get shares to 0 while a line is out
        uint256 s = pool.backerShares(backerId);
        vm.prank(backerOwner);
        vm.expectPartialRevert(Pool.InsufficientBacking.selector);
        pool.unlockBacking(backerId, s, backerOwner, true);
        vm.prank(backerOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.StillBacking.selector, backerId));
        pool.retireBacker(backerId);
    }

    // ================================================================== hooks

    function test_setHook_immediateWhileBackingNothing() public {
        MockHook h = new MockHook();
        vm.prank(backerOwner);
        pool.setHook(backerId, address(h));
        assertEq(pool.hook(backerId), address(h));
        assertEq(pool.hookEta(backerId), 0);
    }

    function test_setHook_invalid() public {
        vm.startPrank(backerOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.InvalidHook.selector, alice));
        pool.setHook(backerId, alice);
        vm.expectRevert(abi.encodeWithSelector(Pool.InvalidHook.selector, address(pool)));
        pool.setHook(backerId, address(pool));
        vm.expectRevert(abi.encodeWithSelector(Pool.InvalidHook.selector, address(weth)));
        pool.setHook(backerId, address(weth));
        vm.expectRevert(abi.encodeWithSelector(Pool.InvalidHook.selector, address(registry)));
        pool.setHook(backerId, address(registry));
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotOwnerOf.selector, backerId, alice));
        pool.setHook(backerId, address(0));
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotBacker.selector, agentId));
        pool.setHook(agentId, address(0));
    }

    function test_setHook_queuedWhileLinesOut() public {
        MockHook h1 = new MockHook();
        MockHook h2 = new MockHook();
        vm.prank(backerOwner);
        pool.setHook(backerId, address(h1));
        _open(0.1 ether, 0);

        vm.prank(backerOwner);
        pool.setHook(backerId, address(h2));
        assertEq(pool.hook(backerId), address(h1), "not yet");
        assertEq(pool.pendingHook(backerId), address(h2));
        uint64 eta = uint64(vm.getBlockTimestamp() + 48 hours);
        assertEq(pool.hookEta(backerId), eta);

        vm.expectRevert(abi.encodeWithSelector(Pool.HookNotReady.selector, eta));
        pool.applyHook(backerId);
        vm.warp(eta - 1);
        vm.expectRevert(abi.encodeWithSelector(Pool.HookNotReady.selector, eta));
        pool.applyHook(backerId);
        vm.warp(eta);
        vm.prank(bob); // anyone
        pool.applyHook(backerId);
        assertEq(pool.hook(backerId), address(h2));
        assertEq(pool.hookEta(backerId), 0);
        vm.expectRevert(abi.encodeWithSelector(Pool.HookNotReady.selector, 0));
        pool.applyHook(backerId);

        // removing a hook is queued too
        vm.prank(backerOwner);
        pool.setHook(backerId, address(0));
        assertEq(pool.hook(backerId), address(h2));
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        pool.applyHook(backerId);
        assertEq(pool.hook(backerId), address(0));
    }

    // ================================================================== consent and lines

    function test_openLine() public {
        _open(0.2 ether, 50);
        Pool.Agent memory a = pool.getAgent(agentId);
        assertEq(a.backer, backerId);
        assertEq(a.line, 0.2 ether);
        assertEq(a.premiumBps, 50);
        assertEq(a.premiumCap, 200);
        assertTrue(a.enrolled);
        assertEq(a.enrolledAt, vm.getBlockTimestamp());
        assertEq(pool.getAgent(backerId).linesOut, 0.2 ether);
        assertEq(pool.nonces(agentId), 1);
        assertEq(pool.freeBacking(backerId), 0.8 ether);
    }

    function test_openLine_zeroAmount_setsBackerOnly() public {
        _open(0, 0);
        assertEq(pool.getAgent(agentId).backer, backerId);
        assertEq(pool.getAgent(agentId).line, 0);
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.InsufficientLine.selector, agentId, 0.01 ether, 0));
        pool.borrow(agentId, 0.01 ether, T30, agentOwner, type(uint256).max, true);
    }

    function test_openLine_wrongSigner() public {
        (, uint256 otherPk) = makeAddrAndKey("other");
        Pool.Consent memory c = consentFor(agentId, backerId, agentOwner, 0, vm.getBlockTimestamp() + 1);
        bytes memory sig = sign(c, otherPk);
        vm.prank(backerOwner);
        vm.expectRevert(Pool.BadConsent.selector);
        pool.openLine(backerId, agentId, 0.1 ether, 0, c, sig);
    }

    function test_openLine_signerNotOwner() public {
        // a correctly signed consent by someone who does not own the agent
        (address other, uint256 otherPk) = makeAddrAndKey("other");
        Pool.Consent memory c = consentFor(agentId, backerId, other, 0, vm.getBlockTimestamp() + 1);
        bytes memory sig = sign(c, otherPk);
        vm.prank(backerOwner);
        vm.expectRevert(Pool.BadConsent.selector);
        pool.openLine(backerId, agentId, 0.1 ether, 0, c, sig);
    }

    function test_openLine_wrongNonce_andReplay() public {
        Pool.Consent memory c = consentFor(agentId, backerId, agentOwner, 0, vm.getBlockTimestamp() + 1);
        c.nonce = 1;
        bytes memory sig = sign(c, agentPk);
        vm.prank(backerOwner);
        vm.expectRevert(Pool.BadConsent.selector);
        pool.openLine(backerId, agentId, 0.1 ether, 0, c, sig);

        c.nonce = 0;
        sig = sign(c, agentPk);
        vm.prank(backerOwner);
        pool.openLine(backerId, agentId, 0.1 ether, 0, c, sig);
        // replay
        vm.prank(backerOwner);
        vm.expectRevert(Pool.BadConsent.selector);
        pool.openLine(backerId, agentId, 0.1 ether, 0, c, sig);
    }

    function test_openLine_expired() public {
        Pool.Consent memory c = consentFor(agentId, backerId, agentOwner, 0, vm.getBlockTimestamp());
        bytes memory sig = sign(c, agentPk);
        vm.warp(vm.getBlockTimestamp() + 1);
        vm.prank(backerOwner);
        vm.expectRevert(Pool.ConsentExpired.selector);
        pool.openLine(backerId, agentId, 0.1 ether, 0, c, sig);
    }

    function test_openLine_deadlineInclusive() public {
        Pool.Consent memory c = consentFor(agentId, backerId, agentOwner, 0, vm.getBlockTimestamp());
        bytes memory sig = sign(c, agentPk);
        vm.prank(backerOwner);
        pool.openLine(backerId, agentId, 0.1 ether, 0, c, sig);
    }

    function test_openLine_premiumChecks() public {
        // a consent above the protocol cap is bad
        Pool.Consent memory c = consentFor(agentId, backerId, agentOwner, 201, vm.getBlockTimestamp() + 1);
        bytes memory sig = sign(c, agentPk);
        vm.prank(backerOwner);
        vm.expectRevert(Pool.BadConsent.selector);
        pool.openLine(backerId, agentId, 0.1 ether, 0, c, sig);
        // a premium above the consent
        c.maxPremiumBps = 100;
        sig = sign(c, agentPk);
        vm.prank(backerOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.PremiumTooHigh.selector, 101, 100));
        pool.openLine(backerId, agentId, 0.1 ether, 101, c, sig);
        vm.prank(backerOwner);
        pool.openLine(backerId, agentId, 0.1 ether, 100, c, sig);
    }

    function test_openLine_onlyBackerOwner() public {
        (Pool.Consent memory c, bytes memory sig) = signedConsent(agentId, backerId, agentOwner, agentPk, 0);
        vm.prank(alice); // front-runner with the signature
        vm.expectRevert(abi.encodeWithSelector(Pool.NotOwnerOf.selector, backerId, alice));
        pool.openLine(backerId, agentId, 0.1 ether, 0, c, sig);
    }

    function test_openLine_consentForOtherBacker() public {
        (uint256 b2, address b2o) = newBacker("backer2", 1 ether);
        (Pool.Consent memory c, bytes memory sig) = signedConsent(agentId, backerId, agentOwner, agentPk, 0);
        vm.prank(b2o);
        vm.expectRevert(Pool.BadConsent.selector);
        pool.openLine(b2, agentId, 0.1 ether, 0, c, sig);
    }

    function test_openLine_notABacker() public {
        (uint256 id, address o,) = newAgent("plain");
        (Pool.Consent memory c, bytes memory sig) = signedConsent(agentId, id, agentOwner, agentPk, 0);
        vm.prank(o);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotBacker.selector, id));
        pool.openLine(id, agentId, 0.1 ether, 0, c, sig);
    }

    function test_openLine_invalidAgent() public {
        (Pool.Consent memory c, bytes memory sig) = signedConsent(agentId, backerId, agentOwner, agentPk, 0);
        vm.startPrank(backerOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.InvalidAgent.selector, 0));
        pool.openLine(backerId, 0, 0.1 ether, 0, c, sig);
        vm.expectRevert(abi.encodeWithSelector(Pool.InvalidAgent.selector, backerId));
        pool.openLine(backerId, backerId, 0.1 ether, 0, c, sig);
        vm.stopPrank();
        // an id that does not exist
        c.agentId = 999;
        vm.prank(backerOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.InvalidAgent.selector, 999));
        pool.openLine(backerId, 999, 0.1 ether, 0, c, sig);
    }

    function test_openLine_agentIsBacker() public {
        (uint256 b2, address b2o) = newBacker("backer2", 1 ether);
        (address b2Key, uint256 b2pk) = makeAddrAndKey("backer2");
        assertEq(b2Key, b2o);
        (Pool.Consent memory c, bytes memory sig) = signedConsent(b2, backerId, b2o, b2pk, 0);
        vm.prank(backerOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.IsBacker.selector, b2));
        pool.openLine(backerId, b2, 0.1 ether, 0, c, sig);
    }

    function test_openLine_defaultedAgent() public {
        _open(0.1 ether, 0);
        uint256 id = _borrow(0.1 ether, T30);
        vm.warp(vm.getBlockTimestamp() + 34 days);
        pool.markDefault(id);
        (uint256 b2, address b2o) = newBacker("backer2", 1 ether);
        (Pool.Consent memory c, bytes memory sig) = signedConsent(agentId, b2, agentOwner, agentPk, 0);
        vm.prank(b2o);
        vm.expectRevert(abi.encodeWithSelector(Pool.AgentDefaulted.selector, agentId));
        pool.openLine(b2, agentId, 0.1 ether, 0, c, sig);
    }

    function test_openLine_staleOwnerInConsent() public {
        (Pool.Consent memory c, bytes memory sig) = signedConsent(agentId, backerId, agentOwner, agentPk, 0);
        vm.prank(agentOwner);
        registry.transferFrom(agentOwner, bob, agentId);
        vm.prank(backerOwner);
        vm.expectRevert(Pool.BadConsent.selector);
        pool.openLine(backerId, agentId, 0.1 ether, 0, c, sig);
    }

    function test_openLine_insufficientBacking() public {
        (Pool.Consent memory c, bytes memory sig) = signedConsent(agentId, backerId, agentOwner, agentPk, 0);
        vm.prank(backerOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.InsufficientBacking.selector, backerId, 1 ether + 1, 1 ether));
        pool.openLine(backerId, agentId, 1 ether + 1, 0, c, sig);
    }

    function test_openLine_eip1271Owner() public {
        (address signer, uint256 spk) = makeAddrAndKey("wallet-signer");
        Mock1271Wallet wallet = new Mock1271Wallet(signer);
        vm.prank(address(wallet));
        uint256 id = registry.register("wallet-agent");
        Pool.Consent memory c = consentFor(id, backerId, address(wallet), 0, vm.getBlockTimestamp() + 1);
        bytes memory sig = sign(c, spk);
        vm.prank(backerOwner);
        pool.openLine(backerId, id, 0.1 ether, 0, c, sig);
        assertEq(pool.getAgent(id).line, 0.1 ether);
        // a different key fails
        (, uint256 badPk) = makeAddrAndKey("bad");
        c = consentFor(id, backerId, address(wallet), 0, vm.getBlockTimestamp() + 1);
        sig = sign(c, badPk);
        vm.prank(backerOwner);
        vm.expectRevert(Pool.BadConsent.selector);
        pool.openLine(backerId, id, 0.1 ether, 0, c, sig);
    }

    function test_openLine_sameBackerAgain_raisesAndUpdatesPremium() public {
        _open(0.1 ether, 10);
        _open(0.05 ether, 20);
        Pool.Agent memory a = pool.getAgent(agentId);
        assertEq(a.line, 0.15 ether);
        assertEq(a.premiumBps, 20);
        assertEq(pool.nonces(agentId), 2);
    }

    function test_handoff_betweenBackers() public {
        MockHook h = new MockHook();
        vm.prank(backerOwner);
        pool.setHook(backerId, address(h));
        _open(0.3 ether, 0);
        (uint256 b2, address b2o) = newBacker("backer2", 1 ether);
        openLineAs(b2o, b2, agentId, agentOwner, agentPk, 0.2 ether, 0);
        assertEq(pool.getAgent(agentId).backer, b2);
        assertEq(pool.getAgent(agentId).line, 0.2 ether);
        assertEq(pool.getAgent(backerId).linesOut, 0);
        assertEq(pool.getAgent(b2).linesOut, 0.2 ether);
        assertEq(h.lastReleaseAmount(), 0.3 ether);
        assertEq(h.lastReleaseReason(), uint8(Pool.Release.Moved));
    }

    function test_handoff_blockedWithLoanOpen() public {
        _open(0.3 ether, 0);
        uint256 id = _borrow(0.1 ether, T30);
        (uint256 b2, address b2o) = newBacker("backer2", 1 ether);
        (Pool.Consent memory c, bytes memory sig) = signedConsent(agentId, b2, agentOwner, agentPk, 0);
        vm.prank(b2o);
        vm.expectRevert(abi.encodeWithSelector(Pool.LoanOpen.selector, agentId));
        pool.openLine(b2, agentId, 0.1 ether, 0, c, sig);
        repayEth(id);
        vm.prank(b2o);
        pool.openLine(b2, agentId, 0.1 ether, 0, c, sig);
        assertEq(pool.getAgent(agentId).backer, b2);
    }

    function test_handoff_unfreezes() public {
        _open(0.3 ether, 0);
        uint256 id = _borrow(0.1 ether, T30);
        vm.prank(backerOwner);
        pool.freezeLine(agentId, true);
        repayEth(id); // frees the frozen line, clears the backer
        assertEq(pool.getAgent(agentId).backer, 0);
        assertFalse(pool.getAgent(agentId).frozen);
        (uint256 b2, address b2o) = newBacker("backer2", 1 ether);
        openLineAs(b2o, b2, agentId, agentOwner, agentPk, 0.1 ether, 0);
        _borrow(0.1 ether, T30);
    }

    function test_raiseLine() public {
        _open(0.1 ether, 0);
        vm.prank(backerOwner);
        pool.raiseLine(backerId, agentId, 0.05 ether);
        assertEq(pool.getAgent(agentId).line, 0.15 ether);
        assertEq(pool.getAgent(backerId).linesOut, 0.15 ether);

        vm.startPrank(backerOwner);
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.raiseLine(backerId, agentId, 0);
        vm.expectRevert(abi.encodeWithSelector(Pool.InsufficientBacking.selector, backerId, 0.85 ether + 1, 0.85 ether));
        pool.raiseLine(backerId, agentId, 0.85 ether + 1);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotOwnerOf.selector, backerId, alice));
        pool.raiseLine(backerId, agentId, 1);

        (uint256 b2, address b2o) = newBacker("backer2", 1 ether);
        vm.prank(b2o);
        vm.expectRevert(abi.encodeWithSelector(Pool.WrongBacker.selector, agentId, backerId));
        pool.raiseLine(b2, agentId, 0.01 ether);
    }

    function test_raiseLine_defaulted() public {
        _open(0.2 ether, 0);
        uint256 id1 = _borrow(0.1 ether, T30);
        _borrow(0.05 ether, T30); // keeps the line alive after the default
        vm.warp(vm.getBlockTimestamp() + 34 days);
        pool.markDefault(id1);
        vm.prank(backerOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.AgentDefaulted.selector, agentId));
        pool.raiseLine(backerId, agentId, 0.01 ether);
    }

    function test_lowerLine() public {
        MockHook h = new MockHook();
        vm.prank(backerOwner);
        pool.setHook(backerId, address(h));
        _open(0.2 ether, 0);
        uint256 id = _borrow(0.15 ether, T30);
        vm.startPrank(backerOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.InsufficientLine.selector, agentId, 0.06 ether, 0.05 ether));
        pool.lowerLine(backerId, agentId, 0.06 ether);
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.lowerLine(backerId, agentId, 0);
        pool.lowerLine(backerId, agentId, 0.05 ether);
        vm.stopPrank();
        assertEq(pool.getAgent(agentId).line, 0.15 ether);
        assertEq(pool.getAgent(agentId).backer, backerId, "loan open: backer stays");
        assertEq(h.lastReleaseReason(), uint8(Pool.Release.Lowered));
        repayEth(id);
        vm.prank(backerOwner);
        pool.lowerLine(backerId, agentId, 0.15 ether);
        assertEq(pool.getAgent(agentId).backer, 0);
        assertEq(pool.getAgent(backerId).linesOut, 0);

        vm.prank(backerOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.WrongBacker.selector, agentId, 0));
        pool.lowerLine(backerId, agentId, 1);
        vm.prank(backerOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.InvalidAgent.selector, 0));
        pool.lowerLine(0, agentId, 1);
    }

    function test_leaveLine() public {
        _open(0.2 ether, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotController.selector, agentId, alice));
        pool.leaveLine(agentId);

        uint256 id = _borrow(0.1 ether, T30);
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.LoanOpen.selector, agentId));
        pool.leaveLine(agentId);
        repayEth(id);

        // a delegate may leave too
        address hot = makeAddr("hot");
        vm.prank(agentOwner);
        pool.setDelegate(agentId, hot);
        vm.prank(hot);
        pool.leaveLine(agentId);
        assertEq(pool.getAgent(agentId).backer, 0);
        assertEq(pool.getAgent(agentId).line, 0);
        assertEq(pool.getAgent(backerId).linesOut, 0);

        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.WrongBacker.selector, agentId, 0));
        pool.leaveLine(agentId);
    }

    function test_freezeLine() public {
        _open(0.2 ether, 0);
        uint256 id = _borrow(0.05 ether, T30);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotOwnerOf.selector, backerId, alice));
        pool.freezeLine(agentId, true);

        vm.prank(backerOwner);
        pool.freezeLine(agentId, true);
        Pool.Agent memory a = pool.getAgent(agentId);
        assertTrue(a.frozen);
        assertEq(a.line, 0.05 ether, "undrawn line came back");
        assertEq(pool.getAgent(backerId).linesOut, 0.05 ether);

        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.IsFrozen.selector, agentId));
        pool.borrow(agentId, 0.01 ether, T30, agentOwner, type(uint256).max, true);

        // unfreeze, raise, borrow again
        vm.startPrank(backerOwner);
        pool.freezeLine(agentId, false);
        pool.raiseLine(backerId, agentId, 0.05 ether);
        vm.stopPrank();
        _borrow(0.05 ether, T30);

        // freeze again and repay all: the line comes back and the backer is cleared
        vm.prank(backerOwner);
        pool.freezeLine(agentId, true);
        repayEth(id);
        assertEq(pool.getAgent(agentId).line, 0.05 ether);
        repayEth(id + 1);
        a = pool.getAgent(agentId);
        assertEq(a.line, 0);
        assertEq(a.backer, 0);
        assertFalse(a.frozen);
        assertEq(pool.getAgent(backerId).linesOut, 0);

        vm.expectRevert(abi.encodeWithSelector(Pool.WrongBacker.selector, agentId, 0));
        pool.freezeLine(agentId, true);
    }

    function test_freezeLine_noLoan_clearsBacker() public {
        _open(0.2 ether, 0);
        vm.prank(backerOwner);
        pool.freezeLine(agentId, true);
        assertEq(pool.getAgent(agentId).backer, 0);
        assertEq(pool.getAgent(backerId).linesOut, 0);
    }

    function test_setPremium() public {
        Pool.Consent memory c = consentFor(agentId, backerId, agentOwner, 100, vm.getBlockTimestamp() + 1);
        bytes memory sig = sign(c, agentPk);
        vm.prank(backerOwner);
        pool.openLine(backerId, agentId, 0.1 ether, 20, c, sig);
        vm.startPrank(backerOwner);
        pool.setPremium(agentId, 100);
        assertEq(pool.getAgent(agentId).premiumBps, 100);
        pool.setPremium(agentId, 0);
        vm.expectRevert(abi.encodeWithSelector(Pool.PremiumTooHigh.selector, 101, 100));
        pool.setPremium(agentId, 101);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotOwnerOf.selector, backerId, alice));
        pool.setPremium(agentId, 1);
        vm.expectRevert(abi.encodeWithSelector(Pool.WrongBacker.selector, 999, 0));
        pool.setPremium(999, 1);
    }

    // ================================================================== borrow

    function test_borrow_eth_arrivesAtTo() public {
        _open(0.25 ether, 0);
        address to = makeAddr("to");
        uint256 liq = pool.poolLiquidity();
        vm.prank(agentOwner);
        uint256 id = pool.borrow(agentId, 0.2 ether, T30, to, type(uint256).max, true);
        assertEq(id, 1);
        assertEq(to.balance, 0.2 ether);
        assertEq(pool.poolLiquidity(), liq - 0.2 ether);
        assertEq(pool.totalPrincipalOut(), 0.2 ether);
        Pool.Loan memory l = pool.getLoan(id);
        assertEq(l.agentId, agentId);
        assertEq(l.backerId, backerId);
        assertEq(l.principal, 0.2 ether);
        assertEq(l.fee, 0.002 ether);
        assertEq(l.owner, agentOwner);
        assertEq(l.dueAt, vm.getBlockTimestamp() + T30);
        assertEq(l.defaultableAt, vm.getBlockTimestamp() + T30 + 3 days);
        assertEq(uint8(l.status), uint8(Pool.LoanStatus.Active));
        Pool.Agent memory a = pool.getAgent(agentId);
        assertEq(a.principalOut, 0.2 ether);
        assertEq(a.activeLoans, 1);
        assertEq(a.lastBorrowAt, vm.getBlockTimestamp());
        assertEq(pool.loanCount(), 1);
        assertEq(pool.loansOf(agentId).length, 1);
        assertEq(pool.feeLocked(backerId), 0.002 ether);
        assertTrue(wethSolvent());
    }

    function test_borrow_weth() public {
        _open(0.25 ether, 0);
        address to = makeAddr("to");
        vm.prank(agentOwner);
        pool.borrow(agentId, 0.1 ether, T30, to, type(uint256).max, false);
        assertEq(weth.balanceOf(to), 0.1 ether);
        assertEq(to.balance, 0);
    }

    function test_borrow_toRejectsEth() public {
        _open(0.25 ether, 0);
        NoEth no = new NoEth();
        vm.prank(agentOwner);
        vm.expectRevert(Pool.EthSendFailed.selector);
        pool.borrow(agentId, 0.1 ether, T30, address(no), type(uint256).max, true);
    }

    function test_borrow_controllerAndDelegate() public {
        _open(0.25 ether, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotController.selector, agentId, alice));
        pool.borrow(agentId, 0.01 ether, T30, alice, type(uint256).max, true);

        address hot = makeAddr("hot");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotOwnerOf.selector, agentId, alice));
        pool.setDelegate(agentId, hot);
        vm.prank(agentOwner);
        pool.setDelegate(agentId, hot);
        assertTrue(pool.isController(agentId, hot));
        vm.prank(hot);
        pool.borrow(agentId, 0.01 ether, T30, hot, type(uint256).max, true);
        assertEq(hot.balance, 0.01 ether);

        // the delegate lapses when the agent changes hands
        vm.prank(agentOwner);
        registry.transferFrom(agentOwner, bob, agentId);
        assertFalse(pool.isController(agentId, hot));
        assertFalse(pool.isController(agentId, agentOwner));
        assertTrue(pool.isController(agentId, bob));
        vm.prank(hot);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotController.selector, agentId, hot));
        pool.borrow(agentId, 0.01 ether, T30, hot, type(uint256).max, true);
        // and does not come back if it returns
        vm.prank(bob);
        registry.transferFrom(bob, agentOwner, agentId);
        assertTrue(pool.isController(agentId, hot), "same owner again: delegate valid again");
        assertFalse(pool.isController(0, hot));
        assertFalse(pool.isController(999, hot));
    }

    function test_borrow_sizeRange() public {
        _open(0.5 ether, 0);
        vm.startPrank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.LoanSizeOutOfRange.selector, 0.001 ether - 1));
        pool.borrow(agentId, 0.001 ether - 1, T30, agentOwner, type(uint256).max, true);
        vm.expectRevert(abi.encodeWithSelector(Pool.LoanSizeOutOfRange.selector, 0.25 ether + 1));
        pool.borrow(agentId, 0.25 ether + 1, T30, agentOwner, type(uint256).max, true);
        pool.borrow(agentId, 0.001 ether, T30, agentOwner, type(uint256).max, true);
        pool.borrow(agentId, 0.25 ether, T30, agentOwner, type(uint256).max, true);
        vm.stopPrank();
    }

    function test_borrow_termRange() public {
        _open(0.5 ether, 0);
        vm.startPrank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.TermOutOfRange.selector, uint64(1 days - 1)));
        pool.borrow(agentId, 0.01 ether, 1 days - 1, agentOwner, type(uint256).max, true);
        vm.expectRevert(abi.encodeWithSelector(Pool.TermOutOfRange.selector, uint64(30 days + 1)));
        pool.borrow(agentId, 0.01 ether, 30 days + 1, agentOwner, type(uint256).max, true);
        pool.borrow(agentId, 0.01 ether, 1 days, agentOwner, type(uint256).max, true);
        vm.stopPrank();
    }

    function test_borrow_line() public {
        _open(0.1 ether, 0);
        _borrow(0.06 ether, T30);
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.InsufficientLine.selector, agentId, 0.05 ether, 0.04 ether));
        pool.borrow(agentId, 0.05 ether, T30, agentOwner, type(uint256).max, true);
        _borrow(0.04 ether, T30);
    }

    function test_borrow_utilization() public {
        Pool.Params memory p = defaultParams();
        p.maxUtilizationBps = 100; // 1%
        vm.prank(timelock);
        pool.setParams(p);
        _open(0.25 ether, 0);
        // total assets ~11.0001 ETH, 1% ~ 0.110001
        vm.prank(agentOwner);
        vm.expectRevert(Pool.UtilizationTooHigh.selector);
        pool.borrow(agentId, 0.12 ether, T30, agentOwner, type(uint256).max, true);
        _borrow(0.11 ether, T30);
    }

    function test_borrow_feeCap() public {
        _open(0.25 ether, 100);
        (uint256 fee,,,) = pool.quoteFee(agentId, 0.1 ether, T30);
        assertEq(fee, 0.002 ether); // 1% base + 1% premium
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.FeeTooHigh.selector, fee, fee - 1));
        pool.borrow(agentId, 0.1 ether, T30, agentOwner, fee - 1, true);
        vm.prank(agentOwner);
        pool.borrow(agentId, 0.1 ether, T30, agentOwner, fee, true);
    }

    function test_borrow_noBacker() public {
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.WrongBacker.selector, agentId, 0));
        pool.borrow(agentId, 0.01 ether, T30, agentOwner, type(uint256).max, true);
        // a backer cannot borrow
        vm.prank(backerOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.WrongBacker.selector, backerId, 0));
        pool.borrow(backerId, 0.01 ether, T30, backerOwner, type(uint256).max, true);
    }

    function test_borrow_feeNeedsFreeBacking() public {
        _open(1 ether, 0); // the whole backing
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.InsufficientBacking.selector, backerId, 0.001 ether, 0));
        pool.borrow(agentId, 0.1 ether, T30, agentOwner, type(uint256).max, true);
    }

    function test_borrow_ownerWhoDefaultedElsewhere() public {
        // agentOwner defaults with agent 1
        _open(0.1 ether, 0);
        uint256 id = _borrow(0.1 ether, T30);
        vm.warp(vm.getBlockTimestamp() + 34 days);
        pool.markDefault(id);
        assertEq(pool.ownerDefaults(agentOwner), 1);
        // a second agent of the same owner
        vm.prank(agentOwner);
        uint256 agent2 = registry.register("agent2");
        openLineAs(backerOwner, backerId, agent2, agentOwner, agentPk, 0.1 ether, 0);
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.OwnerDefaulted.selector, agentOwner));
        pool.borrow(agent2, 0.01 ether, T30, agentOwner, type(uint256).max, true);
        // a custodian (an exchange-like owner) is not blocked
        vm.prank(timelock);
        pool.setCustodian(agentOwner, true);
        borrowAs(agentOwner, agent2, 0.01 ether, T30);
    }

    function test_borrow_defaultedAgent() public {
        _open(0.2 ether, 0);
        uint256 id = _borrow(0.1 ether, T30);
        _borrow(0.01 ether, T30);
        vm.prank(timelock);
        pool.setCustodian(agentOwner, true);
        vm.warp(vm.getBlockTimestamp() + 34 days);
        pool.markDefault(id);
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.AgentDefaulted.selector, agentId));
        pool.borrow(agentId, 0.01 ether, T30, agentOwner, type(uint256).max, true);
    }

    function test_borrow_hookBlocks() public {
        MockHook h = new MockHook();
        vm.prank(backerOwner);
        pool.setHook(backerId, address(h));
        _open(0.25 ether, 0);
        h.setAllow(false);
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.BorrowBlockedByBacker.selector, backerId));
        pool.borrow(agentId, 0.01 ether, T30, agentOwner, type(uint256).max, true);
        h.setAllow(true);
        _borrow(0.01 ether, T30);
        assertEq(h.borrows(), 1);
    }

    function test_borrow_hookGasBurner_blocks() public {
        MockHook h = new MockHook();
        h.setBurnGas(true);
        vm.prank(backerOwner);
        pool.setHook(backerId, address(h));
        _open(0.25 ether, 0);
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.BorrowBlockedByBacker.selector, backerId));
        pool.borrow(agentId, 0.01 ether, T30, agentOwner, type(uint256).max, true);
    }

    function test_borrow_hookNonBoolAnswer_blocks() public {
        WeirdHook h = new WeirdHook();
        vm.prank(backerOwner);
        pool.setHook(backerId, address(h));
        _open(0.25 ether, 0);
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.BorrowBlockedByBacker.selector, backerId));
        pool.borrow(agentId, 0.01 ether, T30, agentOwner, type(uint256).max, true);
    }

    function test_borrow_hookStarved_reverts() public {
        MockHook h = new MockHook();
        vm.prank(backerOwner);
        pool.setHook(backerId, address(h));
        _open(0.25 ether, 0);
        vm.prank(agentOwner);
        vm.expectRevert(CreditCalls.HookStarved.selector);
        pool.borrow{gas: 250_000}(agentId, 0.01 ether, T30, agentOwner, type(uint256).max, true);
    }

    function test_borrow_failingNotifyDoesNotBlock() public {
        MockHook h = new MockHook();
        h.setRevertOnNotify(true);
        vm.prank(backerOwner);
        pool.setHook(backerId, address(h));
        _open(0.25 ether, 0);
        vm.expectEmit(true, false, false, true, address(pool));
        emit Pool.HookFailed(backerId, h.onBorrow.selector);
        _borrow(0.01 ether, T30);
    }

    // ================================================================== repay

    function test_repay_exactEth_feeSplit() public {
        _open(0.25 ether, 100);
        uint256 id = _borrow(0.2 ether, T30);
        // base 0.002, premium 0.002; backer 25% of base + premium; reserve 25% of base; lenders the rest
        Pool.Loan memory l = pool.getLoan(id);
        assertEq(l.fee, 0.004 ether);
        assertEq(l.backerCut, 0.0005 ether);
        assertEq(l.reserveCut, 0.0005 ether);
        assertEq(l.premium, 0.002 ether);

        uint256 liq = pool.poolLiquidity();
        uint256 priceBefore = sharePrice();
        vm.warp(vm.getBlockTimestamp() + 10 days);
        address payer = makeAddr("payer");
        vm.deal(payer, 1 ether);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(Pool.WrongValue.selector, 0.204 ether - 1, 0.204 ether));
        pool.repay{value: 0.204 ether - 1}(id, agentId, type(uint256).max);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(Pool.WrongValue.selector, 0.204 ether + 1, 0.204 ether));
        pool.repay{value: 0.204 ether + 1}(id, agentId, type(uint256).max);
        vm.prank(payer);
        pool.repay{value: 0.204 ether}(id, agentId, 0.204 ether);

        assertEq(pool.poolLiquidity(), liq + 0.2 ether + 0.001 ether);
        assertEq(pool.totalFeesEarned(), 0.001 ether);
        assertEq(pool.backerFees(backerId), 0.0025 ether);
        assertEq(pool.feesFrom(backerId, agentId), 0.0025 ether);
        assertEq(pool.unclaimedBackerFees(), 0.0025 ether);
        assertEq(pool.reserve(), 0.0005 ether);
        assertEq(pool.feeLocked(backerId), 0);
        assertEq(pool.totalPrincipalOut(), 0);
        assertGt(sharePrice(), priceBefore);
        assertTrue(wethSolvent());

        Pool.Agent memory a = pool.getAgent(agentId);
        assertEq(a.loansRepaid, 1);
        assertEq(a.volumeRepaid, 0.2 ether);
        assertEq(a.feesPaid, 0.004 ether);
        assertEq(a.principalOut, 0);
        assertEq(a.activeLoans, 0);
        assertEq(a.lastRepayAt, vm.getBlockTimestamp());
        assertEq(a.ethSecondsRepaid, 0.2 ether * 10 days);
        assertEq(a.seasonedRepaid, 1);
        assertEq(uint8(pool.getLoan(id).status), uint8(Pool.LoanStatus.Repaid));
        assertEq(pool.getLoan(id).closedAt, vm.getBlockTimestamp());

        // claim the backer's fees
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotOwnerOf.selector, backerId, alice));
        pool.claimBackerFees(backerId, alice, true);
        vm.prank(backerOwner);
        uint256 got = pool.claimBackerFees(backerId, makeAddr("feeTo"), true);
        assertEq(got, 0.0025 ether);
        assertEq(makeAddr("feeTo").balance, 0.0025 ether);
        assertEq(pool.unclaimedBackerFees(), 0);
        vm.prank(backerOwner);
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.claimBackerFees(backerId, backerOwner, true);
    }

    function test_repay_weth() public {
        _open(0.25 ether, 0);
        uint256 id = _borrow(0.1 ether, T30);
        uint256 due = dueOf(id);
        vm.deal(bob, due);
        vm.startPrank(bob);
        weth.deposit{value: due}();
        weth.approve(address(pool), due);
        pool.repay(id, agentId, due);
        vm.stopPrank();
        assertEq(weth.balanceOf(bob), 0);
        assertEq(uint8(pool.getLoan(id).status), uint8(Pool.LoanStatus.Repaid));
    }

    function test_repay_guards() public {
        _open(0.25 ether, 0);
        uint256 id = _borrow(0.1 ether, T30);
        uint256 due = dueOf(id);
        vm.deal(bob, 10 ether);
        vm.startPrank(bob);
        vm.expectRevert(abi.encodeWithSelector(Pool.LoanNotActive.selector, 0));
        pool.repay{value: due}(0, agentId, due);
        vm.expectRevert(abi.encodeWithSelector(Pool.LoanNotActive.selector, 2));
        pool.repay{value: due}(2, agentId, due);
        vm.expectRevert(abi.encodeWithSelector(Pool.WrongLoan.selector, id));
        pool.repay{value: due}(id, agentId + 1, due);
        vm.expectRevert(abi.encodeWithSelector(Pool.DueTooHigh.selector, due, due - 1));
        pool.repay{value: due}(id, agentId, due - 1);
        pool.repay{value: due}(id, agentId, due);
        vm.expectRevert(abi.encodeWithSelector(Pool.LoanNotActive.selector, id));
        pool.repay{value: due}(id, agentId, due);
        vm.stopPrank();
    }

    function test_repay_heldCappedAtTerm_andSeasoning() public {
        _open(0.25 ether, 0);
        // held 6 days: not seasoned
        uint256 id1 = _borrow(0.1 ether, 10 days);
        vm.warp(vm.getBlockTimestamp() + 6 days);
        repayEth(id1);
        Pool.Agent memory a = pool.getAgent(agentId);
        assertEq(a.seasonedRepaid, 0);
        assertEq(a.ethSecondsRepaid, 0.1 ether * 6 days);
        // held exactly 7 days: seasoned
        uint256 id2 = _borrow(0.1 ether, 10 days);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        repayEth(id2);
        a = pool.getAgent(agentId);
        assertEq(a.seasonedRepaid, 1);
        // repaid late (within grace): time capped at the term
        uint256 id3 = _borrow(0.1 ether, 8 days);
        vm.warp(vm.getBlockTimestamp() + 10 days);
        repayEth(id3);
        a = pool.getAgent(agentId);
        assertEq(a.ethSecondsRepaid, 0.1 ether * (6 days + 7 days + 8 days));
        assertEq(a.seasonedRepaid, 2);
        assertEq(a.loansRepaid, 3);
        // a short-term loan can never season
        uint256 id4 = _borrow(0.1 ether, 3 days);
        vm.warp(vm.getBlockTimestamp() + 6 days);
        repayEth(id4);
        assertEq(pool.getAgent(agentId).seasonedRepaid, 2);
    }

    function test_repay_canRepayAfterDueBeforeDefault() public {
        _open(0.25 ether, 0);
        uint256 id = _borrow(0.1 ether, T30);
        Pool.Loan memory l = pool.getLoan(id);
        vm.warp(l.defaultableAt);
        repayEth(id);
        vm.expectRevert(abi.encodeWithSelector(Pool.LoanNotActive.selector, id));
        pool.markDefault(id);
    }

    // ================================================================== default

    function test_markDefault_timing() public {
        _open(0.25 ether, 0);
        uint256 id = _borrow(0.1 ether, T30);
        uint64 at = pool.getLoan(id).defaultableAt;
        vm.expectRevert(abi.encodeWithSelector(Pool.LoanNotDue.selector, id, at));
        pool.markDefault(id);
        vm.warp(at);
        vm.expectRevert(abi.encodeWithSelector(Pool.LoanNotDue.selector, id, at));
        pool.markDefault(id);
        vm.warp(at + 1);
        pool.markDefault(id);
        vm.expectRevert(abi.encodeWithSelector(Pool.LoanNotActive.selector, id));
        pool.markDefault(id);
        vm.expectRevert(abi.encodeWithSelector(Pool.LoanNotActive.selector, 0));
        pool.markDefault(0);
        vm.expectRevert(abi.encodeWithSelector(Pool.LoanNotActive.selector, 5));
        pool.markDefault(5);
    }

    function test_markDefault_burnsBackerSharesAndKeepsPrice() public {
        MockHook h = new MockHook();
        vm.prank(backerOwner);
        pool.setHook(backerId, address(h));
        _open(0.25 ether, 50);
        uint256 id = _borrow(0.2 ether, T30);
        Pool.Loan memory l = pool.getLoan(id);
        uint256 p = l.principal;
        uint256 f = l.fee;
        assertEq(f, 0.003 ether);

        vm.warp(l.defaultableAt + 1);
        uint256 ts = pool.totalShares();
        uint256 ta = pool.totalAssets();
        uint256 expectedBurn = ((p + f) * ts + ta - 1) / ta;
        uint256 heldBefore = pool.backerShares(backerId);
        uint256 backingBefore = pool.backing(backerId);
        uint256 priceBefore = sharePrice();
        uint256 aliceBefore = pool.convertToAssets(pool.shares(alice));
        uint256 liq = pool.poolLiquidity();

        vm.prank(keeper);
        pool.markDefault(id);

        assertEq(heldBefore - pool.backerShares(backerId), expectedBurn);
        assertEq(pool.totalShares(), ts - expectedBurn);
        assertGe(sharePrice(), priceBefore, "share price never falls");
        assertGe(pool.convertToAssets(pool.shares(alice)), aliceBefore, "lenders untouched");
        // the shares burnt were worth p + f at the old price (rounded up); the backer's remaining shares then
        // share in the unpaid fee like everyone else's
        uint256 burntWorth = expectedBurn * ta / ts;
        assertGe(burntWorth + 1, p + f);
        assertLe(burntWorth, p + f + 1);
        assertLt(pool.backing(backerId), backingBefore - p);
        assertEq(pool.poolLiquidity(), liq);
        assertEq(pool.totalPrincipalOut(), 0);
        assertEq(pool.totalSlashed(), p);
        assertEq(pool.totalBadDebt(), 0);
        assertEq(pool.feeLocked(backerId), 0);
        assertTrue(wethSolvent());

        Pool.Agent memory a = pool.getAgent(agentId);
        assertTrue(a.defaulted);
        assertEq(a.principalOut, 0);
        assertEq(a.activeLoans, 0);
        assertEq(a.line, 0, "rest of the line went back");
        assertEq(a.backer, 0);
        assertEq(pool.getAgent(backerId).linesOut, 0);
        assertEq(pool.getAgent(backerId).backedDefaults, 1);
        assertEq(pool.ownerDefaults(agentOwner), 1);
        assertEq(uint8(pool.getLoan(id).status), uint8(Pool.LoanStatus.Defaulted));
        assertEq(h.defaults(), 1);
        assertTrue(h.lastLoanFlag());
        assertEq(h.lastReleaseReason(), uint8(Pool.Release.AfterDefault));
        assertEq(h.lastReleaseAmount(), 0.05 ether);
    }

    function test_markDefault_twoLoans_lineSettlesWhenLastCloses() public {
        _open(0.25 ether, 0);
        uint256 id1 = _borrow(0.1 ether, 10 days);
        uint256 id2 = _borrow(0.05 ether, T30);
        vm.warp(vm.getBlockTimestamp() + 14 days);
        pool.markDefault(id1);
        Pool.Agent memory a = pool.getAgent(agentId);
        assertEq(a.line, 0.15 ether);
        assertEq(a.backer, backerId);
        assertEq(pool.getAgent(backerId).linesOut, 0.15 ether);
        repayEth(id2);
        a = pool.getAgent(agentId);
        assertEq(a.line, 0);
        assertEq(a.backer, 0);
        assertEq(pool.getAgent(backerId).linesOut, 0);
    }

    function test_markDefault_custodianOwnerNotMarked() public {
        vm.prank(timelock);
        pool.setCustodian(agentOwner, true);
        _open(0.25 ether, 0);
        uint256 id = _borrow(0.1 ether, T30);
        vm.warp(vm.getBlockTimestamp() + 34 days);
        pool.markDefault(id);
        assertEq(pool.ownerDefaults(agentOwner), 0);
        assertTrue(pool.getAgent(agentId).defaulted);
    }

    function test_markDefault_marksOwnerAtBorrowNotNewOwner() public {
        _open(0.25 ether, 0);
        uint256 id = _borrow(0.1 ether, T30);
        vm.prank(agentOwner);
        registry.transferFrom(agentOwner, bob, agentId);
        vm.warp(vm.getBlockTimestamp() + 34 days);
        pool.markDefault(id);
        assertEq(pool.ownerDefaults(agentOwner), 1);
        assertEq(pool.ownerDefaults(bob), 0);
    }

    function test_markDefault_keeperBounty() public {
        Pool.Params memory p = defaultParams();
        p.keeperBounty = 0.001 ether;
        vm.prank(timelock);
        pool.setParams(p);
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        pool.fundReserve{value: 0.0015 ether}(0.0015 ether);
        _open(0.25 ether, 0);
        uint256 id1 = _borrow(0.1 ether, T30);
        uint256 id2 = _borrow(0.1 ether, T30);
        vm.warp(vm.getBlockTimestamp() + 34 days);
        vm.prank(keeper);
        pool.markDefault(id1);
        assertEq(weth.balanceOf(keeper), 0.001 ether);
        assertEq(pool.reserve(), 0.0005 ether);
        vm.prank(keeper);
        pool.markDefault(id2);
        assertEq(weth.balanceOf(keeper), 0.0015 ether, "bounty capped by the reserve");
        assertEq(pool.reserve(), 0);
        assertTrue(wethSolvent());
    }

    function test_markDefault_hookRevertDoesNotBlock() public {
        MockHook h = new MockHook();
        vm.prank(backerOwner);
        pool.setHook(backerId, address(h));
        _open(0.25 ether, 0);
        uint256 id = _borrow(0.1 ether, T30);
        h.setRevertOnNotify(true);
        vm.warp(vm.getBlockTimestamp() + 34 days);
        pool.markDefault(id);
        assertTrue(pool.getAgent(agentId).defaulted);
    }

    function test_markDefault_fullyUsedBacker_noBadDebt() public {
        // a backer whose backing exactly covers its line and fee
        (uint256 b2, address b2o) = newBacker("tight", 0.0101 ether);
        (uint256 ag, address ao, uint256 apk) = newAgent("tight-agent");
        openLineAs(b2o, b2, ag, ao, apk, 0.01 ether, 0);
        uint256 id = borrowAs(ao, ag, 0.01 ether, T30);
        assertEq(pool.freeBacking(b2), 0); // fee 0.0001
        vm.warp(vm.getBlockTimestamp() + 34 days);
        uint256 price = sharePrice();
        pool.markDefault(id);
        assertGe(sharePrice(), price);
        assertEq(pool.totalBadDebt(), 0);
        assertTrue(wethSolvent());
    }

    // ================================================================== reserve

    function test_fundReserve() public {
        vm.deal(bob, 1 ether);
        vm.startPrank(bob);
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.fundReserve(0);
        pool.fundReserve{value: 0.01 ether}(0.01 ether);
        weth.deposit{value: 0.01 ether}();
        weth.approve(address(pool), 0.01 ether);
        pool.fundReserve(0.01 ether);
        vm.stopPrank();
        assertEq(pool.reserve(), 0.02 ether);
        assertTrue(wethSolvent());
    }

    function test_reserveToBuyback() public {
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.reserveToBuyback();
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        pool.fundReserve{value: 0.005 ether}(0.005 ether);
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.reserveToBuyback(); // exactly the floor: nothing
        vm.prank(bob);
        pool.fundReserve{value: 0.02 ether}(0.02 ether);
        vm.prank(makeAddr("anyone"));
        uint256 sent = pool.reserveToBuyback();
        assertEq(sent, 0.02 ether);
        assertEq(buyback.balance, 0.02 ether);
        assertEq(pool.reserve(), pool.RESERVE_FLOOR());
        assertEq(pool.totalToBuyback(), 0.02 ether);
        assertTrue(wethSolvent());
    }

    function test_reserveToBuyback_fromFees() public {
        _open(0.25 ether, 0);
        // enough loans to push the reserve above the floor: reserve cut is 0.025% of principal per 30 days
        for (uint256 i; i < 10; i++) {
            uint256 id = _borrow(0.25 ether, T30);
            repayEth(id);
        }
        uint256 r = pool.reserve();
        assertEq(r, 10 * 0.000625 ether);
        pool.reserveToBuyback();
        assertEq(buyback.balance, r - 0.005 ether);
    }

    function test_reserveToBacking() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        pool.fundReserve{value: 0.1 ether}(0.1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.reserveToBacking(backerId, 0.05 ether);
        vm.startPrank(timelock);
        vm.expectRevert(abi.encodeWithSelector(Pool.NotBacker.selector, agentId));
        pool.reserveToBacking(agentId, 0.05 ether);
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.reserveToBacking(backerId, 0);
        vm.expectRevert(abi.encodeWithSelector(Pool.ReserveShort.selector, 0.2 ether, 0.1 ether));
        pool.reserveToBacking(backerId, 0.2 ether);
        uint256 price = sharePrice();
        pool.reserveToBacking(backerId, 0.05 ether);
        vm.stopPrank();
        assertEq(pool.reserve(), 0.05 ether);
        assertApproxEqAbs(pool.backing(backerId), 1.05 ether, 1);
        assertGe(sharePrice(), price);
        assertTrue(wethSolvent());
    }

    // ================================================================== owner, guardian, pause

    function test_setParams() public {
        Pool.Params memory p = defaultParams();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.setParams(p);
        p.feeBps = 200;
        vm.prank(timelock);
        pool.setParams(p);
        assertEq(pool.getParams().feeBps, 200);
    }

    function test_setParams_invalid() public {
        Pool.Params[] memory bad = new Pool.Params[](14);
        for (uint256 i; i < bad.length; i++) bad[i] = defaultParams();
        bad[0].minLoan = 0;
        bad[1].minLoan = bad[1].maxLoan + 1;
        bad[2].minTerm = 0;
        bad[3].minTerm = bad[3].maxTerm + 1;
        bad[4].maxTerm = 365 days + 1;
        bad[5].grace = 1 days - 1;
        bad[6].grace = 365 days + 1;
        bad[7].minScoreTerm = bad[7].maxTerm + 1;
        bad[8].feeBps = 501;
        bad[9].backerFeeBps = 5000;
        bad[9].reserveFeeBps = 5001;
        bad[10].maxUtilizationBps = 0;
        bad[11].maxUtilizationBps = 10_001;
        bad[12].keeperBounty = 0.001 ether + 1;
        bad[13].minScoreTerm = 31 days;
        vm.startPrank(timelock);
        for (uint256 i; i < bad.length; i++) {
            vm.expectRevert(Pool.InvalidParams.selector);
            pool.setParams(bad[i]);
        }
        vm.stopPrank();
    }

    function test_paramsChangeDoesNotTouchOpenLoans() public {
        _open(0.25 ether, 0);
        uint256 id = _borrow(0.1 ether, T30);
        Pool.Params memory p = defaultParams();
        p.grace = 30 days;
        p.feeBps = 500;
        vm.prank(timelock);
        pool.setParams(p);
        Pool.Loan memory l = pool.getLoan(id);
        assertEq(l.fee, 0.001 ether);
        assertEq(l.defaultableAt, l.dueAt + 3 days);
    }

    function test_setCustodian_setGuardian_onlyOwner() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.setCustodian(alice, true);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.setGuardian(alice);
        vm.stopPrank();
        vm.startPrank(timelock);
        pool.setCustodian(alice, true);
        pool.setGuardian(bob);
        vm.stopPrank();
        assertTrue(pool.custodian(alice));
        assertEq(pool.guardian(), bob);
    }

    function test_renounceOwnership_reverts() public {
        vm.prank(timelock);
        vm.expectRevert(Pool.Renounce.selector);
        pool.renounceOwnership();
        assertEq(pool.owner(), timelock);
    }

    function test_ownershipTwoStep() public {
        vm.prank(timelock);
        pool.transferOwnership(bob);
        assertEq(pool.owner(), timelock);
        vm.prank(bob);
        pool.acceptOwnership();
        assertEq(pool.owner(), bob);
    }

    function test_pause_onlyGuardianOrOwner_andExpires() public {
        vm.prank(alice);
        vm.expectRevert(Pool.NotGuardian.selector);
        pool.pause();
        vm.prank(alice);
        vm.expectRevert(Pool.NotGuardian.selector);
        pool.unpause();
        vm.prank(guardian);
        pool.pause();
        assertEq(pool.pausedUntil(), vm.getBlockTimestamp() + 14 days);
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(Pool.Paused.selector);
        pool.deposit{value: 1 ether}(1 ether, bob, 0);
        vm.warp(vm.getBlockTimestamp() + 14 days);
        vm.prank(bob);
        pool.deposit{value: 1 ether}(1 ether, bob, 0);
        vm.prank(timelock);
        pool.pause();
        vm.prank(guardian);
        pool.unpause();
        assertEq(pool.pausedUntil(), 0);
    }

    function test_pause_blocksNewRisk() public {
        _open(0.25 ether, 0);
        vm.prank(guardian);
        pool.pause();

        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(Pool.Paused.selector);
        pool.deposit{value: 0.1 ether}(0.1 ether, bob, 0);
        vm.prank(bob);
        vm.expectRevert(Pool.Paused.selector);
        pool.addBacking{value: 0.1 ether}(backerId, 0.1 ether);
        (uint256 id2, address o2,) = newAgent("new-backer");
        vm.deal(o2, 1 ether);
        vm.prank(o2);
        vm.expectRevert(Pool.Paused.selector);
        pool.registerBacker{value: 0.1 ether}(id2, 0.1 ether);
        vm.prank(backerOwner);
        vm.expectRevert(Pool.Paused.selector);
        pool.raiseLine(backerId, agentId, 0.01 ether);
        (Pool.Consent memory c, bytes memory sig) = signedConsent(agentId, backerId, agentOwner, agentPk, 0);
        vm.prank(backerOwner);
        vm.expectRevert(Pool.Paused.selector);
        pool.openLine(backerId, agentId, 0.01 ether, 0, c, sig);
        vm.prank(agentOwner);
        vm.expectRevert(Pool.Paused.selector);
        pool.borrow(agentId, 0.01 ether, T30, agentOwner, type(uint256).max, true);
    }

    function test_pause_neverBlocksExits() public {
        _open(0.25 ether, 0);
        uint256 id1 = _borrow(0.1 ether, T30);
        uint256 id2 = _borrow(0.1 ether, T30);
        vm.prank(guardian);
        pool.pause();
        // withdraw
        uint256 s = pool.shares(alice) / 2;
        vm.prank(alice);
        pool.withdraw(s, alice, true);
        // repay
        repayEth(id1);
        // markDefault (the pause runs out before then, so pause again right before)
        vm.warp(vm.getBlockTimestamp() + 34 days);
        vm.prank(guardian);
        pool.pause();
        pool.markDefault(id2);
        // claim fees, lower/leave lines, unlock backing, retire
        vm.prank(backerOwner);
        pool.claimBackerFees(backerId, backerOwner, true);
        uint256 free = pool.backerShares(backerId);
        vm.prank(backerOwner);
        pool.unlockBacking(backerId, free, backerOwner, true);
        vm.prank(backerOwner);
        pool.retireBacker(backerId);
    }

    // ================================================================== views

    function test_quoteFee() public {
        _open(0.25 ether, 200);
        (uint256 fee, uint256 bc, uint256 rc, uint256 prem) = pool.quoteFee(agentId, 0.25 ether, 15 days);
        assertEq(fee, 0.00125 ether + 0.0025 ether);
        assertEq(bc, 0.0003125 ether);
        assertEq(rc, 0.0003125 ether);
        assertEq(prem, 0.0025 ether);
    }

    function test_views() public view {
        assertEq(pool.loanCount(), 0);
        assertEq(pool.getParams().maxLoan, 0.25 ether);
        assertEq(pool.totalAssets(), 11 ether + SEED);
        assertEq(pool.convertToShares(1 ether), 1 ether);
    }
}
