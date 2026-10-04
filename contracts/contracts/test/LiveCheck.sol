// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAdapterLive {
    function buy(address token, uint256 minTokensOut) external payable returns (uint256);
    function sell(address token, uint256 tokensIn, uint256 minEthOut) external returns (uint256);
    function venue(address token) external view returns (uint8);
}

/// @dev Used only inside eth_call with state overrides (never deployed): buys a live Pons coin through the
///      Trenchers trading route and sells it back, to prove the route works against the deployed Pons.
contract LiveCheck {
    function roundTrip(address adapter, address token, uint256 ethIn) external payable returns (uint256 tokensOut, uint256 ethBack, uint8 venueAfter) {
        tokensOut = IAdapterLive(adapter).buy{value: ethIn}(token, 0);
        IERC20(token).approve(adapter, tokensOut);
        ethBack = IAdapterLive(adapter).sell(token, tokensOut, 0);
        venueAfter = IAdapterLive(adapter).venue(token);
    }
    receive() external payable {}
}
