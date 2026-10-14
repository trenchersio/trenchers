// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseTest} from "./helpers/BaseTest.sol";
import {TrenchersCreditPool as Pool} from "../src/TrenchersCreditPool.sol";
import {TrenchersStakeLines} from "../src/TrenchersStakeLines.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockToken} from "./mocks/MockToken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract TrenchersStakeLinesTest is BaseTest {
    uint256 internal agentId;
    address internal agentOwner;
    uint256 internal agentPk;
    uint256 internal vb; // the vault's backer id

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    function setUp() public override {
        super.setUp();
        lend(alice, 10 ether);
        fundVault(1 ether);
        vb = vault.backerId();
        (agentId, agentOwner, agentPk) = newAgent("agent");
    }

    function _now() internal view returns (uint256) {
        return vm.getBlockTimestamp();
    }

    // ================================================================== construction, funding

    function test_constructor_registersIdentity() public view {
        assertEq(vb, 1);
        assertEq(registry.ownerOf(vb), address(vault));
        assertEq(address(vault.registry()), address(registry));
        assertEq(vault.weekStart(), 1_700_000_000);
        assertEq(vault.tokensPerEth(), TOKENS_PER_ETH);
    }

    function test_constructor_badTerms() public {
        vm.expectRevert(TrenchersStakeLines.BadTerms.selector);
        new TrenchersStakeLines(pool, IERC20(address(token)), timelock, guardian, 0, MAX_LINE, 30 days, WEEKLY_CAP, "");
    }

    function test_fund_firstRegistersAndSetsHook() public view {
        Pool.Agent memory me = pool.getAgent(vb);
        assertTrue(me.isBacker);
        assertEq(pool.hook(vb), address(vault));
        assertEq(pool.backing(vb), 1 ether);
    }

    function test_fund_secondAdds_andZeroReverts() public {
        fundVault(0.5 ether);
        assertEq(pool.backing(vb), 1.5 ether);
        vm.expectRevert(TrenchersStakeLines.BadTerms.selector);
        vault.fund{value: 0}();
    }

    function test_fund_firstBelowMinBacking() public {
        TrenchersStakeLines v2 = new TrenchersStakeLines(
            pool, IERC20(address(token)), timelock, guardian, TOKENS_PER_ETH, MAX_LINE, 30 days, WEEKLY_CAP, "v2"
        );
        vm.expectRevert(abi.encodeWithSelector(Pool.BelowMinBacking.selector, 0.001 ether, 0.01 ether));
        v2.fund{value: 0.001 ether}();
    }

    function test_receive_onlyPool() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok, bytes memory ret) = address(vault).call{value: 1}("");
        assertFalse(ok);
        assertEq(bytes4(ret), TrenchersStakeLines.NotPool.selector);
    }

    // ================================================================== line math

    function test_lineFor() public view {
        assertEq(vault.lineFor(0), 0);
        assertEq(vault.lineFor(1_000 ether), 0.001 ether);
        assertEq(vault.lineFor(999 ether), 0); // rounds down to the 0.001 step
        assertEq(vault.lineFor(50_000 ether), 0.05 ether);
        assertEq(vault.lineFor(50_999.99 ether), 0.05 ether);
        assertEq(vault.lineFor(100_000 ether), MAX_LINE);
        assertEq(vault.lineFor(10_000_000 ether), MAX_LINE); // capped
    }

    function test_lineFor_capNotOnStep() public {
        vm.prank(timelock);
        vault.setTerms(TOKENS_PER_ETH, 0.0105 ether, 30 days, WEEKLY_CAP);
        assertEq(vault.lineFor(1_000_000 ether), 0.01 ether);
    }

    function testFuzz_lineFor(uint256 tokens) public view {
        tokens = bound(tokens, 0, 1e30);
        uint256 line = vault.lineFor(tokens);
        assertEq(line % 0.001 ether, 0);
        assertLe(line, MAX_LINE);
        assertLe(line, tokens * 1 ether / TOKENS_PER_ETH);
        if (tokens * 1 ether / TOKENS_PER_ETH < MAX_LINE) {
            assertGt(line + 0.001 ether, tokens * 1 ether / TOKENS_PER_ETH);
        }
    }

    // ================================================================== happy path

    function test_happyPath() public {
        uint256 tokens = 80_000 ether; // 0.08 ETH line
        stakeOpen(agentId, agentOwner, agentPk, tokens);
        (TrenchersStakeLines.Stake memory s, uint256 lineInPool, uint256 drawn, uint256 active, bool here) =
            vault.position(agentId);
        assertEq(s.staker, agentOwner);
        assertEq(s.tokens, tokens);
        assertEq(s.line, 0.08 ether);
        assertEq(lineInPool, 0.08 ether);
        assertEq(drawn, 0);
        assertEq(active, 0);
        assertTrue(here);
        assertEq(token.balanceOf(address(vault)), tokens);
        assertEq(vault.totalStaked(), tokens);
        assertEq(vault.linesOpened(), 1);
        assertEq(vault.openedThisWeek(), 0.08 ether);

        // borrow ETH
        uint256 bal = agentOwner.balance;
        uint256 id = borrowAs(agentOwner, agentId, 0.08 ether, 30 days);
        assertEq(agentOwner.balance - bal, 0.08 ether);

        // close blocked while the loan is open
        vm.prank(agentOwner);
        vm.expectRevert(TrenchersStakeLines.LoanOpen.selector);
        vault.close(agentId);

        // repay
        vm.warp(_now() + 20 days);
        repayEth(id);
        uint256 fees = pool.backerFees(vb);
        assertEq(fees, 0.0002 ether); // 25% of 0.0008

        // harvest compounds into backing
        (uint256 total0,,,) = vault.backingInfo();
        vm.prank(makeAddr("anyone"));
        uint256 h = vault.harvest();
        assertEq(h, fees);
        (uint256 total1, uint256 used, uint256 free, uint256 waiting) = vault.backingInfo();
        assertApproxEqAbs(total1, total0 + fees, 1);
        assertEq(waiting, 0);
        assertEq(used, 0.08 ether);
        assertEq(free, total1 - used);
        vm.expectRevert(TrenchersStakeLines.NothingToHarvest.selector);
        vault.harvest();

        // close returns the stake
        vm.prank(agentOwner);
        vault.close(agentId);
        assertEq(token.balanceOf(agentOwner), tokens);
        assertEq(vault.totalStaked(), 0);
        assertEq(pool.getAgent(agentId).backer, 0);
        assertEq(pool.getAgent(vb).linesOut, 0);
        (s,,,,) = vault.position(agentId);
        assertEq(s.tokens, 0);
        // and a new stake can be opened
        stakeOpen(agentId, agentOwner, agentPk, 1_000 ether);
    }

    function test_open_reverts() public {
        token.mint(agentOwner, 1_000_000 ether);
        vm.prank(agentOwner);
        token.approve(address(vault), type(uint256).max);
        (Pool.Consent memory c, bytes memory sig) = signedConsent(agentId, vb, agentOwner, agentPk, 0);

        vm.prank(alice);
        vm.expectRevert(TrenchersStakeLines.NotAgentOwner.selector);
        vault.open(agentId, 10_000 ether, c, sig);

        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(TrenchersStakeLines.LineTooSmall.selector, 0));
        vault.open(agentId, 999 ether, c, sig);

        // a consent for some other backer fails in the pool
        Pool.Consent memory bad = consentFor(agentId, 77, agentOwner, 0, _now() + 1);
        bytes memory badSig = sign(bad, agentPk);
        vm.prank(agentOwner);
        vm.expectRevert(Pool.BadConsent.selector);
        vault.open(agentId, 10_000 ether, bad, badSig);

        vm.prank(agentOwner);
        vault.open(agentId, 10_000 ether, c, sig);
        (c, sig) = signedConsent(agentId, vb, agentOwner, agentPk, 0);
        vm.prank(agentOwner);
        vm.expectRevert(TrenchersStakeLines.HasStake.selector);
        vault.open(agentId, 10_000 ether, c, sig);
    }

    function test_open_needsBacking() public {
        TrenchersStakeLines v2 = new TrenchersStakeLines(
            pool, IERC20(address(token)), timelock, guardian, TOKENS_PER_ETH, MAX_LINE, 30 days, WEEKLY_CAP, "v2"
        );
        v2.fund{value: 0.05 ether}();
        token.mint(agentOwner, 100_000 ether);
        Pool.Consent memory c = consentFor(agentId, v2.backerId(), agentOwner, 0, _now() + 1);
        bytes memory sig = sign(c, agentPk);
        vm.startPrank(agentOwner);
        token.approve(address(v2), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(Pool.InsufficientBacking.selector, v2.backerId(), 0.1 ether, 0.05 ether));
        v2.open(agentId, 100_000 ether, c, sig);
        vm.stopPrank();
    }

    // ================================================================== weekly cap

    function test_weeklyCap_andReset() public {
        // 0.5 ETH a week, 0.1 per line
        for (uint256 i; i < 5; i++) {
            (uint256 id, address o, uint256 pk) = newAgent(string(abi.encodePacked("a", vm.toString(i))));
            stakeOpen(id, o, pk, 100_000 ether);
        }
        assertEq(vault.weeklyRoom(), 0);
        (uint256 id6, address o6, uint256 pk6) = newAgent("a6");
        token.mint(o6, 1_000 ether);
        (Pool.Consent memory c, bytes memory sig) = signedConsent(id6, vb, o6, pk6, 0);
        vm.startPrank(o6);
        token.approve(address(vault), 1_000 ether);
        vm.expectRevert(abi.encodeWithSelector(TrenchersStakeLines.WeeklyCapReached.selector, 0));
        vault.open(id6, 1_000 ether, c, sig);
        vm.stopPrank();

        uint256 start = vault.weekStart();
        vm.warp(start + 7 days - 1);
        assertEq(vault.weeklyRoom(), 0);
        vm.warp(start + 7 days);
        assertEq(vault.weeklyRoom(), WEEKLY_CAP);
        (c, sig) = signedConsent(id6, vb, o6, pk6, 0);
        vm.prank(o6);
        vault.open(id6, 1_000 ether, c, sig);
        assertEq(vault.weekStart(), start + 7 days);
        assertEq(vault.openedThisWeek(), 0.001 ether);
        assertEq(vault.weeklyRoom(), WEEKLY_CAP - 0.001 ether);

        // weeks skipped: weekStart stays on the 7-day grid
        vm.warp(start + 7 days * 5 + 3 days);
        (uint256 id7, address o7, uint256 pk7) = newAgent("a7");
        stakeOpen(id7, o7, pk7, 1_000 ether);
        assertEq(vault.weekStart(), start + 7 days * 5);
    }

    function test_weeklyCap_partialRoom() public {
        vm.prank(timelock);
        vault.setTerms(TOKENS_PER_ETH, MAX_LINE, 30 days, 0.15 ether);
        stakeOpen(agentId, agentOwner, agentPk, 100_000 ether);
        (uint256 id2, address o2, uint256 pk2) = newAgent("a2");
        token.mint(o2, 100_000 ether);
        (Pool.Consent memory c, bytes memory sig) = signedConsent(id2, vb, o2, pk2, 0);
        vm.startPrank(o2);
        token.approve(address(vault), 100_000 ether);
        vm.expectRevert(abi.encodeWithSelector(TrenchersStakeLines.WeeklyCapReached.selector, 0.05 ether));
        vault.open(id2, 100_000 ether, c, sig);
        vault.open(id2, 50_000 ether, c, sig);
        vm.stopPrank();
    }

    // ================================================================== add

    function test_add_raisesLine() public {
        stakeOpen(agentId, agentOwner, agentPk, 30_000 ether);
        token.mint(agentOwner, 100_000 ether);
        vm.startPrank(agentOwner);
        token.approve(address(vault), type(uint256).max);
        vault.add(agentId, 20_500 ether);
        vm.stopPrank();
        assertEq(pool.getAgent(agentId).line, 0.05 ether);
        (TrenchersStakeLines.Stake memory s,,,,) = vault.position(agentId);
        assertEq(s.tokens, 50_500 ether);
        assertEq(s.line, 0.05 ether);
        assertEq(vault.openedThisWeek(), 0.05 ether);
        // past the cap: tokens taken, line stays at max
        vm.prank(agentOwner);
        vault.add(agentId, 79_500 ether);
        assertEq(pool.getAgent(agentId).line, MAX_LINE);
        assertEq(vault.totalStaked(), 130_000 ether);
        // borrowing up to the raised line works
        borrowAs(agentOwner, agentId, MAX_LINE, 30 days);
    }

    function test_add_reverts() public {
        token.mint(alice, 10_000 ether);
        vm.prank(alice);
        vm.expectRevert(TrenchersStakeLines.NoStake.selector);
        vault.add(agentId, 1);

        stakeOpen(agentId, agentOwner, agentPk, 30_000 ether);
        vm.prank(alice);
        vm.expectRevert(TrenchersStakeLines.NotStaker.selector);
        vault.add(agentId, 1);

        // the staker who no longer owns the agent cannot add
        vm.prank(agentOwner);
        registry.transferFrom(agentOwner, bob, agentId);
        vm.prank(agentOwner);
        vm.expectRevert(TrenchersStakeLines.NotStaker.selector);
        vault.add(agentId, 1);
        vm.prank(bob);
        vm.expectRevert(TrenchersStakeLines.NotStaker.selector);
        vault.add(agentId, 1);
    }

    function test_add_afterLineMovedAway_noStake() public {
        stakeOpen(agentId, agentOwner, agentPk, 30_000 ether);
        (uint256 b2, address b2o) = newBacker("backer2", 1 ether);
        openLineAs(b2o, b2, agentId, agentOwner, agentPk, 0.01 ether, 0);
        (TrenchersStakeLines.Stake memory s,,,,) = vault.position(agentId);
        assertEq(s.line, 0, "onRelease brought the vault's view in line");
        token.mint(agentOwner, 1 ether);
        vm.startPrank(agentOwner);
        token.approve(address(vault), 1 ether);
        vm.expectRevert(TrenchersStakeLines.NoStake.selector);
        vault.add(agentId, 1 ether);
        // the stake still comes back
        vault.close(agentId);
        vm.stopPrank();
        assertEq(token.balanceOf(agentOwner), 30_000 ether + 1 ether);
        assertEq(pool.getAgent(agentId).backer, b2, "the other backer's line untouched");
    }

    // ================================================================== close

    function test_close_reverts() public {
        vm.prank(agentOwner);
        vm.expectRevert(TrenchersStakeLines.NotStaker.selector);
        vault.close(agentId);
        stakeOpen(agentId, agentOwner, agentPk, 30_000 ether);
        vm.prank(alice);
        vm.expectRevert(TrenchersStakeLines.NotStaker.selector);
        vault.close(agentId);
    }

    function test_transferredNft_borrowBlocked_oldStakerCloses() public {
        stakeOpen(agentId, agentOwner, agentPk, 50_000 ether);
        vm.prank(agentOwner);
        registry.transferFrom(agentOwner, bob, agentId);
        // the new owner controls the agent in the pool, but the vault's hook says no
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Pool.BorrowBlockedByBacker.selector, vb));
        pool.borrow(agentId, 0.01 ether, 30 days, bob, type(uint256).max, true);
        assertFalse(vault.canBorrow(vb, agentId, 0.01 ether, 30 days, 0, bob, bob, bob));
        // the old staker takes the stake back
        vm.prank(agentOwner);
        vault.close(agentId);
        assertEq(token.balanceOf(agentOwner), 50_000 ether);
        assertEq(pool.getAgent(agentId).line, 0);
        assertEq(pool.getAgent(vb).linesOut, 0);
    }

    function test_transferredNft_withLoan_closeWaitsForRepay() public {
        stakeOpen(agentId, agentOwner, agentPk, 50_000 ether);
        uint256 id = borrowAs(agentOwner, agentId, 0.05 ether, 30 days);
        vm.prank(agentOwner);
        registry.transferFrom(agentOwner, bob, agentId);
        vm.prank(agentOwner);
        vm.expectRevert(TrenchersStakeLines.LoanOpen.selector);
        vault.close(agentId);
        repayEth(id);
        vm.prank(agentOwner);
        vault.close(agentId);
        assertEq(token.balanceOf(agentOwner), 50_000 ether);
    }

    function test_transferBack_restoresBorrowing() public {
        stakeOpen(agentId, agentOwner, agentPk, 50_000 ether);
        vm.prank(agentOwner);
        registry.transferFrom(agentOwner, bob, agentId);
        vm.prank(bob);
        registry.transferFrom(bob, agentOwner, agentId);
        borrowAs(agentOwner, agentId, 0.05 ether, 30 days);
    }

    // ================================================================== default

    function test_default_burnsStake_poolPaidFromVaultBacking() public {
        uint256 tokens = 100_000 ether;
        stakeOpen(agentId, agentOwner, agentPk, tokens);
        uint256 id = borrowAs(agentOwner, agentId, 0.1 ether, 30 days);
        Pool.Loan memory l = pool.getLoan(id);

        vm.warp(l.defaultableAt + 1);
        uint256 price = sharePrice();
        uint256 aliceValue = pool.convertToAssets(pool.shares(alice));
        uint256 backingBefore = pool.backing(vb);
        vm.prank(keeper);
        pool.markDefault(id);

        assertGe(sharePrice(), price, "share price never falls");
        assertGe(pool.convertToAssets(pool.shares(alice)), aliceValue, "lenders untouched");
        assertLe(pool.backing(vb), backingBefore - l.principal, "the vault paid");
        assertEq(pool.totalBadDebt(), 0);
        assertTrue(wethSolvent());

        assertEq(token.balanceOf(DEAD), tokens);
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(vault.totalBurnt(), tokens);
        assertEq(vault.totalStaked(), 0);
        (TrenchersStakeLines.Stake memory s,,,,) = vault.position(agentId);
        assertTrue(s.burnt);
        assertEq(s.tokens, 0);
        assertEq(s.line, 0);
        assertEq(pool.getAgent(vb).linesOut, 0);
        assertEq(pool.getAgent(vb).backedDefaults, 1);

        // nothing more can be done with this stake
        vm.startPrank(agentOwner);
        vm.expectRevert(TrenchersStakeLines.NoStake.selector);
        vault.close(agentId);
        vm.expectRevert(TrenchersStakeLines.NoStake.selector);
        vault.add(agentId, 1);
        vm.stopPrank();
        token.mint(agentOwner, 10_000 ether);
        (Pool.Consent memory c, bytes memory sig) = signedConsent(agentId, vb, agentOwner, agentPk, 0);
        vm.startPrank(agentOwner);
        token.approve(address(vault), 10_000 ether);
        vm.expectRevert(TrenchersStakeLines.HasStake.selector);
        vault.open(agentId, 10_000 ether, c, sig);
        vm.stopPrank();
    }

    function test_default_otherStakersUnaffected() public {
        (uint256 id2, address o2, uint256 pk2) = newAgent("good");
        stakeOpen(agentId, agentOwner, agentPk, 100_000 ether);
        stakeOpen(id2, o2, pk2, 100_000 ether);
        uint256 bad = borrowAs(agentOwner, agentId, 0.1 ether, 30 days);
        uint256 good = borrowAs(o2, id2, 0.1 ether, 30 days);
        vm.warp(_now() + 29 days);
        repayEth(good);
        vm.warp(_now() + 5 days);
        pool.markDefault(bad);
        vm.prank(o2);
        vault.close(id2);
        assertEq(token.balanceOf(o2), 100_000 ether);
        assertEq(token.balanceOf(DEAD), 100_000 ether);
    }

    // ================================================================== pause

    function test_paused_blocksOpenAddBorrow_notClose() public {
        stakeOpen(agentId, agentOwner, agentPk, 50_000 ether);
        vm.prank(alice);
        vm.expectRevert(TrenchersStakeLines.NotGuardian.selector);
        vault.setPaused(true);
        vm.prank(guardian);
        vault.setPaused(true);
        assertTrue(vault.paused());

        (uint256 id2, address o2, uint256 pk2) = newAgent("a2");
        token.mint(o2, 10_000 ether);
        (Pool.Consent memory c, bytes memory sig) = signedConsent(id2, vb, o2, pk2, 0);
        vm.startPrank(o2);
        token.approve(address(vault), 10_000 ether);
        vm.expectRevert(TrenchersStakeLines.IsPaused.selector);
        vault.open(id2, 10_000 ether, c, sig);
        vm.stopPrank();

        vm.prank(agentOwner);
        vm.expectRevert(TrenchersStakeLines.IsPaused.selector);
        vault.add(agentId, 1);

        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.BorrowBlockedByBacker.selector, vb));
        pool.borrow(agentId, 0.01 ether, 30 days, agentOwner, type(uint256).max, true);

        vm.prank(agentOwner);
        vault.close(agentId);
        assertEq(token.balanceOf(agentOwner), 50_000 ether);

        vm.prank(timelock);
        vault.setPaused(false);
        assertFalse(vault.paused());
    }

    function test_maxTerm_enforcedByHook() public {
        vm.prank(timelock);
        vault.setTerms(TOKENS_PER_ETH, MAX_LINE, 7 days, WEEKLY_CAP);
        stakeOpen(agentId, agentOwner, agentPk, 50_000 ether);
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.BorrowBlockedByBacker.selector, vb));
        pool.borrow(agentId, 0.01 ether, 7 days + 1, agentOwner, type(uint256).max, true);
        borrowAs(agentOwner, agentId, 0.01 ether, 7 days);
    }

    // ================================================================== hooks are pool-only

    function test_hooks_onlyPool() public {
        vm.startPrank(alice);
        vm.expectRevert(TrenchersStakeLines.NotPool.selector);
        vault.onBorrow(vb, agentId, 1);
        vm.expectRevert(TrenchersStakeLines.NotPool.selector);
        vault.onDefault(vb, agentId, 1, 1, true);
        vm.expectRevert(TrenchersStakeLines.NotPool.selector);
        vault.onRelease(vb, agentId, 1, 0);
        vm.stopPrank();
    }

    function test_onDefault_byOthers_cannotBurnStake() public {
        stakeOpen(agentId, agentOwner, agentPk, 50_000 ether);
        vm.prank(alice);
        vm.expectRevert(TrenchersStakeLines.NotPool.selector);
        vault.onDefault(vb, agentId, 1, 1, true);
        assertEq(token.balanceOf(address(vault)), 50_000 ether);
    }

    function test_onERC721Received() public view {
        assertEq(vault.onERC721Received(address(0), address(0), 0, ""), IERC721Receiver.onERC721Received.selector);
    }

    // ================================================================== owner

    function test_setTerms() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.setTerms(1, 1 ether, 1, 1 ether);
        vm.startPrank(timelock);
        vm.expectRevert(TrenchersStakeLines.BadTerms.selector);
        vault.setTerms(0, 0.1 ether, 30 days, 1 ether);
        vm.expectRevert(TrenchersStakeLines.BadTerms.selector);
        vault.setTerms(1 ether, 0.001 ether - 1, 30 days, 1 ether);
        vm.expectRevert(TrenchersStakeLines.BadTerms.selector);
        vault.setTerms(1 ether, 0.1 ether, 0, 1 ether);
        vm.expectRevert(TrenchersStakeLines.BadTerms.selector);
        vault.setTerms(1 ether, 0.1 ether, 30 days, 0.1 ether - 1);
        vault.setTerms(2 ether, 0.2 ether, 14 days, 0.2 ether);
        vm.stopPrank();
        assertEq(vault.tokensPerEth(), 2 ether);
        assertEq(vault.maxLine(), 0.2 ether);
        assertEq(vault.maxTerm(), 14 days);
        assertEq(vault.weeklyCap(), 0.2 ether);
    }

    function test_unlockBacking_onlyOwner() public {
        vm.warp(_now() + 7 days); // past the backing hold: no exit fee
        uint256 s = pool.backerShares(vb) / 2;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.unlockBacking(s, alice);
        address to = makeAddr("treasury");
        vm.prank(timelock);
        vault.unlockBacking(s, to);
        assertEq(to.balance, 0.5 ether);
    }

    function test_unlockBacking_earlyFee() public {
        uint256 s = pool.backerShares(vb) / 2;
        address to = makeAddr("treasury");
        vm.prank(timelock);
        vault.unlockBacking(s, to);
        assertEq(to.balance, 0.5 ether - 0.0025 ether);
    }

    function test_harvestAndFund_moveTheBackingClock() public {
        uint256 t0 = pool.lastBackingAt(vb);
        vm.warp(_now() + 6 days);
        fundVault(1 ether); // equal amount: halfway
        assertApproxEqAbs(pool.lastBackingAt(vb), t0 + 3 days, 1);
    }

    function test_unlockBacking_cannotTakeWhatBacksLines() public {
        stakeOpen(agentId, agentOwner, agentPk, 100_000 ether);
        uint256 s = pool.backerShares(vb);
        vm.prank(timelock);
        vm.expectPartialRevert(Pool.InsufficientBacking.selector);
        vault.unlockBacking(s, timelock);
    }

    function test_freeze_onlyOwner() public {
        stakeOpen(agentId, agentOwner, agentPk, 50_000 ether);
        borrowAs(agentOwner, agentId, 0.01 ether, 30 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.freeze(agentId, true);
        vm.prank(timelock);
        vault.freeze(agentId, true);
        assertTrue(pool.getAgent(agentId).frozen);
        assertEq(pool.getAgent(agentId).line, 0.01 ether);
        (TrenchersStakeLines.Stake memory s,,,,) = vault.position(agentId);
        assertEq(s.line, 0.01 ether, "vault tracks the release");
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(Pool.IsFrozen.selector, agentId));
        pool.borrow(agentId, 0.01 ether, 30 days, agentOwner, type(uint256).max, true);
    }

    function test_setGuardian_renounce() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.setGuardian(alice);
        vm.prank(timelock);
        vault.setGuardian(alice);
        assertEq(vault.guardian(), alice);
        vm.prank(alice);
        vault.setPaused(true);
        vm.prank(timelock);
        vm.expectRevert(TrenchersStakeLines.Renounce.selector);
        vault.renounceOwnership();
    }

    function test_harvest_whenPoolPaused_reverts() public {
        stakeOpen(agentId, agentOwner, agentPk, 50_000 ether);
        uint256 id = borrowAs(agentOwner, agentId, 0.05 ether, 30 days);
        repayEth(id);
        vm.prank(guardian);
        pool.pause();
        vm.expectRevert(Pool.Paused.selector);
        vault.harvest();
    }

    // ================================================================== weekly room comes back on close

    function _openWithConsent(uint256 id, address o, uint256 pk, uint256 tokens) internal {
        Pool.Consent memory c = consentFor(id, vb, o, 0, _now() + 1);
        bytes memory sig = sign(c, pk);
        vm.prank(o);
        vault.open(id, tokens, c, sig);
    }

    function test_weeklyRoom_refundedOnSameWeekClose() public {
        token.mint(agentOwner, 100_000 ether);
        vm.prank(agentOwner);
        token.approve(address(vault), type(uint256).max);
        for (uint256 i; i < 5; i++) {
            _openWithConsent(agentId, agentOwner, agentPk, 100_000 ether);
            assertEq(vault.openedThisWeek(), 0.1 ether);
            vm.prank(agentOwner);
            vault.close(agentId);
            assertEq(vault.openedThisWeek(), 0);
        }
        assertEq(vault.weeklyRoom(), WEEKLY_CAP);
        (uint256 id2, address o2, uint256 pk2) = newAgent("honest");
        stakeOpen(id2, o2, pk2, 100_000 ether);
        assertEq(vault.openedThisWeek(), 0.1 ether);
    }

    function test_weeklyRoom_refundIncludesAdds() public {
        stakeOpen(agentId, agentOwner, agentPk, 30_000 ether);
        token.mint(agentOwner, 40_000 ether);
        vm.startPrank(agentOwner);
        token.approve(address(vault), 40_000 ether);
        vault.add(agentId, 40_000 ether);
        assertEq(vault.openedThisWeek(), 0.07 ether);
        vault.close(agentId);
        vm.stopPrank();
        assertEq(vault.openedThisWeek(), 0);
    }

    function test_weeklyRoom_noRefundForEarlierWeek() public {
        stakeOpen(agentId, agentOwner, agentPk, 100_000 ether);
        uint256 start = vault.weekStart();
        // next week someone else opens, which rolls the week
        vm.warp(start + 7 days + 1 hours);
        (uint256 id2, address o2, uint256 pk2) = newAgent("next-week");
        stakeOpen(id2, o2, pk2, 50_000 ether);
        assertEq(vault.weekStart(), start + 7 days);
        assertEq(vault.openedThisWeek(), 0.05 ether);
        // closing last week's line gives nothing back to this week
        vm.prank(agentOwner);
        vault.close(agentId);
        assertEq(vault.openedThisWeek(), 0.05 ether);
    }

    function test_weeklyRoom_noRefundAfterWeekEndsWithoutRoll() public {
        stakeOpen(agentId, agentOwner, agentPk, 100_000 ether);
        uint256 start = vault.weekStart();
        vm.warp(start + 8 days); // nobody has rolled the week
        vm.prank(agentOwner);
        vault.close(agentId);
        assertEq(vault.openedThisWeek(), 0.1 ether, "stale counter left alone");
        assertEq(vault.weeklyRoom(), WEEKLY_CAP, "the new week is whole anyway");
    }

    // ================================================================== a default the hook could not burn

    /// Defaults with the token refusing transfers to DEAD: the hook fails, the pool carries on.
    function _defaultWithBurnBlocked(uint256 tokens) internal returns (uint256 loanId) {
        stakeOpen(agentId, agentOwner, agentPk, tokens);
        loanId = borrowAs(agentOwner, agentId, 0.05 ether, 30 days);
        token.setBlockDead(true);
        vm.warp(pool.getLoan(loanId).defaultableAt + 1);
        vm.expectEmit(true, false, false, true, address(pool));
        emit Pool.HookFailed(vb, vault.onDefault.selector);
        pool.markDefault(loanId);
        assertTrue(pool.getAgent(agentId).defaulted);
        (TrenchersStakeLines.Stake memory s,,,,) = vault.position(agentId);
        assertFalse(s.burnt, "hook could not burn");
        assertEq(s.tokens, tokens);
        assertEq(token.balanceOf(address(vault)), tokens);
        assertEq(pool.getAgent(agentId).backer, 0, "the pool already settled the line");
    }

    function test_close_defaultedAgent_burnsInsteadOfReturning() public {
        uint256 tokens = 50_000 ether;
        _defaultWithBurnBlocked(tokens);
        // while transfers to DEAD still fail, close cannot hand the stake back either
        vm.prank(agentOwner);
        vm.expectRevert();
        vault.close(agentId);
        assertEq(token.balanceOf(agentOwner), 0);

        token.setBlockDead(false);
        vm.prank(agentOwner);
        vault.close(agentId);
        assertEq(token.balanceOf(agentOwner), 0, "no tokens back");
        assertEq(token.balanceOf(DEAD), tokens);
        assertEq(vault.totalBurnt(), tokens);
        assertEq(vault.totalStaked(), 0);
        (TrenchersStakeLines.Stake memory s,,,,) = vault.position(agentId);
        assertTrue(s.burnt);
        assertEq(s.tokens, 0);
        vm.prank(agentOwner);
        vm.expectRevert(TrenchersStakeLines.NoStake.selector);
        vault.close(agentId);
        vm.expectRevert(TrenchersStakeLines.NoStake.selector);
        vault.burnDefaulted(agentId);
    }

    function test_burnDefaulted_byAnyone() public {
        uint256 tokens = 50_000 ether;
        _defaultWithBurnBlocked(tokens);
        vm.prank(keeper);
        vm.expectRevert(MockToken.DeadBlocked.selector);
        vault.burnDefaulted(agentId);
        token.setBlockDead(false);
        vm.prank(keeper);
        vault.burnDefaulted(agentId);
        assertEq(token.balanceOf(DEAD), tokens);
        assertEq(vault.totalBurnt(), tokens);
        assertEq(vault.totalStaked(), 0);
        assertEq(token.balanceOf(address(vault)), 0);
        vm.prank(agentOwner);
        vm.expectRevert(TrenchersStakeLines.NoStake.selector);
        vault.close(agentId);
        vm.expectRevert(TrenchersStakeLines.NoStake.selector);
        vault.burnDefaulted(agentId);
    }

    function test_burnDefaulted_reverts() public {
        // no stake
        vm.expectRevert(TrenchersStakeLines.NoStake.selector);
        vault.burnDefaulted(agentId);
        // a stake on an agent in good standing
        stakeOpen(agentId, agentOwner, agentPk, 50_000 ether);
        uint256 id = borrowAs(agentOwner, agentId, 0.05 ether, 30 days);
        vm.expectRevert(TrenchersStakeLines.NoStake.selector);
        vault.burnDefaulted(agentId);
        // past due but not yet marked
        vm.warp(pool.getLoan(id).defaultableAt + 1);
        vm.expectRevert(TrenchersStakeLines.NoStake.selector);
        vault.burnDefaulted(agentId);
        // marked, hook burnt it already
        pool.markDefault(id);
        vm.expectRevert(TrenchersStakeLines.NoStake.selector);
        vault.burnDefaulted(agentId);
    }

    /// A default under THIS vault with the hook's burn failing: the stake still burns, via close or burnDefaulted,
    /// even after the agent moved on (the loan's backer is what counts).
    function test_defaultedHere_burnsViaClose_evenIfHookFailedTwoLoans() public {
        uint256 tokens = 80_000 ether;
        stakeOpen(agentId, agentOwner, agentPk, tokens);
        uint256 bad = borrowAs(agentOwner, agentId, 0.03 ether, 10 days);
        uint256 good = borrowAs(agentOwner, agentId, 0.03 ether, 30 days);
        token.setBlockDead(true);
        vm.warp(pool.getLoan(bad).defaultableAt + 1);
        pool.markDefault(bad);
        token.setBlockDead(false);
        repayEth(good); // newer loan, repaid: the scan must still find the older default
        assertEq(uint8(pool.getLoan(good).status), uint8(Pool.LoanStatus.Repaid));
        vm.prank(agentOwner);
        vault.close(agentId);
        assertEq(token.balanceOf(agentOwner), 0);
        assertEq(token.balanceOf(DEAD), tokens);
    }

    function test_room_trackedSeparatelyFromLine() public {
        stakeOpen(agentId, agentOwner, agentPk, 30_000 ether);
        token.mint(agentOwner, 40_000 ether);
        vm.startPrank(agentOwner);
        token.approve(address(vault), 40_000 ether);
        vault.add(agentId, 40_000 ether);
        vm.stopPrank();
        borrowAs(agentOwner, agentId, 0.02 ether, 30 days);
        vm.prank(timelock);
        vault.freeze(agentId, true); // releases the undrawn 0.05: line drops, room does not
        (TrenchersStakeLines.Stake memory s,,,,) = vault.position(agentId);
        assertEq(s.line, 0.02 ether);
        assertEq(s.room, 0.07 ether);
        assertEq(vault.openedThisWeek(), 0.07 ether);
    }
}
