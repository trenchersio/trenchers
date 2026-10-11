// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IOTC {
    function ask(address token, uint128 tokenAmount, uint128 ethAmount, uint40 expiry, address taker) external returns (uint256);
    function buy(uint256[] calldata ids, uint128[] calldata amounts, address recipient) external payable returns (uint256);
}

/// @dev Takes 1% of every transfer.
contract MockTaxedToken is ERC20("Taxed", "TAX") {
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function _transfer(address from, address to, uint256 amount) internal override {
        uint256 fee = amount / 100;
        super._transfer(from, address(0xdead), fee);
        super._transfer(from, to, amount - fee);
    }
}

/// @dev A maker whose receive() tries to buy from its own order again while being paid.
contract MockReentrantMaker {
    IOTC public otc; IERC20 public token; uint256 public id;
    constructor(IOTC otc_, IERC20 token_) { otc = otc_; token = token_; }
    function place(uint128 amount, uint128 eth) external {
        token.approve(address(otc), amount);
        id = otc.ask(address(token), amount, eth, 0, address(0));
    }
    receive() external payable {
        uint256[] memory ids = new uint256[](1); ids[0] = id;
        uint128[] memory amts = new uint128[](1); amts[0] = 1;
        otc.buy{value: msg.value}(ids, amts, address(this));
    }
}
