// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title InferenceDesk
/// @notice Where $TRENCHERS is paid for inference credit, and the only thing it can ever do with it is burn it.
///         There is no owner and no withdraw: anyone may call burn(), which sends every $TRENCHERS held here to the
///         dead address. So a payment is out of circulation the moment it lands, and gone from the supply the
///         next time burn() runs (the Trenchers engine calls it on a schedule).
///         Only $TRENCHERS is accepted for credit. Anything else sent here is lost, and so is ETH (refused).
contract InferenceDesk {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    IERC20 public immutable token;
    uint256 public totalBurned;

    event Burned(uint256 amount, uint256 totalBurned);

    constructor(IERC20 token_) {
        require(address(token_) != address(0), "token");
        token = token_;
    }

    /// @notice Burns every $TRENCHERS held here. Permissionless: it can only ever send to the dead address.
    function burn() external returns (uint256 amount) {
        amount = token.balanceOf(address(this));
        if (amount == 0) return 0;
        totalBurned += amount;
        token.safeTransfer(DEAD, amount);
        emit Burned(amount, totalBurned);
    }
}
