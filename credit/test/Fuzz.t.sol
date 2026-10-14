// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseTest} from "./helpers/BaseTest.sol";
import {TrenchersCreditPool as Pool} from "../src/TrenchersCreditPool.sol";

contract PoolFuzzTest is BaseTest {
    uint256 internal backerId;
    address internal backerOwner;
    uint256 internal agentId;
    address internal agentOwner;
    uint256 internal agentPk;

    function setUp() public override {
        super.setUp();
        lend(alice, 10 ether);
        (backerId, backerOwner) = newBacker("backer", 2 ether);
        (agentId, agentOwner, agentPk) = newAgent("agent");
    }

    function _setSplit(uint256 feeBps, uint256 backerBps, uint256 reserveBps) internal {
        Pool.Params memory p = defaultParams();
        p.feeBps = feeBps;
        p.backerFeeBps = backerBps;
        p.reserveFeeBps = reserveBps;
        vm.prank(timelock);
        pool.setParams(p);
    }

    /// The quote's pieces always add up, the split never takes more than the base fee, and it is bounded.
    function testFuzz_quoteFee(uint256 principal, uint64 term, uint256 premiumBps, uint256 feeBps, uint256 backerBps, uint256 reserveBps)
        public
    {
        principal = bound(principal, 0.001 ether, 0.25 ether);
        term = uint64(bound(term, 1 days, 30 days));
        premiumBps = bound(premiumBps, 0, 200);
        feeBps = bound(feeBps, 0, 500);
        backerBps = bound(backerBps, 0, 10_000);
        reserveBps = bound(reserveBps, 0, 10_000 - backerBps);
        _setSplit(feeBps, backerBps, reserveBps);
        openLineAs(backerOwner, backerId, agentId, agentOwner, agentPk, 0, premiumBps);

        (uint256 fee, uint256 bc, uint256 rc, uint256 prem) = pool.quoteFee(agentId, principal, term);
        uint256 base = principal * feeBps * term / (10_000 * 30 days);
        assertEq(fee, base + prem);
        assertEq(prem, principal * premiumBps * term / (10_000 * 30 days));
        assertLe(bc + rc, base);
        assertEq(bc, base * backerBps / 10_000);
        assertEq(rc, base * reserveBps / 10_000);
        // at most 7% of principal per 30 days
        assertLe(fee, principal * 700 * term / (10_000 * 30 days));
    }

    /// A repaid loan splits its fee exactly, the books stay whole, and the share price does not fall.
    function testFuzz_repaySplit(
        uint256 principal,
        uint64 term,
        uint256 premiumBps,
        uint256 feeBps,
        uint256 backerBps,
        uint256 reserveBps,
        uint256 heldFor,
        bool viaWeth
    ) public {
        principal = bound(principal, 0.001 ether, 0.25 ether);
        term = uint64(bound(term, 1 days, 30 days));
        premiumBps = bound(premiumBps, 0, 200);
        feeBps = bound(feeBps, 0, 500);
        backerBps = bound(backerBps, 0, 10_000);
        reserveBps = bound(reserveBps, 0, 10_000 - backerBps);
        heldFor = bound(heldFor, 0, uint256(term) + 3 days);
        _setSplit(feeBps, backerBps, reserveBps);
        openLineAs(backerOwner, backerId, agentId, agentOwner, agentPk, 0.25 ether, premiumBps);

        uint256 id = borrowAs(agentOwner, agentId, principal, term);
        Pool.Loan memory l = pool.getLoan(id);
        vm.warp(vm.getBlockTimestamp() + heldFor);

        uint256 liq = pool.poolLiquidity();
        uint256 res = pool.reserve();
        uint256 bf = pool.backerFees(backerId);
        uint256 price = sharePrice();
        uint256 due = l.principal + l.fee;
        vm.deal(bob, due);
        vm.startPrank(bob);
        if (viaWeth) {
            weth.deposit{value: due}();
            weth.approve(address(pool), due);
            pool.repay(id, agentId, due);
        } else {
            pool.repay{value: due}(id, agentId, due);
        }
        vm.stopPrank();

        uint256 toLenders = pool.poolLiquidity() - liq - principal;
        uint256 toBacker = pool.backerFees(backerId) - bf;
        uint256 toReserve = pool.reserve() - res;
        assertEq(toLenders + toBacker + toReserve, l.fee, "split adds up");
        assertEq(toBacker, l.backerCut + l.premium);
        assertEq(toReserve, l.reserveCut);
        assertGe(sharePrice(), price);
        assertTrue(wethSolvent());
        assertEq(pool.feeLocked(backerId), 0);
        Pool.Agent memory a = pool.getAgent(agentId);
        uint256 held = heldFor > term ? term : heldFor;
        assertEq(a.ethSecondsRepaid, principal * held);
        assertEq(a.seasonedRepaid, held >= 7 days ? 1 : 0);
    }

    /// Deposit then withdraw (after the hold) never returns more than went in, and loses at most rounding.
    function testFuzz_depositWithdrawRoundTrip(uint256 amount, uint256 priorFees, bool asEth) public {
        amount = bound(amount, 1 gwei, 1_000 ether);
        priorFees = bound(priorFees, 0, 20);
        // move the share price off 1:1 with some repaid loans
        if (priorFees > 0) {
            openLineAs(backerOwner, backerId, agentId, agentOwner, agentPk, 0.25 ether, 200);
            for (uint256 i; i < priorFees; i++) {
                uint256 id = borrowAs(agentOwner, agentId, 0.25 ether, 30 days);
                repayEth(id);
            }
        }
        uint256 price = sharePrice();
        vm.deal(bob, amount);
        vm.prank(bob);
        uint256 minted = pool.deposit{value: amount}(amount, bob, 0);
        assertGe(sharePrice(), price);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        uint256 price2 = sharePrice();
        vm.prank(bob);
        uint256 out = pool.withdraw(minted, bob, asEth);
        assertLe(out, amount, "never more than went in");
        // lose at most a couple of wei per share-price unit of rounding
        assertGe(out + price2 / 1e18 + 2, amount);
        assertGe(sharePrice(), price2);
        assertTrue(wethSolvent());
        if (asEth) assertEq(bob.balance, out);
        else assertEq(weth.balanceOf(bob), out);
    }

    /// Within the hold the exit fee is exactly 0.5% and stays with the lenders.
    function testFuzz_earlyExit(uint256 amount, uint256 wait) public {
        amount = bound(amount, 0.001 ether, 1_000 ether);
        wait = bound(wait, 0, 7 days - 1);
        vm.deal(bob, amount);
        vm.prank(bob);
        uint256 minted = pool.deposit{value: amount}(amount, bob, 0);
        vm.warp(vm.getBlockTimestamp() + wait);
        uint256 assets = pool.convertToAssets(minted);
        uint256 price = sharePrice();
        vm.prank(bob);
        uint256 out = pool.withdraw(minted, bob, true);
        assertEq(out, assets - assets * 50 / 10_000);
        assertGe(sharePrice(), price);
    }

    /// Many deposits and partial withdrawals by different people never lower the share price.
    function testFuzz_manyLenders(uint256[6] memory amounts, uint256[6] memory fracs) public {
        address[3] memory who = [alice, bob, makeAddr("carol")];
        uint256 price = sharePrice();
        for (uint256 i; i < 6; i++) {
            uint256 a = bound(amounts[i], 1 gwei, 100 ether);
            lend(who[i % 3], a);
            assertGe(sharePrice(), price);
            price = sharePrice();
            vm.warp(vm.getBlockTimestamp() + 1 days);
            uint256 s = pool.shares(who[(i + 1) % 3]) * bound(fracs[i], 0, 100) / 100;
            if (s > 0) {
                vm.prank(who[(i + 1) % 3]);
                pool.withdraw(s, who[(i + 1) % 3], i % 2 == 0);
            }
            assertGe(sharePrice(), price);
            price = sharePrice();
        }
        assertTrue(wethSolvent());
    }

    /// A default never lowers the share price, whatever the loan.
    function testFuzz_defaultKeepsPrice(uint256 principal, uint64 term, uint256 premiumBps, uint256 backing, uint256 extra)
        public
    {
        principal = bound(principal, 0.001 ether, 0.25 ether);
        term = uint64(bound(term, 1 days, 30 days));
        premiumBps = bound(premiumBps, 0, 200);
        uint256 fee = principal * (100 + premiumBps) * term / (10_000 * 30 days);
        backing = bound(backing, principal + fee + 1, principal + fee + 1 ether);
        backing = backing < 0.01 ether ? 0.01 ether : backing;
        (uint256 b, address bo) = newBacker("fz-backer", backing);
        (uint256 ag, address ao, uint256 apk) = newAgent("fz-agent");
        openLineAs(bo, b, ag, ao, apk, principal, premiumBps);
        // some unrelated activity first so the price is not 1:1
        extra = bound(extra, 0, 5);
        openLineAs(backerOwner, backerId, agentId, agentOwner, agentPk, 0.25 ether, 0);
        for (uint256 i; i < extra; i++) repayEth(borrowAs(agentOwner, agentId, 0.25 ether, 30 days));

        uint256 id = borrowAs(ao, ag, principal, term);
        vm.warp(pool.getLoan(id).defaultableAt + 1);
        uint256 price = sharePrice();
        uint256 aliceValue = pool.convertToAssets(pool.shares(alice));
        pool.markDefault(id);
        assertGe(sharePrice(), price);
        assertGe(pool.convertToAssets(pool.shares(alice)), aliceValue);
        assertEq(pool.totalBadDebt(), 0);
        assertTrue(wethSolvent());
    }

    /// A backer used to the last wei, with several loans that all default one after another: its shares always
    /// cover principal + fee (no reserve top-up, no bad debt), and the share price never falls.
    function testFuzz_fullyUsedBacker_sequentialDefaults(uint256[4] memory principals, uint64 term, uint256 premiumBps, uint256 warmup)
        public
    {
        term = uint64(bound(term, 1 days, 30 days));
        premiumBps = bound(premiumBps, 0, 200);
        warmup = bound(warmup, 0, 4);
        openLineAs(backerOwner, backerId, agentId, agentOwner, agentPk, 0.25 ether, 37);
        for (uint256 i; i < warmup; i++) repayEth(borrowAs(agentOwner, agentId, 0.25 ether - i * 1 gwei, 29 days));

        uint256 total;
        uint256[4] memory p;
        for (uint256 i; i < 4; i++) {
            p[i] = bound(principals[i], 0.001 ether, 0.25 ether);
            total += p[i];
        }
        (uint256 b, address bo) = newBacker("tight", 0.01 ether);
        (uint256 ag, address ao, uint256 apk) = newAgent("tight-agent");
        openLineAs(bo, b, ag, ao, apk, 0, premiumBps);
        uint256 fees;
        for (uint256 i; i < 4; i++) {
            (uint256 f,,,) = pool.quoteFee(ag, p[i], term);
            fees += f;
        }
        // top up so free backing is exactly lines + fees (to rounding)
        uint256 need = total + fees;
        uint256 have = pool.backing(b);
        if (need > have) {
            vm.deal(bo, need - have + 2);
            vm.prank(bo);
            pool.addBacking{value: need - have + 2}(b, need - have + 2);
        }
        vm.warp(vm.getBlockTimestamp() + 7 days); // so the unlock below pays no exit fee
        vm.prank(bo);
        pool.raiseLine(b, ag, total);
        uint256[4] memory ids;
        for (uint256 i; i < 4; i++) ids[i] = borrowAs(ao, ag, p[i], term);
        // take out everything free so the backer is used to the last unit
        uint256 sh = pool.convertToShares(pool.freeBacking(b));
        for (uint256 k; k < 4 && sh > 0; k++) {
            vm.prank(bo);
            try pool.unlockBacking(b, sh, bo, true) {
                break;
            } catch {
                sh--;
            }
        }
        assertLe(pool.freeBacking(b), 2);

        vm.warp(pool.getLoan(ids[0]).defaultableAt + 1);
        uint256 reserveBefore = pool.reserve();
        for (uint256 i; i < 4; i++) {
            uint256 price = sharePrice();
            pool.markDefault(ids[i]);
            assertGe(sharePrice(), price);
        }
        assertEq(pool.totalBadDebt(), 0);
        assertEq(pool.reserve(), reserveBefore, "no reserve top-up was needed");
        assertTrue(wethSolvent());
        assertEq(pool.getAgent(b).linesOut, 0);
        assertEq(pool.feeLocked(b), 0);
    }
}
