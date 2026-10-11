// SPDX-License-Identifier: MIT
// Derived from Programmable module-foundation (MIT), github.com/programmablehq/PROGRAMMABLE. Adapted for Trenchers.
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { IFoundationUniversalRouterV2 } from "./FoundationFactoryV2.sol";
import { FoundationHookDeployerV2 } from "./FoundationHookDeployerV2.sol";
import { FoundationFactoryV3NativeBase } from "./FoundationFactoryV3NativeBase.sol";
import { TrenchersInfraV1 } from "./TrenchersInfraV1.sol";

/// @notice The Trenchers V4 Builder launch factory on Robinhood Chain: ETH in, coin, pool, permanent liquidity and
/// first buy out, in one transaction. Wrapped ETH is the pinned Robinhood WETH.
contract FoundationFactoryV3Native is FoundationFactoryV3NativeBase {
    constructor(
        IPoolManager manager,
        IPositionManager positions,
        IFoundationUniversalRouterV2 router,
        IAllowanceTransfer permits,
        FoundationHookDeployerV2 deployer,
        bytes32[5] memory expectedCodeHashes
    )
        FoundationFactoryV3NativeBase(
            manager,
            positions,
            router,
            permits,
            deployer,
            expectedCodeHashes,
            TrenchersInfraV1.current().wrappedEth,
            TrenchersInfraV1.current().wrappedEthHash
        )
    { }
}
