// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TrenchersCreditPool as Pool} from "./TrenchersCreditPool.sol";

/// @title CreditRecord
/// @notice Read-only views over the Trenchers Credit pool: an agent's record and its credit score.
///
///         The score runs from 0 to 1000 and is a pure function of the on-chain record, so anyone can rebuild it
///         from the pool's events. Every point costs real ETH held for real time:
///           - ETH-days repaid (principal x days held, capped at the term)   up to 500 (1 per 0.002 ETH-day)
///           - seasoned loans repaid (held 7 days or more)                    up to 200 (20 each)
///           - backing at risk for it (its line, or a backer's own backing)   up to 150 (1 per 0.002 ETH)
///           - time since its first line                                      up to 150 (2 per day)
///           - each loan it backed that defaulted                             -75
///           - its own default                                                0, for good
contract CreditRecord {
    Pool public immutable pool;

    uint256 internal constant UNIT = 0.002 ether;

    struct Report {
        bool enrolled;
        bool isBacker;
        bool defaulted;
        bool frozen;
        uint256 backer;
        uint256 line;
        uint256 available;
        uint256 linesOut;
        uint256 backing;
        uint256 principalOut;
        uint256 activeLoans;
        uint256 loansRepaid;
        uint256 volumeRepaid;
        uint256 feesPaid;
        uint256 backedDefaults;
        uint256 seasonedRepaid;
        uint256 ethSecondsRepaid;
        uint64 enrolledAt;
        uint256 score;
    }

    constructor(Pool pool_) {
        pool = pool_;
    }

    /// @notice What the agent can borrow right now (a backer: its free backing).
    function available(uint256 id) public view returns (uint256) {
        Pool.Agent memory a = pool.getAgent(id);
        if (a.isBacker) return pool.freeBacking(id);
        if (a.defaulted || a.frozen || a.backer == 0) return 0;
        return a.line > a.principalOut ? a.line - a.principalOut : 0;
    }

    function score(uint256 id) public view returns (uint256) {
        return _score(id, pool.getAgent(id));
    }

    function _score(uint256 id, Pool.Agent memory a) internal view returns (uint256) {
        if (a.enrolledAt == 0 || a.defaulted) return 0;
        uint256 timePts = _min(500, a.ethSecondsRepaid / 1 days / UNIT);
        uint256 countPts = _min(200, a.seasonedRepaid * 20);
        uint256 atRisk = a.isBacker ? pool.backing(id) : a.line;
        uint256 backingPts = _min(150, atRisk / UNIT);
        uint256 agePts = _min(150, ((block.timestamp - a.enrolledAt) / 1 days) * 2);
        uint256 positive = timePts + countPts + backingPts + agePts;
        uint256 penalty = a.backedDefaults * 75;
        if (penalty >= positive) return 0;
        uint256 s = positive - penalty;
        return s > 1000 ? 1000 : s;
    }

    function report(uint256 id) external view returns (Report memory r) {
        Pool.Agent memory a = pool.getAgent(id);
        r.enrolled = a.enrolledAt != 0;
        r.isBacker = a.isBacker;
        r.defaulted = a.defaulted;
        r.frozen = a.frozen;
        r.backer = a.backer;
        r.line = a.defaulted ? 0 : a.line;
        r.available = available(id);
        r.linesOut = a.linesOut;
        r.backing = a.isBacker ? pool.backing(id) : 0;
        r.principalOut = a.principalOut;
        r.activeLoans = a.activeLoans;
        r.loansRepaid = a.loansRepaid;
        r.volumeRepaid = a.volumeRepaid;
        r.feesPaid = a.feesPaid;
        r.backedDefaults = a.backedDefaults;
        r.seasonedRepaid = a.seasonedRepaid;
        r.ethSecondsRepaid = a.ethSecondsRepaid;
        r.enrolledAt = a.enrolledAt;
        r.score = _score(id, a);
    }

    /// @notice The pool at a glance, for the site.
    function stats()
        external
        view
        returns (uint256 totalAssets, uint256 liquidity, uint256 lent, uint256 lendersEarned, uint256 sharePrice, uint256 loans, uint256 toBuyback)
    {
        totalAssets = pool.totalAssets();
        liquidity = pool.poolLiquidity();
        lent = pool.totalPrincipalOut();
        lendersEarned = pool.totalFeesEarned();
        sharePrice = pool.convertToAssets(1 ether);
        loans = pool.loanCount();
        toBuyback = pool.totalToBuyback();
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
