// SPDX-License-Identifier: MIT
// Derived from Programmable module-foundation (MIT), github.com/programmablehq/PROGRAMMABLE. Adapted for Trenchers.
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../../FoundationTypesV1.sol";
import { IFoundationModuleFactoryV1 } from "../../IFoundationModuleV1.sol";
import { TrenchersInfraV1 } from "../../TrenchersInfraV1.sol";
import { BuyCooldownV1 } from "./BuyCooldownV1.sol";

contract BuyCooldownFactoryV1 is IFoundationModuleFactoryV1 {
    error OnlyBoundHost();

    function createModule(T.ModuleContext calldata c, bytes calldata configuration) external returns (address) {
        if (msg.sender != c.host) revert OnlyBoundHost();
        TrenchersInfraV1.Infra memory i = TrenchersInfraV1.current();
        return address(new BuyCooldownV1(c, configuration, i.router, i.routerHash));
    }
}
