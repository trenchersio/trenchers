// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { IFoundationUniversalRouterV2 } from "../src/FoundationFactoryV2.sol";
import { FoundationHookDeployerV2 } from "../src/FoundationHookDeployerV2.sol";
import { FoundationFactoryV3Native } from "../src/FoundationFactoryV3Native.sol";
import { TrenchersInfraV1 } from "../src/TrenchersInfraV1.sol";
import { BuyCooldownFactoryV1 } from "../src/modules/buy-cooldown/BuyCooldownFactoryV1.sol";
import { BuyWindowFactoryV1 } from "../src/modules/buy-window/BuyWindowFactoryV1.sol";
import { PriceMoveGuardFactoryV1 } from "../src/modules/price-move-guard/PriceMoveGuardFactoryV1.sol";
import { GrowingBuyLimitFactoryV1 } from "../src/modules/growing-buy-limit/GrowingBuyLimitFactoryV1.sol";
import { LaunchWalletCapFactoryV1 } from "../src/modules/launch-wallet-cap/LaunchWalletCapFactoryV1.sol";
import {
    BuybackBurnFactoryV1, DipBuybackFactoryV1, LPRewardsFactoryV1, FullRangeLPFactoryV1, BuyerRewardsFactoryV1,
    NthBuyPotFactoryV1, KingOfTheHillFactoryV1, HotPotatoFactoryV1, PlagueFactoryV1, ReactivePairFactoryV1, EntangledFactoryV1
} from "../src/modules/economics/EconomicModuleFactoriesV1.sol";

/// @notice Deploys the whole V4 Builder on Robinhood Chain: hook deployer, launch factory and the 16 module factories.
/// Nothing deployed here has an owner. Prints the Railway variables at the end.
/// forge script script/DeployBuilder.s.sol --rpc-url $RPC --broadcast --private-key <deployer>
contract DeployBuilder is Script {
    function run() external {
        TrenchersInfraV1.Infra memory i = TrenchersInfraV1.current();
        uint256 startBlock = block.number;
        vm.startBroadcast();
        FoundationHookDeployerV2 deployer = new FoundationHookDeployerV2();
        bytes32[5] memory hashes = [i.managerHash, i.positionsHash, i.routerHash, i.permit2Hash, address(deployer).codehash];
        FoundationFactoryV3Native factory = new FoundationFactoryV3Native(
            IPoolManager(i.manager), IPositionManager(i.positions), IFoundationUniversalRouterV2(i.router),
            IAllowanceTransfer(i.permit2), deployer, hashes
        );
        address[16] memory m = [
            address(new BuyCooldownFactoryV1()), address(new BuyWindowFactoryV1()), address(new PriceMoveGuardFactoryV1()),
            address(new GrowingBuyLimitFactoryV1()), address(new LaunchWalletCapFactoryV1()), address(new BuybackBurnFactoryV1()),
            address(new DipBuybackFactoryV1()), address(new LPRewardsFactoryV1()), address(new FullRangeLPFactoryV1()),
            address(new BuyerRewardsFactoryV1()), address(new NthBuyPotFactoryV1()), address(new KingOfTheHillFactoryV1()),
            address(new HotPotatoFactoryV1()), address(new PlagueFactoryV1()), address(new ReactivePairFactoryV1()),
            address(new EntangledFactoryV1())
        ];
        vm.stopBroadcast();
        string[16] memory k = ["buyCooldown", "buyWindow", "priceMoveGuard", "growingBuyLimit", "launchWalletCap", "buybackBurn",
            "dipBuyback", "lpRewards", "fullRangeLp", "buyerRewards", "nthBuyPot", "kingOfTheHill", "hotPotato", "plague",
            "reactivePair", "entangled"];
        string memory json = "{";
        for (uint256 x; x < 16; ++x) {
            json = string.concat(json, x == 0 ? "" : ",", '"', k[x], '":"', vm.toString(m[x]), '"');
        }
        json = string.concat(json, "}");
        console2.log(string.concat("V4_FACTORY=", vm.toString(address(factory))));
        console2.log(string.concat("V4_HOOK_DEPLOYER=", vm.toString(address(deployer))));
        console2.log(string.concat("V4_MODULES=", json));
        console2.log(string.concat("V4_START_BLOCK=", vm.toString(startBlock)));
    }
}
