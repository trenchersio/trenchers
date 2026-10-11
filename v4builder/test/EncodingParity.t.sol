// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { WebFlowsTest } from "./WebFlows.t.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { PathKey } from "@uniswap/v4-periphery-v211/src/libraries/PathKey.sol";
import { console } from "forge-std/console.sol";

/// @notice Prints the router inputs for fixed values; web/scripts/check-v4-encoding.mjs builds the same with the
/// website's encoders and compares byte for byte.
contract EncodingParityTest is WebFlowsTest {
    function test_printEncodings() public pure {
        address token = 0x1111111111111111111111111111111111111111;
        address weth = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
        address hook = 0x00000000000000000000000000000000000020cC;
        PoolKey memory k = PoolKey(Currency.wrap(weth), Currency.wrap(token), 0, 60, IHooks(hook));
        (bytes memory c1, bytes[] memory i1) = _buyWithEthOnWethPair(k, token, 1 ether, 123);
        console.log("buyWeth", vm.toString(abi.encode(c1, i1)));
        (bytes memory c2, bytes[] memory i2) = _sellForEthOnWethPair(k, token, 5 ether, 7);
        console.log("sellWeth", vm.toString(abi.encode(c2, i2)));
        address tr = 0xC65a7C91591A2Dd4d5624E75e814b1bBe88b984a;
        PathKey[] memory path = new PathKey[](2);
        path[0] = PathKey(Currency.wrap(tr), 10000, 200, IHooks(0x2222222222222222222222222222222222222222), bytes(""));
        path[1] = PathKey(Currency.wrap(token), 0, 60, IHooks(hook), bytes(""));
        (bytes memory c3, bytes[] memory i3) = _swapPath(address(0), path, token, 2 ether, 9);
        console.log("buyPath", vm.toString(abi.encode(c3, i3)));
    }
}
