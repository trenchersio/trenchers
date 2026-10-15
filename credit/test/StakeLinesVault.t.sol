// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseTest} from "./helpers/BaseTest.sol";
import {TrenchersCreditPool as Pool} from "../src/TrenchersCreditPool.sol";
import {TrenchersStakeLines} from "../src/TrenchersStakeLines.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice The shared backing vault in TrenchersStakeLines: fund, harvest, requestExit, cancelExit, exit.
contract StakeLinesVaultTest is BaseTest {
    uint256 internal vb;
    address internal carol = makeAddr("carol"); // backer
    address internal dave = makeAddr("dave"); // backer
    address internal erin = makeAddr("erin"); // backer
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 internal agentNonce;

    function setUp() public override {
        super.setUp();
        lend(alice, 10 ether);
        vb = vault.backerId();
        vm.prank(timelock);
        vault.setTerms(TOKENS_PER_ETH, MAX_LINE, VAULT_MAX_TERM, 100 ether); // weekly room never in the way here
    }

    // ------------------------------------------------------------------ helpers

    function _now() internal view returns (uint256) {
        return vm.getBlockTimestamp();
    }

    function fundAs(address who, uint256 amount) internal returns (uint256 minted) {
        vm.deal(who, who.balance + amount);
        vm.prank(who);
        minted = vault.fund{value: amount}();
    }

    function valueOf(address who) internal view returns (uint256 v) {
        (, v,,) = vault.backerPosition(who);
    }

    /// value per 1e18 shares
    function vps() internal view returns (uint256) {
        return vault.backingValue() * 1e18 / vault.totalShares();
    }

    function requestAll(address who) internal returns (uint256 s) {
        s = vault.sharesOf(who);
        vm.prank(who);
        vault.requestExit(s);
    }

    function exitAs(address who, uint256 shares, address to) internal returns (uint256 assets) {
        vm.prank(who);
        assets = vault.exit(shares, to);
    }

    /// A fresh agent stakes for a 0.1 ETH line and borrows all of it for `term`.
    function stakeBorrow(uint64 term) internal returns (uint256 agentId, address o, uint256 loanId) {
        uint256 pk;
        (agentId, o, pk) = newAgent(string(abi.encodePacked("vault-agent", vm.toString(agentNonce++))));
        stakeOpen(agentId, o, pk, 100_000 ether);
        loanId = borrowAs(o, agentId, 0.1 ether, term);
    }

    /// A 0.1 ETH loan for 30 days that is repaid; the line is closed after. Returns the backers' cut.
    function repaidLoan() internal returns (uint256 backerCut) {
        (uint256 id, address o, uint256 loanId) = stakeBorrow(30 days);
        backerCut = pool.getLoan(loanId).backerCut;
        vm.warp(_now() + 10 days);
        repayEth(loanId);
        vm.prank(o);
        vault.close(id);
    }

    /// A 0.1 ETH loan for 30 days that defaults. Returns principal + fee.
    function defaultedLoan() internal returns (uint256 lost, uint256 agentId) {
        uint256 loanId;
        (agentId,, loanId) = stakeBorrow(30 days);
        Pool.Loan memory l = pool.getLoan(loanId);
        lost = l.principal + l.fee;
        vm.warp(uint256(l.defaultableAt) + 1);
        vm.prank(keeper);
        pool.markDefault(loanId);
    }

    // ================================================================== fund

    function test_vaultFund_firstRegistersAndSetsHook() public {
        assertFalse(pool.getAgent(vb).isBacker);
        vm.expectEmit(true, false, false, true, address(vault));
        emit TrenchersStakeLines.Funded(carol, 1 ether, 1 ether * 1e3);
        uint256 minted = fundAs(carol, 1 ether);
        assertEq(minted, 1e21, "first: 1e3 shares per wei");
        assertEq(vault.sharesOf(carol), minted);
        assertEq(vault.totalShares(), minted);
        assertTrue(pool.getAgent(vb).isBacker);
        assertEq(pool.hook(vb), address(vault));
        assertEq(pool.backing(vb), 1 ether);
        assertEq(vault.backingValue(), 1 ether);
        (uint256 shares, uint256 value, uint256 exitShares, uint64 readyAt) = vault.backerPosition(carol);
        assertEq(shares, minted);
        assertEq(value, 1 ether);
        assertEq(exitShares, 0);
        assertEq(readyAt, 0);
    }

    function test_vaultFund_firstBelowMinBacking_reverts() public {
        vm.deal(carol, 1 ether);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(Pool.BelowMinBacking.selector, 0.01 ether - 1, 0.01 ether));
        vault.fund{value: 0.01 ether - 1}();
        fundAs(carol, 0.01 ether); // exactly the minimum is fine
        fundAs(dave, 1); // later backing can be any size
        assertGt(vault.sharesOf(dave), 0);
    }

    function test_vaultFund_zeroReverts() public {
        vm.expectRevert(TrenchersStakeLines.BadTerms.selector);
        vault.fund{value: 0}();
    }

    function test_vaultFund_whilePoolPaused_reverts() public {
        fundAs(carol, 1 ether);
        vm.prank(guardian);
        pool.pause();
        vm.deal(dave, 1 ether);
        vm.prank(dave);
        vm.expectRevert(Pool.Paused.selector);
        vault.fund{value: 1 ether}();
    }

    /// The bug this fixed: the new ETH was counted in the value it was priced at, so a second backer got half.
    function test_vaultFund_secondEqualDeposit_getsEqualShares() public {
        uint256 a = fundAs(carol, 1 ether);
        uint256 b = fundAs(dave, 1 ether);
        assertEq(b, a, "same ETH, same moment, same shares");
        assertEq(valueOf(carol), 1 ether);
        assertEq(valueOf(dave), 1 ether);
    }

    function test_vaultFund_laterUsesCurrentValuePerShare() public {
        fundAs(carol, 1 ether);
        repaidLoan();
        uint256 price = vps();
        assertGt(price, 1e15, "fees raised the value per share");
        uint256 minted = fundAs(dave, 1 ether);
        assertApproxEqRel(minted, 1 ether * 1e18 / price, 1e9, "minted at the current price");
        assertApproxEqAbs(valueOf(dave), 1 ether, 10, "dave gets what he put in");
        assertGt(valueOf(carol), 1 ether, "carol keeps the fees earned before dave came");
        assertApproxEqAbs(vps(), price, 1, "funding does not move the value per share");
    }

    function test_vaultFund_twoBackersFairShares() public {
        fundAs(carol, 1 ether);
        uint256 cut1 = repaidLoan(); // only carol is in
        uint256 carolBefore = valueOf(carol);
        fundAs(dave, 3 ether);
        uint256 cut2 = repaidLoan(); // both are in, 1:3-ish
        uint256 carolGain = valueOf(carol) - carolBefore;
        uint256 daveGain = valueOf(dave) - 3 ether;
        assertGt(cut1, 0);
        assertGt(cut2, 0);
        // dave's gain is ~3x carol's on the second loan (carol's stake is a little bigger after the first)
        assertApproxEqRel(daveGain * carolBefore, carolGain * 3 ether, 1e12);
    }

    // ================================================================== fees and harvest

    function test_vaultFees_raiseValuePerShare_harvestKeepsValue() public {
        fundAs(carol, 1 ether);
        uint256 p0 = vps();
        uint256 cut = repaidLoan();
        assertEq(pool.backerFees(vb), cut);
        uint256 p1 = vps();
        assertGt(p1, p0, "fees raise the value per share");
        uint256 v1 = vault.backingValue();
        assertGe(v1, 1 ether + cut);

        uint256 bAt = pool.backing(vb);
        vm.prank(makeAddr("anyone"));
        uint256 h = vault.harvest();
        assertEq(h, cut);
        assertEq(pool.backerFees(vb), 0);
        assertEq(address(vault).balance, 0);
        assertApproxEqAbs(pool.backing(vb), bAt + cut, 1, "fees became backing");
        assertApproxEqAbs(vault.backingValue(), v1, 1, "harvest does not change the value");
        assertApproxEqAbs(vps(), p1, 1);

        vm.expectRevert(TrenchersStakeLines.NothingToHarvest.selector);
        vault.harvest();
    }

    function test_vaultHarvest_nothing_reverts() public {
        vm.expectRevert(TrenchersStakeLines.NothingToHarvest.selector);
        vault.harvest();
        fundAs(carol, 1 ether);
        vm.expectRevert(TrenchersStakeLines.NothingToHarvest.selector);
        vault.harvest();
    }

    function test_vaultHarvest_whilePoolPaused_reverts() public {
        fundAs(carol, 1 ether);
        repaidLoan();
        vm.prank(guardian);
        pool.pause();
        vm.prank(makeAddr("anyone"));
        vm.expectRevert(TrenchersStakeLines.NothingToHarvest.selector);
        vault.harvest();
        assertGt(pool.backerFees(vb), 0, "the revert undid the collect");
    }

    // ================================================================== defaults

    function test_vaultDefault_lossProRata_lendersWhole_stakeBurnt() public {
        fundAs(carol, 1 ether);
        fundAs(dave, 3 ether);
        uint256 c0 = valueOf(carol);
        uint256 d0 = valueOf(dave);
        uint256 price = sharePrice();
        uint256 aliceValue = pool.convertToAssets(pool.shares(alice));
        uint256 total0 = vault.backingValue();

        (uint256 lost, uint256 agentId) = defaultedLoan();

        uint256 cLoss = c0 - valueOf(carol);
        uint256 dLoss = d0 - valueOf(dave);
        assertApproxEqRel(dLoss, cLoss * 3, 1e12, "losses are pro rata");
        // the vault paid principal + fee; a slice of the unpaid fee comes back through the pool's share price
        assertLe(total0 - vault.backingValue(), lost);
        assertGe(total0 - vault.backingValue(), 0.1 ether);
        assertGe(sharePrice(), price, "lenders' share price unaffected");
        assertGe(pool.convertToAssets(pool.shares(alice)), aliceValue);
        assertEq(pool.totalBadDebt(), 0);
        assertEq(token.balanceOf(DEAD), 100_000 ether, "the whole stake burnt");
        (TrenchersStakeLines.Stake memory s,,,,) = vault.position(agentId);
        assertTrue(s.burnt);
        assertEq(vault.totalShares(), vault.sharesOf(carol) + vault.sharesOf(dave), "shares untouched");
    }

    // ================================================================== exit flow

    function test_vaultRequestExit_validations() public {
        fundAs(carol, 1 ether);
        uint256 s = vault.sharesOf(carol);
        vm.startPrank(carol);
        vm.expectRevert(TrenchersStakeLines.NoShares.selector);
        vault.requestExit(0);
        vm.expectRevert(TrenchersStakeLines.NoShares.selector);
        vault.requestExit(s + 1);
        vm.stopPrank();
        vm.prank(dave);
        vm.expectRevert(TrenchersStakeLines.NoShares.selector);
        vault.requestExit(1);

        uint64 ready = uint64(_now() + 7 days);
        vm.expectEmit(true, false, false, true, address(vault));
        emit TrenchersStakeLines.ExitRequested(carol, s / 2, ready);
        vm.prank(carol);
        vault.requestExit(s / 2);
        (uint256 es, uint64 at) = vault.exits(carol);
        assertEq(es, s / 2);
        assertEq(at, ready);

        // more than owned in total
        vm.prank(carol);
        vm.expectRevert(TrenchersStakeLines.NoShares.selector);
        vault.requestExit(s - s / 2 + 1);

        // adding restarts the 7 days
        vm.warp(_now() + 3 days);
        vm.prank(carol);
        vault.requestExit(s - s / 2);
        (es, at) = vault.exits(carol);
        assertEq(es, s);
        assertEq(at, uint64(_now() + 7 days));
        (,, uint256 exitShares, uint64 exitReadyAt) = vault.backerPosition(carol);
        assertEq(exitShares, s);
        assertEq(exitReadyAt, at);
        assertEq(vault.EXIT_DELAY(), 7 days);
    }

    function test_vaultCancelExit() public {
        fundAs(carol, 1 ether);
        vm.prank(carol);
        vm.expectRevert(TrenchersStakeLines.NoShares.selector);
        vault.cancelExit();
        uint256 s = requestAll(carol);
        vm.expectEmit(true, false, false, false, address(vault));
        emit TrenchersStakeLines.ExitCancelled(carol);
        vm.prank(carol);
        vault.cancelExit();
        (uint256 es, uint64 at) = vault.exits(carol);
        assertEq(es, 0);
        assertEq(at, 0);
        vm.warp(_now() + 8 days);
        vm.prank(carol);
        vm.expectRevert(TrenchersStakeLines.NoShares.selector);
        vault.exit(s, carol);
    }

    function test_vaultExit_notReady() public {
        fundAs(carol, 1 ether);
        uint256 s = requestAll(carol);
        uint64 ready = uint64(_now() + 7 days);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(TrenchersStakeLines.NotReady.selector, ready));
        vault.exit(s, carol);
        vm.warp(ready - 1);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(TrenchersStakeLines.NotReady.selector, ready));
        vault.exit(s, carol);
        vm.warp(ready);
        exitAs(carol, s, carol); // ready exactly at readyAt
    }

    function test_vaultExit_paysValueToTo() public {
        fundAs(carol, 1 ether);
        uint256 s = requestAll(carol);
        vm.warp(_now() + 7 days);
        address to = makeAddr("carol-cold");
        vm.expectEmit(true, true, false, true, address(vault));
        emit TrenchersStakeLines.Exited(carol, to, s, 1 ether);
        uint256 out = exitAs(carol, s, to);
        assertEq(out, 1 ether);
        assertEq(to.balance, 1 ether);
        assertEq(vault.sharesOf(carol), 0);
        assertEq(vault.totalShares(), 0);
        assertEq(pool.backerShares(vb), 0);
        (uint256 es,) = vault.exits(carol);
        assertEq(es, 0);
        // the vault starts over cleanly
        uint256 minted = fundAs(dave, 0.5 ether);
        assertEq(minted, 0.5 ether * 1e3);
        assertEq(valueOf(dave), 0.5 ether);
    }

    function test_vaultExit_partial() public {
        fundAs(carol, 1 ether);
        uint256 s = requestAll(carol);
        vm.warp(_now() + 7 days);
        uint256 out1 = exitAs(carol, s / 4, carol);
        assertEq(out1, 0.25 ether);
        (uint256 es, uint64 at) = vault.exits(carol);
        assertEq(es, s - s / 4, "the rest of the request stays");
        assertEq(at, uint64(_now()), "and stays ready");
        assertEq(valueOf(carol), 0.75 ether);
        uint256 out2 = exitAs(carol, s - s / 4, carol);
        assertEq(out1 + out2, 1 ether);
        assertEq(carol.balance, 1 ether);
    }

    function test_vaultExit_reverts_zeroTo_tooMany_noRequest() public {
        fundAs(carol, 1 ether);
        uint256 s = vault.sharesOf(carol);
        vm.prank(carol);
        vm.expectRevert(TrenchersStakeLines.NoShares.selector);
        vault.exit(s, carol); // never asked
        vm.prank(carol);
        vault.requestExit(s / 2);
        vm.warp(_now() + 7 days);
        vm.startPrank(carol);
        vm.expectRevert(TrenchersStakeLines.ZeroAddress.selector);
        vault.exit(s / 2, address(0));
        vm.expectRevert(TrenchersStakeLines.NoShares.selector);
        vault.exit(s / 2 + 1, carol);
        vm.expectRevert(TrenchersStakeLines.NoShares.selector);
        vault.exit(0, carol);
        vm.stopPrank();
        // someone else can't use carol's request
        vm.prank(dave);
        vm.expectRevert(TrenchersStakeLines.NoShares.selector);
        vault.exit(1, dave);
    }

    function test_vaultExit_onlyFreeBacking() public {
        fundAs(carol, 1 ether);
        (uint256 id, address o, uint256 pk) = newAgent("line");
        stakeOpen(id, o, pk, 100_000 ether); // 0.1 ETH line
        uint256 s = requestAll(carol);
        vm.warp(_now() + 7 days);
        vm.prank(carol);
        vm.expectPartialRevert(Pool.InsufficientBacking.selector);
        vault.exit(s, carol);

        // the free part can leave now
        uint256 part = s * 85 / 100;
        assertEq(exitAs(carol, part, carol), 0.85 ether);
        (, uint256 used, uint256 free,) = vault.backingInfo();
        assertEq(used, 0.1 ether);
        assertEq(free, 0.05 ether);
        vm.prank(carol);
        vm.expectPartialRevert(Pool.InsufficientBacking.selector);
        vault.exit(s - part, carol);

        // the rest once the line closes
        vm.prank(o);
        vault.close(id);
        assertEq(exitAs(carol, s - part, carol), 0.15 ether);
        assertEq(carol.balance, 1 ether);
    }

    function test_vaultExit_earlyFeeWhenBackingClockYoung() public {
        uint256 t0 = _now();
        fundAs(carol, 1 ether);
        uint256 s = requestAll(carol);
        vm.warp(t0 + 6 days);
        fundAs(dave, 1 ether); // the clock moves to t0 + 3 days
        assertApproxEqAbs(pool.lastBackingAt(vb), t0 + 3 days, 1);
        vm.warp(t0 + 7 days);
        uint256 price = sharePrice();
        uint256 out = exitAs(carol, s, carol);
        assertEq(out, 1 ether - 0.005 ether, "0.5% stays in the pool");
        assertGt(sharePrice(), price, "the fee went to the pool");
        assertGe(valueOf(dave), 1 ether);

        // past the clock's 7 days, no fee
        vm.warp(t0 + 10 days);
        uint256 sd = requestAll(dave);
        vm.warp(_now() + 7 days);
        uint256 v = valueOf(dave);
        assertEq(exitAs(dave, sd, dave), v);
    }

    function test_vaultExit_whilePoolPaused_collectsFeesProRata() public {
        fundAs(carol, 1 ether);
        fundAs(dave, 1 ether);
        uint256 sc = requestAll(carol);
        uint256 sd = requestAll(dave);
        uint256 cut = repaidLoan();
        vm.warp(_now() + 7 days);
        vm.prank(guardian);
        pool.pause();
        assertGt(pool.pausedUntil(), _now());

        uint256 vc = valueOf(carol);
        uint256 outC = exitAs(carol, sc, carol);
        assertApproxEqAbs(outC, vc, 1);
        assertEq(pool.backerFees(vb), 0, "fees collected to the vault");
        assertApproxEqAbs(address(vault).balance, cut / 2, 1, "half the fees stay for dave");

        uint256 vd = valueOf(dave);
        uint256 outD = exitAs(dave, sd, dave);
        assertEq(outD, vd);
        assertEq(address(vault).balance, 0);
        assertEq(pool.backerShares(vb), 0);
        assertApproxEqAbs(outC, outD, 2, "equal backers, equal pay");
        assertGe(outC + outD, 2 ether + cut);
    }

    function test_vaultExit_cashPartProRata() public {
        fundAs(carol, 1 ether);
        fundAs(dave, 3 ether);
        uint256 sc = requestAll(carol);
        uint256 cut = repaidLoan();
        vm.warp(_now() + 7 days);
        uint256 cashBefore = cut; // all of it is collected by the exit
        uint256 supply = vault.totalShares();
        uint256 poolPart = pool.backerShares(vb) * sc / supply;
        uint256 out = exitAs(carol, sc, carol);
        uint256 cash = cashBefore * sc / supply;
        assertEq(out, pool.convertToAssets(poolPart) + cash, "backing part + cash part");
        assertEq(address(vault).balance, cashBefore - cash, "dave's 3/4 of the fees stay");
        assertApproxEqRel(address(vault).balance, cut * 3 / 4, 1e12);
        // dave's position still counts the cash
        assertApproxEqAbs(valueOf(dave), vault.backingValue(), 1);
    }

    // ================================================================== nobody else can move backing

    function test_vault_noOwnerUnlockBacking() public {
        fundAs(carol, 1 ether);
        vm.warp(_now() + 7 days);
        uint256 total = vault.backingValue();
        uint256 bs = pool.backerShares(vb);
        // the old owner function is gone
        address[3] memory who = [timelock, guardian, carol];
        for (uint256 i; i < 3; i++) {
            vm.prank(who[i]);
            (bool ok,) = address(vault).call(abi.encodeWithSignature("unlockBacking(uint256,address)", bs, who[i]));
            assertFalse(ok, "no unlockBacking on the vault");
            // and the pool only lets the identity's owner (the vault itself) take backing out
            vm.prank(who[i]);
            vm.expectRevert();
            pool.unlockBacking(vb, bs, who[i], true);
            vm.prank(who[i]);
            vm.expectRevert();
            pool.claimBackerFees(vb, who[i], true);
        }
        // everything the owner and guardian can do leaves the backing where it is
        vm.startPrank(timelock);
        vault.setTerms(TOKENS_PER_ETH * 2, MAX_LINE, VAULT_MAX_TERM, 1 ether);
        vault.setGuardian(alice);
        vault.setPaused(true);
        vm.expectRevert(TrenchersStakeLines.Renounce.selector);
        vault.renounceOwnership();
        vm.stopPrank();
        vm.prank(alice);
        vault.setPaused(false);
        assertEq(vault.backingValue(), total);
        assertEq(pool.backerShares(vb), bs);
        assertEq(registry.ownerOf(vb), address(vault), "the vault keeps its identity");
        // the owner has no shares to exit with
        vm.prank(timelock);
        vm.expectRevert(TrenchersStakeLines.NoShares.selector);
        vault.requestExit(1);
    }

    function test_vault_exitWorksWhileStakeLinesPaused() public {
        fundAs(carol, 1 ether);
        uint256 s = requestAll(carol);
        vm.prank(guardian);
        vault.setPaused(true);
        vm.warp(_now() + 7 days);
        assertEq(exitAs(carol, s, carol), 1 ether);
    }

    function test_vault_sharesNotTransferable() public {
        fundAs(carol, 1 ether);
        uint256 s = vault.sharesOf(carol);
        vm.startPrank(carol);
        bytes[4] memory calls = [
            abi.encodeWithSignature("transfer(address,uint256)", dave, s),
            abi.encodeWithSignature("transferFrom(address,address,uint256)", carol, dave, s),
            abi.encodeWithSignature("approve(address,uint256)", dave, s),
            abi.encodeWithSignature("safeTransferFrom(address,address,uint256)", carol, dave, s)
        ];
        for (uint256 i; i < calls.length; i++) {
            (bool ok,) = address(vault).call(calls[i]);
            assertFalse(ok);
        }
        vm.stopPrank();
        assertEq(vault.sharesOf(carol), s);
        assertEq(vault.sharesOf(dave), 0);
    }

    // ================================================================== fairness and attacks

    /// Asking to leave the moment a loan goes overdue does not dodge its default: the 7-day wait outlasts the grace.
    function test_vaultFairness_exitRequestAtOverdueStillCarriesDefault() public {
        fundAs(carol, 1 ether);
        fundAs(dave, 1 ether);
        (,, uint256 loanId) = stakeBorrow(30 days);
        Pool.Loan memory l = pool.getLoan(loanId);
        vm.warp(l.dueAt + 1); // overdue
        uint256 s = requestAll(carol);
        (, uint64 ready) = vault.exits(carol);
        assertGt(ready, l.defaultableAt, "the wait ends after the grace");

        vm.warp(uint256(l.defaultableAt) + 1);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(TrenchersStakeLines.NotReady.selector, ready));
        vault.exit(s, carol);
        vm.prank(keeper);
        pool.markDefault(loanId);

        vm.warp(ready);
        uint256 daveValue = valueOf(dave);
        uint256 out = exitAs(carol, s, carol);
        assertApproxEqAbs(out, daveValue, 2, "carol carries her half of the default");
        assertLt(out, 1 ether - 0.05 ether);
        assertApproxEqAbs(out, (2 ether - l.principal - l.fee) / 2, 0.0005 ether);
    }

    function test_vaultAttack_inflationFirstDepositor() public {
        address attacker = makeAddr("attacker");
        fundAs(attacker, 0.01 ether); // the smallest first backing
        // a donation-like jump in value: backing added straight to the vault's identity
        vm.deal(attacker, attacker.balance + 10 ether);
        vm.prank(attacker);
        pool.addBacking{value: 10 ether}(vb, 10 ether);
        uint256 minted = fundAs(carol, 1 ether);
        assertGt(minted, 0);
        assertGe(valueOf(carol) + 10, 1 ether, "carol loses at most dust");
        assertLe(valueOf(attacker), 10.01 ether, "the attacker gains nothing");
    }

    function test_vaultAttack_inflationAfterVaultEmptied() public {
        // everyone left; the vault is still a backer with nothing in it
        fundAs(dave, 1 ether);
        uint256 s = requestAll(dave);
        vm.warp(_now() + 7 days);
        exitAs(dave, s, dave);
        assertEq(vault.totalShares(), 0);
        address attacker = makeAddr("attacker");
        fundAs(attacker, 1000); // 1000 wei
        vm.deal(attacker, attacker.balance + 10 ether);
        vm.prank(attacker);
        pool.addBacking{value: 10 ether}(vb, 10 ether);
        fundAs(carol, 1 ether);
        assertGe(valueOf(carol) + 10, 1 ether, "carol loses at most dust");
        assertLe(valueOf(attacker), 10 ether, "the attacker loses on the donation");
        // and carol can really take it out
        uint256 sc = requestAll(carol);
        vm.warp(_now() + 7 days);
        assertGe(exitAs(carol, sc, carol) + 10, 1 ether);
    }

    function test_vaultRounding_valuesNeverExceedTotal() public {
        address[3] memory b = [carol, dave, erin];
        uint256[3] memory amts = [uint256(0.0123456789 ether), 1 ether + 7, 3.333333333333333333 ether];
        for (uint256 i; i < 3; i++) fundAs(b[i], amts[i]);
        repaidLoan();
        (uint256 lost,) = defaultedLoan();
        assertGt(lost, 0);
        fundAs(carol, 7 wei);
        repaidLoan();
        uint256 sum;
        uint256 shares;
        for (uint256 i; i < 3; i++) {
            sum += valueOf(b[i]);
            shares += vault.sharesOf(b[i]);
        }
        assertEq(shares, vault.totalShares());
        assertLe(sum, vault.backingValue());
        assertApproxEqAbs(sum, vault.backingValue(), 3);

        // everyone leaves; the payouts never exceed what was there
        for (uint256 i; i < 3; i++) requestAll(b[i]);
        vm.warp(_now() + 7 days);
        uint256 total = vault.backingValue();
        uint256 paid;
        for (uint256 i; i < 3; i++) paid += exitAs(b[i], vault.sharesOf(b[i]), b[i]);
        assertLe(paid, total);
        assertApproxEqAbs(paid, total, 5);
        assertEq(vault.totalShares(), 0);
        assertEq(address(vault).balance, 0);
        assertEq(pool.backerShares(vb), 0);
    }

    // ================================================================== fuzz: value is conserved

    /// Random funds, exits, repaid loans and defaults by 3 backers:
    /// paid out + value left == deposits + (fees - default losses), within dust.
    function testFuzz_vault_conservesValue(uint256[10] memory ops, uint256[10] memory amts) public {
        address[3] memory b = [carol, dave, erin];
        uint256 deposits;
        int256 events; // what loans did to the vault's value
        uint256 paid;
        uint256 n;
        fundAs(carol, 0.5 ether); // somebody first, so loans can happen
        deposits += 0.5 ether;
        vm.warp(_now() + 7 days); // past the hold: exits pay no early fee
        for (uint256 i; i < ops.length; i++) {
            address who = b[amts[i] % 3];
            uint256 op = ops[i] % 4;
            if (op == 0) {
                uint256 amt = bound(amts[i], 0.01 ether, 5 ether);
                uint256 v0 = vault.backingValue();
                fundAs(who, amt);
                assertApproxEqAbs(vault.backingValue(), v0 + amt, 2);
                deposits += amt;
                vm.warp(_now() + 7 days);
            } else if (op == 1) {
                uint256 sh = vault.sharesOf(who) * bound(ops[i] >> 8, 1, 100) / 100;
                if (sh == 0) continue;
                (uint256 pending,) = vault.exits(who);
                if (pending > 0) {
                    vm.prank(who);
                    vault.cancelExit();
                }
                vm.prank(who);
                vault.requestExit(sh);
                vm.warp(_now() + 7 days);
                uint256 v0 = vault.backingValue();
                uint256 expect = v0 * sh / vault.totalShares();
                address to = makeAddr("sink");
                uint256 bal = to.balance;
                exitAs(who, sh, to);
                uint256 got = to.balance - bal;
                assertApproxEqAbs(got, expect, 2, "exit pays the shares' value");
                assertApproxEqAbs(v0 - vault.backingValue(), got, 2, "no fee past the hold");
                paid += got;
            } else {
                if (pool.freeBacking(vb) < 0.2 ether) continue;
                uint256 v0 = vault.backingValue();
                if (op == 2) {
                    repaidLoan();
                    assertGt(vault.backingValue(), v0);
                } else {
                    (uint256 lost,) = defaultedLoan();
                    assertLt(vault.backingValue(), v0);
                    assertLe(v0 - vault.backingValue(), lost);
                    assertGe(v0 - vault.backingValue(), 0.1 ether);
                }
                events += int256(vault.backingValue()) - int256(v0);
                n++;
            }
            // shares add up and nobody's value exceeds the whole
            uint256 sum;
            uint256 shares;
            for (uint256 k; k < 3; k++) {
                sum += valueOf(b[k]);
                shares += vault.sharesOf(b[k]);
            }
            assertEq(shares, vault.totalShares());
            assertLe(sum, vault.backingValue());
        }
        assertApproxEqAbs(
            int256(paid) + int256(vault.backingValue()), int256(deposits) + events, 4 * ops.length + 4, "value conserved"
        );
        assertEq(pool.totalBadDebt(), 0);
    }
}
