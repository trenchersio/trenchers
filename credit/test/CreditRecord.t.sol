// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseTest} from "./helpers/BaseTest.sol";
import {TrenchersCreditPool as Pool} from "../src/TrenchersCreditPool.sol";
import {CreditRecord} from "../src/CreditRecord.sol";

contract CreditRecordTest is BaseTest {
    uint256 internal backerId;
    address internal backerOwner;
    uint256 internal agentId;
    address internal agentOwner;
    uint256 internal agentPk;

    function setUp() public override {
        super.setUp();
        lend(alice, 10 ether);
        (backerId, backerOwner) = newBacker("backer", 1 ether);
        (agentId, agentOwner, agentPk) = newAgent("agent");
    }

    function _open(uint256 amount) internal {
        openLineAs(backerOwner, backerId, agentId, agentOwner, agentPk, amount, 0);
    }

    function test_score_zeroWhenNotEnrolled() public view {
        assertEq(record.score(agentId), 0);
        assertEq(record.score(999), 0);
        assertEq(record.available(agentId), 0);
    }

    function test_score_lineOnly() public {
        _open(0.1 ether);
        assertEq(record.score(agentId), 50); // 0.1 / 0.002
        _open(0.25 ether);
        assertEq(record.score(agentId), 150); // capped
    }

    function test_score_growsWithEthDaysSeasoningAndAge() public {
        _open(0.1 ether);
        uint256 s0 = record.score(agentId);
        uint256 id = borrowAs(agentOwner, agentId, 0.01 ether, 10 days);
        vm.warp(vm.getBlockTimestamp() + 10 days);
        repayEth(id);
        // eth-days: 0.01 * 10 / 0.002 = 50; seasoned: 20; line: 50; age: 10 days * 2 = 20
        assertEq(record.score(agentId), 50 + 20 + 50 + 20);
        assertGt(record.score(agentId), s0);

        // an unseasoned loan adds eth-days but no count points
        id = borrowAs(agentOwner, agentId, 0.01 ether, 10 days);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        repayEth(id);
        assertEq(record.score(agentId), 60 + 20 + 50 + 24);

        // age alone keeps growing up to its cap
        vm.warp(vm.getBlockTimestamp() + 365 days);
        assertEq(record.score(agentId), 60 + 20 + 50 + 150);
    }

    function test_score_caps() public {
        _open(0.3 ether); // 0.3 / 0.002 = 150
        for (uint256 i; i < 12; i++) {
            uint256 id = borrowAs(agentOwner, agentId, 0.25 ether, 30 days);
            vm.warp(vm.getBlockTimestamp() + 30 days);
            repayEth(id);
        }
        // 500 + 200 + 150 + 150 = 1000
        assertEq(record.score(agentId), 1000);
        CreditRecord.Report memory r = record.report(agentId);
        assertEq(r.score, 1000);
    }

    function test_score_zeroForDefaulted() public {
        _open(0.1 ether);
        uint256 id = borrowAs(agentOwner, agentId, 0.01 ether, 10 days);
        vm.warp(vm.getBlockTimestamp() + 10 days);
        repayEth(id);
        assertGt(record.score(agentId), 0);
        id = borrowAs(agentOwner, agentId, 0.01 ether, 10 days);
        vm.warp(vm.getBlockTimestamp() + 14 days);
        pool.markDefault(id);
        assertEq(record.score(agentId), 0);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        assertEq(record.score(agentId), 0, "for good");
        CreditRecord.Report memory r = record.report(agentId);
        assertTrue(r.defaulted);
        assertEq(r.line, 0);
        assertEq(r.available, 0);
        assertEq(r.score, 0);
    }

    function test_score_backerAndPenalty() public {
        // backing 1 ETH -> 150 (capped)
        assertEq(record.score(backerId), 150);
        vm.warp(vm.getBlockTimestamp() + 10 days);
        assertEq(record.score(backerId), 170);
        _open(0.1 ether);
        uint256 id = borrowAs(agentOwner, agentId, 0.05 ether, 10 days);
        vm.warp(vm.getBlockTimestamp() + 14 days);
        pool.markDefault(id);
        // backing ~0.9495 still caps at 150; age 24 days -> 48; one backed default -> -75
        assertEq(record.score(backerId), 150 + 48 - 75);
    }

    function test_score_penaltyFloorsAtZero() public {
        (uint256 b, address bo) = newBacker("small-backer", 0.01 ether);
        // 0.01 / 0.002 = 5 points; one default wipes it
        (uint256 a, address ao, uint256 apk) = newAgent("small-agent");
        openLineAs(bo, b, a, ao, apk, 0.005 ether, 0);
        uint256 id = borrowAs(ao, a, 0.005 ether, 1 days);
        vm.warp(vm.getBlockTimestamp() + 4 days + 1);
        pool.markDefault(id);
        assertEq(record.score(b), 0);
    }

    function test_available() public {
        assertEq(record.available(backerId), 1 ether);
        _open(0.2 ether);
        assertEq(record.available(agentId), 0.2 ether);
        assertEq(record.available(backerId), 0.8 ether);
        borrowAs(agentOwner, agentId, 0.05 ether, 30 days);
        assertEq(record.available(agentId), 0.15 ether);
        assertEq(record.available(backerId), 0.8 ether - 0.0005 ether);
        vm.prank(backerOwner);
        pool.freezeLine(agentId, true);
        assertEq(record.available(agentId), 0);
    }

    function test_report() public {
        _open(0.2 ether);
        uint256 id = borrowAs(agentOwner, agentId, 0.05 ether, 10 days);
        vm.warp(vm.getBlockTimestamp() + 8 days);
        repayEth(id);
        borrowAs(agentOwner, agentId, 0.02 ether, 10 days);
        CreditRecord.Report memory r = record.report(agentId);
        assertTrue(r.enrolled);
        assertFalse(r.isBacker);
        assertFalse(r.defaulted);
        assertFalse(r.frozen);
        assertEq(r.backer, backerId);
        assertEq(r.line, 0.2 ether);
        assertEq(r.available, 0.18 ether);
        assertEq(r.linesOut, 0);
        assertEq(r.backing, 0);
        assertEq(r.principalOut, 0.02 ether);
        assertEq(r.activeLoans, 1);
        assertEq(r.loansRepaid, 1);
        assertEq(r.volumeRepaid, 0.05 ether);
        assertEq(r.feesPaid, pool.getLoan(id).fee);
        assertEq(r.seasonedRepaid, 1);
        assertEq(r.ethSecondsRepaid, 0.05 ether * 8 days);
        assertEq(r.score, record.score(agentId));

        CreditRecord.Report memory rb = record.report(backerId);
        assertTrue(rb.isBacker);
        assertEq(rb.linesOut, 0.2 ether);
        assertEq(rb.backing, pool.backing(backerId));
        assertEq(rb.available, pool.freeBacking(backerId));
    }

    function test_stats() public {
        _open(0.2 ether);
        uint256 id = borrowAs(agentOwner, agentId, 0.1 ether, 30 days);
        borrowAs(agentOwner, agentId, 0.05 ether, 30 days);
        repayEth(id);
        (uint256 ta, uint256 liq, uint256 lent, uint256 earned, uint256 price, uint256 loans, uint256 toBb) =
            record.stats();
        assertEq(ta, pool.totalAssets());
        assertEq(liq, pool.poolLiquidity());
        assertEq(lent, 0.05 ether);
        assertEq(earned, 0.0005 ether);
        assertEq(price, pool.convertToAssets(1 ether));
        assertGt(price, 1 ether);
        assertEq(loans, 2);
        assertEq(toBb, 0);
        assertEq(address(record.pool()), address(pool));
    }
}
