// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationForkBaseV3 } from "./FoundationDirectionalFeesV3.t.sol";
import { FoundationTypesV1 as T } from "../src/FoundationTypesV1.sol";
import { FoundationLaunchTypesV2 as L } from "../src/FoundationLaunchTypesV2.sol";
import { FoundationLaunchTypesV3 as P } from "../src/FoundationLaunchTypesV3.sol";
import { FoundationLedgerV1 } from "../src/FoundationLedgerV1.sol";
import { FoundationHookV2 } from "../src/FoundationHookV2.sol";
import { FoundationFactoryV3 } from "../src/FoundationFactoryV3.sol";
import { TrenchersInfraV1 } from "../src/TrenchersInfraV1.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice What Trenchers changed from the upstream Foundation sources, pinned by test.
contract TrenchersV4BuilderTest is FoundationForkBaseV3 {
    address constant BUYBACK = 0xB03A251c7b5c83e44005c4A7BA6f5d96B8284D5A;

    function test_platformFeesGoOnlyToTheTrenchersBuybackWallet() public {
        L.LaunchResultV2 memory r = _launch(_params(true, 100, 300, 0, 1 ether));
        this.tradeExternal(r, true, true, 10 ether);
        this.tradeExternal(r, false, true, IERC20(r.token).balanceOf(ALICE) / 2);
        FoundationLedgerV1 ledger = FoundationLedgerV1(r.ledger);
        uint256 owed = ledger.platformReceived();
        assertGt(owed, 0);
        uint256 before = quote.balanceOf(BUYBACK);
        vm.prank(BOB); // anyone can trigger it; only the buyback wallet can receive it
        ledger.claimPlatform();
        assertEq(quote.balanceOf(BUYBACK) - before, owed);
        assertEq(ledger.platformClaimed(), owed);
    }

    function test_platformFeeIsThirtyBasisPointsOfEveryTrade() public {
        L.LaunchResultV2 memory r = _launch(_params(true, 0, 0, 0, 0));
        uint256 beforePlatform = FoundationLedgerV1(r.ledger).platformReceived();
        this.tradeExternal(r, true, true, 10 ether);
        assertEq(FoundationLedgerV1(r.ledger).platformReceived() - beforePlatform, 10 ether * 30 / 10_000);
        assertEq(FoundationLedgerV1(r.ledger).creatorReceived(), 0);
    }

    function test_creatorFeesOnlyToTheCreator() public {
        L.LaunchResultV2 memory r = _launch(_params(true, 500, 1000, 0, 0));
        this.tradeExternal(r, true, true, 10 ether);
        FoundationLedgerV1 ledger = FoundationLedgerV1(r.ledger);
        uint256 credited = ledger.creatorCredited();
        assertEq(credited, 10 ether * 500 / 10_000);
        uint256 before = quote.balanceOf(ALICE);
        vm.prank(BOB);
        ledger.claimCreator();
        assertEq(quote.balanceOf(ALICE) - before, credited);
        assertEq(FoundationHookV2(r.hook).creatorBuyFeeBps(), 500);
        assertEq(FoundationHookV2(r.hook).creatorSellFeeBps(), 1000);
    }

    function test_trenchersIdentifiers() public view {
        assertEq(T.ABI_ID, keccak256("trenchers.module-foundation.v1"));
        assertEq(factory.VERSION_ID(), keccak256("trenchers.module-foundation.factory.v3"));
    }

    function test_infrastructureIsPinnedOnRobinhoodAndRefusedElsewhere() public {
        vm.chainId(4663);
        TrenchersInfraV1.Infra memory i = TrenchersInfraV1.current();
        assertEq(i.manager, 0x8366a39CC670B4001A1121B8F6A443A643e40951);
        assertEq(i.positions, 0x58daec3116aae6D93017bAAea7749052E8a04fA7);
        assertEq(i.router, 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99);
        assertEq(i.permit2, 0x000000000022D473030F116dDEE9F6B43aC78BA3);
        assertEq(i.wrappedEth, 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73);
        assertEq(i.managerHash, 0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626);
        vm.chainId(1);
        vm.expectRevert(TrenchersInfraV1.UnsupportedChain.selector);
        this.infra();
    }

    function infra() external view returns (TrenchersInfraV1.Infra memory) {
        return TrenchersInfraV1.current();
    }

    function test_launchedSupplyAndLiquidityAreLockedForGood() public {
        L.LaunchResultV2 memory r = _launch(_params(true, 100, 100, 0, 1 ether));
        assertEq(IERC20(r.token).totalSupply(), T.TOKEN_SUPPLY);
        assertEq(r.basePositionOwner, DEAD);
        assertEq(IERC20(r.token).balanceOf(address(factory)), 0);
    }
}
