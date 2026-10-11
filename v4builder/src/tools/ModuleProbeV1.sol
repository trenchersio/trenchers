// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationTypesV1 as T } from "../FoundationTypesV1.sol";
import { IFoundationModuleV1, IFoundationModuleFactoryV1 } from "../IFoundationModuleV1.sol";

/// @notice Never deployed. The website runs it inside a single eth_call (as a state override) to learn, from the
/// chain itself, the runtime code hash and descriptor a module factory produces for a configuration: exactly what
/// a launch must commit to in its ModuleSelection. Calling as the bound host is what the factories require.
contract ModuleProbeV1 {
    function probe(address factory, bytes calldata configuration, address token, address quote, address creator)
        external
        returns (bytes32 factoryCodeHash, bytes32 moduleCodeHash, bytes32 descriptorHash, T.Descriptor memory d)
    {
        T.ModuleContext memory c =
            T.ModuleContext(address(this), token, quote, creator, address(uint160(0xBEEF)), keccak256("probe"));
        address module = IFoundationModuleFactoryV1(factory).createModule(c, configuration);
        d = IFoundationModuleV1(module).descriptor();
        return (factory.codehash, module.codehash, keccak256(abi.encode(d)), d);
    }
}
