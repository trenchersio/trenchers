// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FoundationNativeV3Test } from "./FoundationNativeV3.t.sol";
import { FoundationQuoteFixture } from "./FoundationFixturesV1.sol";
import { FoundationTypesV1 as T } from "../src/FoundationTypesV1.sol";
import { FoundationLaunchTypesV2 as L } from "../src/FoundationLaunchTypesV2.sol";
import { FoundationLaunchTypesV3 as P } from "../src/FoundationLaunchTypesV3.sol";
import { FoundationHookV2 } from "../src/FoundationHookV2.sol";
import { FoundationLedgerV1 } from "../src/FoundationLedgerV1.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PathKey } from "@uniswap/v4-periphery-v211/src/libraries/PathKey.sol";
import { IV4Router } from "@uniswap/v4-periphery-v211/src/interfaces/IV4Router.sol";
import { Actions } from "@uniswap/v4-periphery-v211/src/libraries/Actions.sol";

interface IUniversalRouterLocal {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @notice The exact Universal Router command sequences the website builds for the V4 Builder, run against the real
/// router: launching paired with WETH or with a token bought from ETH on the way, then buying and selling a coin
/// for native ETH directly (WETH pair) or through the token's own ETH pool (two hops).
contract WebFlowsTest is FoundationNativeV3Test {
    address constant MSG_SENDER = address(1);
    address constant ADDRESS_THIS = address(2);
    uint256 constant OPEN_DELTA = 0;

    // ------------------------------------------------------------ encoders mirrored in web/lib/v4builder.ts

    function _buyWithEthOnWethPair(PoolKey memory key, address token, uint256 amountIn, uint256 minOut)
        internal pure returns (bytes memory commands, bytes[] memory inputs)
    {
        commands = hex"0b10"; // WRAP_ETH, V4_SWAP
        inputs = new bytes[](2);
        inputs[0] = abi.encode(ADDRESS_THIS, amountIn);
        bytes[] memory params = new bytes[](3);
        address weth = Currency.unwrap(key.currency0) == token ? Currency.unwrap(key.currency1) : Currency.unwrap(key.currency0);
        params[0] = abi.encode(IV4Router.ExactInputSingleParams(key, weth < token, uint128(amountIn), uint128(minOut), 0, bytes("")));
        params[1] = abi.encode(Currency.wrap(weth), OPEN_DELTA, false); // SETTLE from the router's own WETH
        params[2] = abi.encode(Currency.wrap(token), minOut);
        inputs[1] = abi.encode(abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE), uint8(Actions.TAKE_ALL)), params);
    }

    function _sellForEthOnWethPair(PoolKey memory key, address token, uint256 amountIn, uint256 minOut)
        internal pure returns (bytes memory commands, bytes[] memory inputs)
    {
        commands = hex"100c"; // V4_SWAP, UNWRAP_WETH
        inputs = new bytes[](2);
        bytes[] memory params = new bytes[](3);
        address weth = Currency.unwrap(key.currency0) == token ? Currency.unwrap(key.currency1) : Currency.unwrap(key.currency0);
        params[0] = abi.encode(IV4Router.ExactInputSingleParams(key, token < weth, uint128(amountIn), uint128(minOut), 0, bytes("")));
        params[1] = abi.encode(Currency.wrap(token), amountIn);
        params[2] = abi.encode(Currency.wrap(weth), ADDRESS_THIS, OPEN_DELTA);
        inputs[0] = abi.encode(abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE)), params);
        inputs[1] = abi.encode(MSG_SENDER, minOut);
    }

    function _swapPath(address currencyIn, PathKey[] memory path, address currencyOut, uint256 amountIn, uint256 minOut)
        internal pure returns (bytes memory commands, bytes[] memory inputs)
    {
        commands = hex"10";
        inputs = new bytes[](1);
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(IV4Router.ExactInputParams(Currency.wrap(currencyIn), path, new uint256[](0), uint128(amountIn), uint128(minOut)));
        params[1] = abi.encode(Currency.wrap(currencyIn), amountIn);
        params[2] = abi.encode(Currency.wrap(currencyOut), minOut);
        inputs[0] = abi.encode(abi.encodePacked(uint8(Actions.SWAP_EXACT_IN), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL)), params);
    }

    // ------------------------------------------------------------ flows

    function test_wethPairBuyAndSellWithNativeEth() public {
        L.LaunchResultV2 memory r;
        {
            P.LaunchParamsV3 memory p = _nativeParams(0.005 ether);
            vm.prank(ALICE);
            r = nativeFactory.launchWithEthRoute{ value: 0.005 ether }(p, _emptyPath());
        }
        PoolKey memory key = FoundationHookV2(r.hook).poolKey();
        vm.deal(BOB, 1 ether);
        (bytes memory c, bytes[] memory i) = _buyWithEthOnWethPair(key, r.token, 0.1 ether, 1);
        vm.prank(BOB);
        IUniversalRouterLocal(ROUTER).execute{ value: 0.1 ether }(c, i, block.timestamp + 60);
        uint256 got = IERC20(r.token).balanceOf(BOB);
        assertGt(got, 0);
        assertEq(BOB.balance, 0.9 ether);
        assertGt(FoundationLedgerV1(r.ledger).platformReceived(), 0);
        // sell half back for native ETH: approve Permit2 once, then the router
        vm.startPrank(BOB);
        IERC20(r.token).approve(PERMIT2, type(uint256).max);
        IAllowanceTransfer(PERMIT2).approve(r.token, ROUTER, type(uint160).max, uint48(block.timestamp + 3600));
        (c, i) = _sellForEthOnWethPair(key, r.token, got / 2, 1);
        IUniversalRouterLocal(ROUTER).execute(c, i, block.timestamp + 60);
        vm.stopPrank();
        assertEq(IERC20(r.token).balanceOf(BOB), got - got / 2);
        assertGt(BOB.balance, 0.9 ether);
        assertEq(IERC20(WETH).balanceOf(ROUTER), 0);
        assertEq(ROUTER.balance, 0);
    }

    function test_tokenPairBuyAndSellThroughTheTokensEthPool() public {
        // A stand-in for $TRENCHERS with its own native ETH pool (on mainnet: its Pons pool).
        FoundationQuoteFixture trenchers = quote;
        PoolKey memory ethPool = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(trenchers)), 3000, 60, IHooks(address(0)));
        manager.initialize(ethPool, uint160(1 << 96));
        PoolModifyLiquidityTest seeder = new PoolModifyLiquidityTest(manager);
        vm.deal(ALICE, 20 ether);
        vm.startPrank(ALICE);
        trenchers.approve(address(seeder), type(uint256).max);
        seeder.modifyLiquidity{ value: 10 ether }(ethPool, ModifyLiquidityParams(-6000, 6000, int256(30 ether), bytes32(0)), bytes(""));
        vm.stopPrank();
        PathKey[] memory funding = new PathKey[](1);
        funding[0] = PathKey(Currency.wrap(address(0)), ethPool.fee, ethPool.tickSpacing, ethPool.hooks, bytes(""));
        P.LaunchParamsV3 memory p = _params(true, 300, 300, 0, 1 ether);
        vm.prank(ALICE);
        L.LaunchResultV2 memory r = nativeFactory.launchWithEthRoute{ value: 2 ether }(p, abi.encode(funding));
        assertGt(r.initialBuyTokenAmount, 0);
        PoolKey memory coinPool = FoundationHookV2(r.hook).poolKey();

        // buy the coin with ETH: ETH -> token -> coin
        PathKey[] memory path = new PathKey[](2);
        path[0] = PathKey(Currency.wrap(address(trenchers)), ethPool.fee, ethPool.tickSpacing, ethPool.hooks, bytes(""));
        path[1] = PathKey(Currency.wrap(r.token), coinPool.fee, coinPool.tickSpacing, coinPool.hooks, bytes(""));
        vm.deal(BOB, 1 ether);
        (bytes memory c, bytes[] memory i) = _swapPath(address(0), path, r.token, 0.2 ether, 1);
        vm.prank(BOB);
        IUniversalRouterLocal(ROUTER).execute{ value: 0.2 ether }(c, i, block.timestamp + 60);
        uint256 got = IERC20(r.token).balanceOf(BOB);
        assertGt(got, 0);
        assertEq(BOB.balance, 0.8 ether);

        // sell it back for ETH: coin -> token -> ETH
        PathKey[] memory back = new PathKey[](2);
        back[0] = PathKey(Currency.wrap(address(trenchers)), coinPool.fee, coinPool.tickSpacing, coinPool.hooks, bytes(""));
        back[1] = PathKey(Currency.wrap(address(0)), ethPool.fee, ethPool.tickSpacing, ethPool.hooks, bytes(""));
        vm.startPrank(BOB);
        IERC20(r.token).approve(PERMIT2, type(uint256).max);
        IAllowanceTransfer(PERMIT2).approve(r.token, ROUTER, type(uint160).max, uint48(block.timestamp + 3600));
        (c, i) = _swapPath(r.token, back, address(0), got, 1);
        IUniversalRouterLocal(ROUTER).execute(c, i, block.timestamp + 60);
        vm.stopPrank();
        assertEq(IERC20(r.token).balanceOf(BOB), 0);
        assertGt(BOB.balance, 0.8 ether);
        assertEq(ROUTER.balance, 0);
        // both trades paid the platform and creator fees in the pair token
        assertGt(FoundationLedgerV1(r.ledger).platformReceived(), 0);
        assertGt(FoundationLedgerV1(r.ledger).creatorReceived(), 0);
    }
}
