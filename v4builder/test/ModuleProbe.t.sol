// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationForkBaseV3 } from "./FoundationDirectionalFeesV3.t.sol";
import { FoundationTypesV1 as T } from "../src/FoundationTypesV1.sol";
import { FoundationLaunchTypesV2 as L } from "../src/FoundationLaunchTypesV2.sol";
import { FoundationLaunchTypesV3 as P } from "../src/FoundationLaunchTypesV3.sol";
import { FoundationHookV2 } from "../src/FoundationHookV2.sol";
import { ModuleProbeV1 } from "../src/tools/ModuleProbeV1.sol";
import { BuyCooldownFactoryV1 } from "../src/modules/buy-cooldown/BuyCooldownFactoryV1.sol";
import { BuyWindowFactoryV1 } from "../src/modules/buy-window/BuyWindowFactoryV1.sol";
import { PriceMoveGuardFactoryV1 } from "../src/modules/price-move-guard/PriceMoveGuardFactoryV1.sol";
import { GrowingBuyLimitFactoryV1 } from "../src/modules/growing-buy-limit/GrowingBuyLimitFactoryV1.sol";
import { LaunchWalletCapFactoryV1 } from "../src/modules/launch-wallet-cap/LaunchWalletCapFactoryV1.sol";
import {
    BuybackBurnFactoryV1, DipBuybackFactoryV1, LPRewardsFactoryV1, FullRangeLPFactoryV1, BuyerRewardsFactoryV1,
    NthBuyPotFactoryV1, KingOfTheHillFactoryV1, HotPotatoFactoryV1, PlagueFactoryV1
} from "../src/modules/economics/EconomicModuleFactoriesV1.sol";
import { IFoundationModuleFactoryV1 } from "../src/IFoundationModuleV1.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice The probe the website uses yields selections a real launch accepts, for every catalogued module.
contract ModuleProbeTest is FoundationForkBaseV3 {
    function _probe(IFoundationModuleFactoryV1 f, bytes memory config, uint16 share)
        internal
        returns (T.ModuleSelection memory s)
    {
        ModuleProbeV1 probe = new ModuleProbeV1();
        (bytes32 fh, bytes32 mh, bytes32 dh,) = probe.probe(address(f), config, address(0x10), address(quote), ALICE);
        s = T.ModuleSelection(address(f), fh, mh, dh, config, share);
    }

    function test_everySimpleRuleProbesAndLaunchesTogether() public {
        P.LaunchParamsV3 memory p = _params(true, 100, 300, 0, 1 ether);
        p.modules = new T.ModuleSelection[](5);
        p.modules[0] = _probe(new BuyCooldownFactoryV1(), abi.encode(uint32(30)), 0);
        p.modules[1] = _probe(new BuyWindowFactoryV1(), abi.encode(uint8(0), uint8(23)), 0);
        p.modules[2] = _probe(new PriceMoveGuardFactoryV1(), abi.encode(uint16(2000)), 0);
        p.modules[3] = _probe(new GrowingBuyLimitFactoryV1(), abi.encode(uint16(50), uint16(500), uint32(600)), 0);
        p.modules[4] = _probe(new LaunchWalletCapFactoryV1(), abi.encode(uint16(200), uint32(60)), 0);
        _mine(p);
        L.LaunchResultV2 memory r = _launch(p);
        assertEq(FoundationHookV2(r.hook).moduleCount(), 5);
    }

    function test_economicModulesProbeAndLaunch() public {
        IFoundationModuleFactoryV1[7] memory fs = [
            IFoundationModuleFactoryV1(address(new BuybackBurnFactoryV1())),
            IFoundationModuleFactoryV1(address(new DipBuybackFactoryV1())),
            IFoundationModuleFactoryV1(address(new FullRangeLPFactoryV1())),
            IFoundationModuleFactoryV1(address(new BuyerRewardsFactoryV1())),
            IFoundationModuleFactoryV1(address(new NthBuyPotFactoryV1())),
            IFoundationModuleFactoryV1(address(new KingOfTheHillFactoryV1())),
            IFoundationModuleFactoryV1(address(new HotPotatoFactoryV1()))
        ];
        bytes[7] memory cs = [
            abi.encode(uint128(0.01 ether), uint128(1 ether), uint32(3600), uint32(300), uint16(300), uint16(0)),
            abi.encode(uint128(0.01 ether), uint128(1 ether), uint32(3600), uint32(300), uint16(300), uint16(1000)),
            abi.encode(uint128(0.01 ether), uint128(1 ether), uint32(3600), uint32(300), uint16(300), uint16(0)),
            abi.encode(uint128(0.01 ether), uint16(500), uint32(0), uint32(0)),
            abi.encode(uint128(0.01 ether), uint16(0), uint32(10), uint32(0)),
            abi.encode(uint128(0.01 ether), uint16(0), uint32(0), uint32(600)),
            abi.encode(uint128(1000 ether), uint32(300))
        ];
        uint16[7] memory shares = [uint16(2000), 2000, 2000, 2000, 2000, 2000, 0];
        for (uint256 i; i < 7; ++i) {
            P.LaunchParamsV3 memory p = _params(true, 500, 500, 0, 1 ether);
            p.modules = new T.ModuleSelection[](1);
            p.modules[0] = _probe(fs[i], cs[i], shares[i]);
            _mine(p);
            L.LaunchResultV2 memory r = _launch(p);
            assertEq(FoundationHookV2(r.hook).moduleCount(), 1);
            this.tradeExternal(r, true, true, 1 ether);
        }
    }

    function test_plagueGateLaunches() public {
        P.LaunchParamsV3 memory p = _params(true, 100, 100, 0, 1 ether);
        p.modules = new T.ModuleSelection[](1);
        p.modules[0] = _probe(new PlagueFactoryV1(), abi.encode(uint128(1 ether), uint32(0)), 0);
        _mine(p);
        L.LaunchResultV2 memory r = _launch(p);
        assertGt(IERC20(r.token).balanceOf(ALICE), 0);
    }
}
