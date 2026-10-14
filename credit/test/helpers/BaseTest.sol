// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {TrenchersCreditPool as Pool} from "../../src/TrenchersCreditPool.sol";
import {CreditRecord} from "../../src/CreditRecord.sol";
import {TrenchersStakeLines} from "../../src/TrenchersStakeLines.sol";
import {IAgentRegistry, IWETH} from "../../src/interfaces/ICreditDeps.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockWETH} from "../mocks/MockWETH.sol";
import {MockToken} from "../mocks/MockToken.sol";
import {MockAgentRegistry} from "../mocks/MockAgentRegistry.sol";

abstract contract BaseTest is Test {
    MockWETH internal weth;
    MockAgentRegistry internal registry;
    MockToken internal token;
    Pool internal pool;
    CreditRecord internal record;
    TrenchersStakeLines internal vault;

    address internal timelock = makeAddr("timelock");
    address internal guardian = makeAddr("guardian");
    address internal buyback = makeAddr("buyback");
    address internal keeper = makeAddr("keeper");
    address internal alice = makeAddr("alice"); // lender
    address internal bob = makeAddr("bob"); // lender

    uint256 internal constant TOKENS_PER_ETH = 1_000_000 ether; // 1M $TRENCHERS per 1 ETH of line
    uint256 internal constant MAX_LINE = 0.1 ether;
    uint64 internal constant VAULT_MAX_TERM = 30 days;
    uint256 internal constant WEEKLY_CAP = 0.5 ether;

    uint256 internal constant SEED = 0.0001 ether;

    function defaultParams() internal pure returns (Pool.Params memory p) {
        p = Pool.Params({
            minLoan: 0.001 ether,
            maxLoan: 0.25 ether,
            minTerm: 1 days,
            maxTerm: 30 days,
            grace: 3 days,
            minScoreTerm: 7 days,
            feeBps: 100,
            backerFeeBps: 2500,
            reserveFeeBps: 2500,
            minBacking: 0.01 ether,
            maxUtilizationBps: 10_000,
            keeperBounty: 0
        });
    }

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        weth = new MockWETH();
        registry = new MockAgentRegistry();
        token = new MockToken();
        pool = new Pool(IWETH(address(weth)), IAgentRegistry(address(registry)), buyback, timelock, guardian, defaultParams());
        pool.seed{value: SEED}();
        record = new CreditRecord(pool);
        vault = new TrenchersStakeLines(
            pool, IERC20(address(token)), timelock, guardian, TOKENS_PER_ETH, MAX_LINE, VAULT_MAX_TERM, WEEKLY_CAP, "ipfs://vault"
        );
        vm.label(address(pool), "pool");
        vm.label(address(vault), "vault");
        vm.label(address(weth), "weth");
    }

    // ------------------------------------------------------------------ helpers

    function sharePrice() internal view returns (uint256) {
        return pool.convertToAssets(1e18);
    }

    function lend(address who, uint256 amount) internal returns (uint256 minted) {
        vm.deal(who, who.balance + amount);
        vm.prank(who);
        minted = pool.deposit{value: amount}(amount, who, 0);
    }

    /// A fresh agent identity owned by a fresh key.
    function newAgent(string memory label) internal returns (uint256 id, address owner, uint256 pk) {
        (owner, pk) = makeAddrAndKey(label);
        vm.prank(owner);
        id = registry.register(label);
    }

    /// A backer identity owned by an EOA, registered with `amount` of backing.
    function newBacker(string memory label, uint256 amount) internal returns (uint256 id, address owner) {
        (id, owner,) = newAgent(label);
        vm.deal(owner, owner.balance + amount);
        vm.prank(owner);
        pool.registerBacker{value: amount}(id, amount);
    }

    function consentFor(uint256 agentId, uint256 backerId, address owner, uint256 maxPremiumBps, uint256 deadline)
        internal
        view
        returns (Pool.Consent memory c)
    {
        c = Pool.Consent({
            agentId: agentId,
            backerId: backerId,
            owner: owner,
            maxPremiumBps: maxPremiumBps,
            nonce: pool.nonces(agentId),
            deadline: deadline
        });
    }

    function sign(Pool.Consent memory c, uint256 pk) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, pool.consentDigest(c));
        return abi.encodePacked(r, s, v);
    }

    function signedConsent(uint256 agentId, uint256 backerId, address owner, uint256 pk, uint256 maxPremiumBps)
        internal
        view
        returns (Pool.Consent memory c, bytes memory sig)
    {
        c = consentFor(agentId, backerId, owner, maxPremiumBps, vm.getBlockTimestamp() + 1 days);
        sig = sign(c, pk);
    }

    /// The backer `backerOwner` opens a line of `amount` for the agent (owner key `pk`).
    function openLineAs(
        address backerOwner,
        uint256 backerId,
        uint256 agentId,
        address agentOwner,
        uint256 pk,
        uint256 amount,
        uint256 premiumBps
    ) internal {
        (Pool.Consent memory c, bytes memory sig) = signedConsent(agentId, backerId, agentOwner, pk, 200);
        vm.prank(backerOwner);
        pool.openLine(backerId, agentId, amount, premiumBps, c, sig);
    }

    function fundVault(uint256 amount) internal {
        address funder = makeAddr("funder");
        vm.deal(funder, funder.balance + amount);
        vm.prank(funder);
        vault.fund{value: amount}();
    }

    /// Stakes `tokens` in the vault for the agent and opens its line.
    function stakeOpen(uint256 agentId, address agentOwner, uint256 pk, uint256 tokens) internal {
        token.mint(agentOwner, tokens);
        (Pool.Consent memory c, bytes memory sig) = signedConsent(agentId, vault.backerId(), agentOwner, pk, 0);
        vm.startPrank(agentOwner);
        token.approve(address(vault), tokens);
        vault.open(agentId, tokens, c, sig);
        vm.stopPrank();
    }

    function borrowAs(address who, uint256 agentId, uint256 amount, uint64 term) internal returns (uint256 loanId) {
        vm.prank(who);
        loanId = pool.borrow(agentId, amount, term, who, type(uint256).max, true);
    }

    function dueOf(uint256 loanId) internal view returns (uint256) {
        Pool.Loan memory l = pool.getLoan(loanId);
        return l.principal + l.fee;
    }

    function repayEth(uint256 loanId) internal {
        Pool.Loan memory l = pool.getLoan(loanId);
        uint256 due = l.principal + l.fee;
        address payer = makeAddr("payer");
        vm.deal(payer, payer.balance + due);
        vm.prank(payer);
        pool.repay{value: due}(loanId, l.agentId, due);
    }

    function wethSolvent() internal view returns (bool) {
        return weth.balanceOf(address(pool)) >= pool.poolLiquidity() + pool.reserve() + pool.unclaimedBackerFees();
    }
}
