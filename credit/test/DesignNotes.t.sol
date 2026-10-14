// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseTest} from "./helpers/BaseTest.sol";
import {TrenchersCreditPool as Pool} from "../src/TrenchersCreditPool.sol";
import {TrenchersStakeLines} from "../src/TrenchersStakeLines.sol";

/// @notice Pins down design notes: `test_fixed_*` show earlier weaknesses now closed; `test_note_*` pass today and
///         show behaviour that is still open (flip them when it is fixed).
contract DesignNotesTest is BaseTest {
    function setUp() public override {
        super.setUp();
        lend(alice, 10 ether);
        fundVault(1 ether);
    }

    /// Fixed: closing in the same week gives the room back, so open/close cycles no longer block the week.
    function test_fixed_openCloseCyclesNoLongerBlockTheWeek() public {
        (uint256 id, address o, uint256 pk) = newAgent("griefer");
        token.mint(o, 100_000 ether);
        vm.startPrank(o);
        token.approve(address(vault), type(uint256).max);
        for (uint256 i; i < 5; i++) {
            Pool.Consent memory c = consentFor(id, vault.backerId(), o, 0, vm.getBlockTimestamp() + 1);
            vault.open(id, 100_000 ether, c, sign(c, pk));
            vault.close(id);
        }
        vm.stopPrank();
        assertEq(vault.weeklyRoom(), WEEKLY_CAP);
        (uint256 id2, address o2, uint256 pk2) = newAgent("honest");
        stakeOpen(id2, o2, pk2, 1_000 ether);
    }

    /// Fixed: the room a stake used is kept in `s.room`, which the pool's callbacks never touch, so leaving the
    /// line in the pool before `close` still refunds it.
    function test_fixed_leaveLineBeforeCloseRefundsTheRoom() public {
        (uint256 id, address o, uint256 pk) = newAgent("griefer");
        token.mint(o, 100_000 ether);
        vm.startPrank(o);
        token.approve(address(vault), type(uint256).max);
        for (uint256 i; i < 5; i++) {
            Pool.Consent memory c = consentFor(id, vault.backerId(), o, 0, vm.getBlockTimestamp() + 1);
            vault.open(id, 100_000 ether, c, sign(c, pk));
            pool.leaveLine(id);
            (TrenchersStakeLines.Stake memory st,,,,) = vault.position(id);
            assertEq(st.line, 0, "the pool's release zeroed the line");
            assertEq(st.room, 0.1 ether, "but not the room");
            vault.close(id);
        }
        vm.stopPrank();
        assertEq(token.balanceOf(o), 100_000 ether);
        assertEq(vault.openedThisWeek(), 0);
        assertEq(vault.weeklyRoom(), WEEKLY_CAP, "the week is not blocked");
        (uint256 id2, address o2, uint256 pk2) = newAgent("honest");
        stakeOpen(id2, o2, pk2, 100_000 ether);
    }

    /// Fixed: backing now has the lenders' 7-day clock, so the backer route pays the same 0.5% early-exit fee.
    function test_fixed_backerPathPaysEarlyExitFee() public {
        (uint256 b, address bo,) = newAgent("jit");
        vm.deal(bo, 5 ether);
        vm.prank(bo);
        pool.registerBacker{value: 5 ether}(b, 5 ether);
        uint256 s = pool.backerShares(b);
        uint256 price = pool.convertToAssets(1e18);
        vm.prank(bo);
        uint256 out = pool.unlockBacking(b, s, bo, true);
        assertEq(out, 5 ether - 0.025 ether, "same 0.5% as a lender");
        assertGt(pool.convertToAssets(1e18), price);

        uint256 minted = lend(bob, 5 ether);
        vm.prank(bob);
        assertEq(pool.withdraw(minted, bob, true), 5 ether - 0.025 ether);
    }

    /// Fixed: a default on another backer's loan does not burn this vault's stake; the staker gets it back.
    function test_fixed_defaultUnderAnotherBackerDoesNotBurnStake() public {
        (uint256 id, address o, uint256 pk) = newAgent("mover");
        token.mint(o, 50_000 ether);
        Pool.Consent memory c = consentFor(id, vault.backerId(), o, 0, vm.getBlockTimestamp() + 1);
        bytes memory sig = sign(c, pk);
        vm.startPrank(o);
        token.approve(address(vault), 50_000 ether);
        vault.open(id, 50_000 ether, c, sig);
        vm.stopPrank();
        // the owner moves the agent to another backer and defaults there
        (uint256 b2, address b2o) = newBacker("other-backer", 1 ether);
        openLineAs(b2o, b2, id, o, pk, 0.05 ether, 0);
        uint256 loanId = borrowAs(o, id, 0.05 ether, 30 days);
        uint256 vaultBacking = pool.backing(vault.backerId());
        vm.warp(pool.getLoan(loanId).defaultableAt + 1);
        pool.markDefault(loanId);
        assertTrue(pool.getAgent(id).defaulted);
        assertGe(pool.backing(vault.backerId()), vaultBacking, "the vault lost nothing");
        // nobody can burn it
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(TrenchersStakeLines.NoStake.selector);
        vault.burnDefaulted(id);
        // the staker closes and gets it back
        vm.prank(o);
        vault.close(id);
        assertEq(token.balanceOf(o), 50_000 ether);
        assertEq(token.balanceOf(0x000000000000000000000000000000000000dEaD), 0);
        assertEq(vault.totalBurnt(), 0);
        assertEq(vault.totalStaked(), 0);
    }

    /// The vault-backed loan defaulted under an EARLIER stake would not count against a new one; but a defaulted
    /// agent cannot get a new line at all, so that case cannot arise. A repaid vault loan plus a default elsewhere
    /// does not burn either.
    function test_fixed_repaidHereDefaultedElsewhereDoesNotBurn() public {
        (uint256 id, address o, uint256 pk) = newAgent("mixed");
        token.mint(o, 50_000 ether);
        Pool.Consent memory c = consentFor(id, vault.backerId(), o, 0, vm.getBlockTimestamp() + 1);
        bytes memory sig = sign(c, pk);
        vm.startPrank(o);
        token.approve(address(vault), 50_000 ether);
        vault.open(id, 50_000 ether, c, sig);
        vm.stopPrank();
        repayEth(borrowAs(o, id, 0.05 ether, 30 days)); // a vault loan, repaid
        (uint256 b2, address b2o) = newBacker("other-backer", 1 ether);
        openLineAs(b2o, b2, id, o, pk, 0.05 ether, 0);
        uint256 loanId = borrowAs(o, id, 0.05 ether, 30 days);
        vm.warp(pool.getLoan(loanId).defaultableAt + 1);
        pool.markDefault(loanId);
        vm.expectRevert(TrenchersStakeLines.NoStake.selector);
        vault.burnDefaulted(id);
        vm.prank(o);
        vault.close(id);
        assertEq(token.balanceOf(o), 50_000 ether);
    }

    /// Every loan is backed one for one by backers' shares, so lenders' own money is never what is lent out: pool
    /// liquidity always covers every lender's full balance. (The InsufficientLiquidity checks are defensive.)
    function test_note_lendersAlwaysFullyLiquid() public {
        (uint256 a, address o, uint256 pk) = newAgent("borrower");
        token.mint(o, 100_000 ether);
        Pool.Consent memory c = consentFor(a, vault.backerId(), o, 0, vm.getBlockTimestamp() + 1);
        bytes memory sig = sign(c, pk);
        vm.startPrank(o);
        token.approve(address(vault), 100_000 ether);
        vault.open(a, 100_000 ether, c, sig);
        pool.borrow(a, 0.1 ether, 30 days, o, type(uint256).max, true);
        vm.stopPrank();
        uint256 lenderValue = pool.convertToAssets(pool.shares(alice));
        assertGe(pool.poolLiquidity(), lenderValue + pool.freeBacking(vault.backerId()));
    }
}
