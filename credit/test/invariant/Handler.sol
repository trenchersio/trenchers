// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {TrenchersCreditPool as Pool} from "../../src/TrenchersCreditPool.sol";
import {TrenchersStakeLines} from "../../src/TrenchersStakeLines.sol";
import {MockWETH} from "../mocks/MockWETH.sol";
import {MockToken} from "../mocks/MockToken.sol";
import {MockAgentRegistry} from "../mocks/MockAgentRegistry.sol";

/// @notice Drives the pool with random lenders, stake-line agents, vault backers (funding, asking to leave, leaving),
///         a plain EOA backer, borrows, repays, time, and defaults. Tracks every agent it creates and every loan it opens.
contract Handler is Test {
    Pool public pool;
    TrenchersStakeLines public vault;
    MockWETH public weth;
    MockToken public token;
    MockAgentRegistry public registry;

    address[] public lenders;
    address[] public backers; // vault backers
    uint256 public funded;
    uint256 public exited;
    uint256 public exitsDone;
    uint256[] public agents;
    mapping(uint256 => address) public ownerOfAgent;
    mapping(uint256 => uint256) public pkOf;
    uint256[] public openLoans;

    uint256 public eoaBacker;
    address public eoaBackerOwner;

    // ghost
    uint256 public lastPrice;
    bool public priceFell;
    uint256 public priceFellAt; // which call
    uint256 public calls;
    mapping(bytes32 => uint256) public count;

    uint256 public defaults;
    uint256 internal nonce;

    constructor(Pool pool_, TrenchersStakeLines vault_, MockWETH weth_, MockToken token_, MockAgentRegistry registry_) {
        pool = pool_;
        vault = vault_;
        weth = weth_;
        token = token_;
        registry = registry_;
        for (uint256 i; i < 4; i++) lenders.push(makeAddr(string(abi.encodePacked("lender", vm.toString(i)))));
        for (uint256 i; i < 3; i++) backers.push(makeAddr(string(abi.encodePacked("backer", vm.toString(i)))));
        backers.push(makeAddr("funder")); // the one BaseTest funds the vault with
        lastPrice = pool.convertToAssets(1e18);

        // a plain EOA-owned backer that lends with a premium
        eoaBackerOwner = makeAddr("eoa-backer");
        vm.prank(eoaBackerOwner);
        eoaBacker = registry.register("eoa-backer");
        vm.deal(eoaBackerOwner, 2 ether);
        vm.prank(eoaBackerOwner);
        pool.registerBacker{value: 2 ether}(eoaBacker, 2 ether);
    }

    modifier tracked(bytes32 name) {
        calls++;
        count[name]++;
        _;
        uint256 p = pool.convertToAssets(1e18);
        if (p < lastPrice) {
            priceFell = true;
            priceFellAt = calls;
        }
        lastPrice = p;
    }

    function _now() internal view returns (uint256) {
        return vm.getBlockTimestamp();
    }

    function agentCount() external view returns (uint256) {
        return agents.length;
    }

    function openLoanCount() external view returns (uint256) {
        return openLoans.length;
    }

    function _removeLoan(uint256 i) internal {
        openLoans[i] = openLoans[openLoans.length - 1];
        openLoans.pop();
    }

    // ------------------------------------------------------------------ lenders

    function deposit(uint256 who, uint256 amount, bool viaWeth) external tracked("deposit") {
        address l = lenders[who % lenders.length];
        amount = _bound(amount, 1 gwei, 5 ether);
        vm.deal(l, l.balance + amount);
        vm.startPrank(l);
        if (viaWeth) {
            weth.deposit{value: amount}();
            weth.approve(address(pool), amount);
            pool.deposit(amount, l, 0);
        } else {
            pool.deposit{value: amount}(amount, l, 0);
        }
        vm.stopPrank();
    }

    function withdraw(uint256 who, uint256 frac, bool asEth) external tracked("withdraw") {
        address l = lenders[who % lenders.length];
        uint256 s = pool.shares(l) * _bound(frac, 1, 100) / 100;
        if (s == 0) return;
        vm.prank(l);
        pool.withdraw(s, l, asEth);
    }

    // ------------------------------------------------------------------ agents and lines

    function newStakeAgent(uint256 tokens) external tracked("newStakeAgent") {
        tokens = _bound(tokens, 1_000 ether, 200_000 ether);
        string memory label = string(abi.encodePacked("agent", vm.toString(nonce++)));
        (address o, uint256 pk) = makeAddrAndKey(label);
        vm.prank(o);
        uint256 id = registry.register(label);
        token.mint(o, tokens);
        Pool.Consent memory c = Pool.Consent({
            agentId: id,
            backerId: vault.backerId(),
            owner: o,
            maxPremiumBps: 0,
            nonce: pool.nonces(id),
            deadline: _now() + 1 days
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, pool.consentDigest(c));
        vm.startPrank(o);
        token.approve(address(vault), tokens);
        try vault.open(id, tokens, c, abi.encodePacked(r, s, v)) {
            agents.push(id);
            ownerOfAgent[id] = o;
            pkOf[id] = pk;
        } catch {}
        vm.stopPrank();
    }

    function newEoaLine(uint256 amount, uint256 premium) external tracked("newEoaLine") {
        amount = _bound(amount, 0.001 ether, 0.3 ether);
        premium = _bound(premium, 0, 200);
        string memory label = string(abi.encodePacked("eoa-agent", vm.toString(nonce++)));
        (address o, uint256 pk) = makeAddrAndKey(label);
        vm.prank(o);
        uint256 id = registry.register(label);
        Pool.Consent memory c = Pool.Consent({
            agentId: id,
            backerId: eoaBacker,
            owner: o,
            maxPremiumBps: premium,
            nonce: 0,
            deadline: _now() + 1 days
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, pool.consentDigest(c));
        vm.prank(eoaBackerOwner);
        try pool.openLine(eoaBacker, id, amount, premium, c, abi.encodePacked(r, s, v)) {
            agents.push(id);
            ownerOfAgent[id] = o;
            pkOf[id] = pk;
        } catch {}
    }

    // ------------------------------------------------------------------ vault backers

    function backerCount() external view returns (uint256) {
        return backers.length;
    }

    function fundVault(uint256 who, uint256 amount) external tracked("fundVault") {
        address f = backers[who % backers.length];
        amount = _bound(amount, 0.01 ether, 1 ether);
        vm.deal(f, f.balance + amount);
        vm.prank(f);
        vault.fund{value: amount}();
        funded += amount;
    }

    function requestExit(uint256 who, uint256 frac) external tracked("requestExit") {
        address b = backers[who % backers.length];
        (uint256 pending,) = vault.exits(b);
        uint256 room = vault.sharesOf(b) - pending;
        uint256 s = room * _bound(frac, 1, 100) / 100;
        if (s == 0) return;
        vm.prank(b);
        vault.requestExit(s);
    }

    function cancelExit(uint256 who) external tracked("cancelExit") {
        address b = backers[who % backers.length];
        (uint256 pending,) = vault.exits(b);
        if (pending == 0) return;
        vm.prank(b);
        vault.cancelExit();
    }

    function exitVault(uint256 who, uint256 frac) external tracked("exitVault") {
        address b = backers[who % backers.length];
        (uint256 pending, uint64 readyAt) = vault.exits(b);
        if (pending == 0) return;
        if (_now() < readyAt) vm.warp(readyAt); // wait out the notice (loans keep running meanwhile)
        uint256 s = pending * _bound(frac, 1, 100) / 100;
        if (s == 0) return;
        vm.prank(b);
        // may wait for backing standing behind open lines, or for lent-out liquidity
        try vault.exit(s, b) returns (uint256 assets) {
            exited += assets;
            exitsDone++;
        } catch {
            // take the free part now, the rest later
            uint256 bs = pool.backing(vault.backerId());
            if (bs == 0) return;
            s = vault.totalShares() * pool.freeBacking(vault.backerId()) / bs * 99 / 100;
            if (s > pending) s = pending;
            if (s == 0) return;
            vm.prank(b);
            try vault.exit(s, b) returns (uint256 assets) {
                exited += assets;
                exitsDone++;
            } catch {}
        }
    }

    function addStake(uint256 agentSeed, uint256 tokens) external tracked("addStake") {
        if (agents.length == 0) return;
        uint256 id = agents[agentSeed % agents.length];
        address o = ownerOfAgent[id];
        tokens = _bound(tokens, 1, 100_000 ether);
        token.mint(o, tokens);
        vm.startPrank(o);
        token.approve(address(vault), tokens);
        try vault.add(id, tokens) {} catch {}
        vm.stopPrank();
    }

    function closeStake(uint256 agentSeed) external tracked("closeStake") {
        if (agents.length == 0) return;
        uint256 id = agents[agentSeed % agents.length];
        vm.prank(ownerOfAgent[id]);
        try vault.close(id) {} catch {}
    }

    // ------------------------------------------------------------------ loans

    function borrow(uint256 agentSeed, uint256 amount, uint64 term, bool asEth) external tracked("borrow") {
        if (agents.length == 0) return;
        uint256 id = agents[agentSeed % agents.length];
        Pool.Agent memory a = pool.getAgent(id);
        if (a.backer == 0 || a.defaulted || a.frozen || a.line <= a.principalOut) return;
        uint256 avail = a.line - a.principalOut;
        if (avail < 0.001 ether) return;
        amount = _bound(amount, 0.001 ether, avail > 0.25 ether ? 0.25 ether : avail);
        term = uint64(bound(term, 1 days, 30 days));
        address o = ownerOfAgent[id];
        vm.prank(o);
        try pool.borrow(id, amount, term, o, type(uint256).max, asEth) returns (uint256 loanId) {
            openLoans.push(loanId);
        } catch {}
    }

    function repay(uint256 loanSeed, bool viaWeth) external tracked("repay") {
        if (openLoans.length == 0) return;
        uint256 i = loanSeed % openLoans.length;
        uint256 loanId = openLoans[i];
        Pool.Loan memory l = pool.getLoan(loanId);
        uint256 due = l.principal + l.fee;
        address payer = makeAddr("payer");
        vm.deal(payer, payer.balance + due);
        vm.startPrank(payer);
        if (viaWeth) {
            weth.deposit{value: due}();
            weth.approve(address(pool), due);
            pool.repay(loanId, l.agentId, due);
        } else {
            pool.repay{value: due}(loanId, l.agentId, due);
        }
        vm.stopPrank();
        _removeLoan(i);
    }

    function markDefault(uint256 loanSeed) external tracked("markDefault") {
        if (openLoans.length == 0) return;
        // default the first loan that is past its grace, starting at a random place
        uint256 n = openLoans.length;
        for (uint256 k; k < n; k++) {
            uint256 i = (loanSeed % n + k) % n;
            uint256 loanId = openLoans[i];
            if (_now() > pool.getLoan(loanId).defaultableAt) {
                vm.prank(makeAddr("keeper"));
                pool.markDefault(loanId);
                _removeLoan(i);
                defaults++;
                return;
            }
        }
    }

    /// Lets a loan run out: jumps past its grace and marks it defaulted.
    function letDefault(uint256 loanSeed) external tracked("letDefault") {
        if (openLoans.length == 0) return;
        uint256 i = loanSeed % openLoans.length;
        uint256 loanId = openLoans[i];
        uint64 at = pool.getLoan(loanId).defaultableAt;
        if (_now() <= at) vm.warp(uint256(at) + 1);
        vm.prank(makeAddr("keeper"));
        pool.markDefault(loanId);
        _removeLoan(i);
        defaults++;
    }

    function warp(uint256 secs) external tracked("warp") {
        secs = _bound(secs, 1 hours, 20 days);
        vm.warp(_now() + secs);
    }

    function harvest() external tracked("harvest") {
        if (pool.backerFees(vault.backerId()) == 0) return;
        vault.harvest();
    }

    function buyback() external tracked("buyback") {
        if (pool.reserve() <= pool.RESERVE_FLOOR()) return;
        pool.reserveToBuyback();
    }

    function claimEoaFees() external tracked("claimEoaFees") {
        if (pool.backerFees(eoaBacker) == 0) return;
        vm.prank(eoaBackerOwner);
        pool.claimBackerFees(eoaBacker, eoaBackerOwner, true);
    }
}
