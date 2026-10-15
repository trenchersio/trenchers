// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseTest} from "../helpers/BaseTest.sol";
import {TrenchersCreditPool as Pool} from "../../src/TrenchersCreditPool.sol";
import {Handler} from "./Handler.sol";
import {console} from "forge-std/console.sol";

contract PoolInvariantTest is BaseTest {
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        lend(alice, 5 ether);
        fundVault(3 ether);
        vm.prank(timelock);
        vault.setTerms(TOKENS_PER_ETH, MAX_LINE, VAULT_MAX_TERM, 100 ether); // no weekly limit in the run
        Pool.Params memory p = defaultParams();
        p.keeperBounty = 0.0001 ether;
        vm.prank(timelock);
        pool.setParams(p);

        handler = new Handler(pool, vault, weth, token, registry);
        targetContract(address(handler));
    }

    function invariant_sharePriceNeverFalls() public view {
        assertFalse(handler.priceFell(), "share price fell");
        assertGe(pool.convertToAssets(1e18), handler.lastPrice());
        assertGe(pool.convertToAssets(1e18), 1e18);
    }

    function invariant_noBadDebt() public view {
        assertEq(pool.totalBadDebt(), 0);
    }

    function invariant_wethCoversBooks() public view {
        assertGe(weth.balanceOf(address(pool)), pool.poolLiquidity() + pool.reserve() + pool.unclaimedBackerFees());
    }

    function invariant_principalAddsUp() public view {
        uint256 sum;
        uint256 n = handler.agentCount();
        for (uint256 i; i < n; i++) sum += pool.getAgent(handler.agents(i)).principalOut;
        assertEq(sum, pool.totalPrincipalOut());
    }

    function invariant_backersCoverTheirLines() public view {
        uint256[2] memory backers = [vault.backerId(), handler.eoaBacker()];
        for (uint256 i; i < 2; i++) {
            uint256 b = backers[i];
            // backing covers lines + locked fees, to a unit of rounding per default
            assertGe(pool.backing(b), pool.getAgent(b).linesOut + pool.feeLocked(b));
        }
    }

    function invariant_linesCoverPrincipal() public view {
        uint256 n = handler.agentCount();
        uint256 lines;
        for (uint256 i; i < n; i++) {
            Pool.Agent memory a = pool.getAgent(handler.agents(i));
            assertGe(a.line, a.principalOut);
            lines += a.line;
        }
        assertEq(lines, pool.getAgent(vault.backerId()).linesOut + pool.getAgent(handler.eoaBacker()).linesOut);
    }

    function invariant_vaultTokensAccounted() public view {
        assertEq(token.balanceOf(address(vault)), vault.totalStaked());
        assertEq(token.balanceOf(0x000000000000000000000000000000000000dEaD), vault.totalBurnt());
    }

    function invariant_vaultSharesAddUp() public view {
        uint256 sum;
        uint256 n = handler.backerCount();
        for (uint256 i; i < n; i++) {
            address b = handler.backers(i);
            sum += vault.sharesOf(b);
            (uint256 pending,) = vault.exits(b);
            assertLe(pending, vault.sharesOf(b), "exit request within shares");
        }
        assertEq(sum, vault.totalShares());
    }

    function invariant_vaultValuesWithinBacking() public view {
        uint256 sum;
        uint256 n = handler.backerCount();
        for (uint256 i; i < n; i++) {
            (, uint256 value,,) = vault.backerPosition(handler.backers(i));
            sum += value;
        }
        assertLe(sum, vault.backingValue());
        if (vault.totalShares() == 0) assertEq(sum, 0);
    }

    function invariant_vaultEthOnlyFees() public view {
        // the vault only ever holds fees it collected, and they are counted in its value
        assertLe(address(vault).balance, vault.backingValue());
    }

    function afterInvariant() external view {
        console.log("calls", handler.calls());
        console.log("agents", handler.agentCount());
        console.log("borrows", handler.count("borrow"));
        console.log("repays", handler.count("repay"));
        console.log("defaults", handler.defaults());
        console.log("vault funds", handler.count("fundVault"));
        console.log("vault exits", handler.exitsDone());
        console.log("vault exited", handler.exited());
        console.log("loans", pool.loanCount());
        console.log("slashed", pool.totalSlashed());
        console.log("share price", pool.convertToAssets(1e18));
    }
}
