// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { IPositionDescriptor } from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import { IWETH9 } from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import { V4Router } from "@uniswap/v4-periphery-v211/src/V4Router.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";
import { DeployPermit2 } from "permit2/test/utils/DeployPermit2.sol";
import { TrenchersInfraV1 } from "../src/TrenchersInfraV1.sol";

/// @notice Plain WETH9 for a local chain.
contract LocalWETH {
    string public name = "Wrapped Ether";
    string public symbol = "WETH";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    receive() external payable { deposit(); }
    function deposit() public payable { balanceOf[msg.sender] += msg.value; emit Transfer(address(0), msg.sender, msg.value); }
    function withdraw(uint256 wad) external {
        balanceOf[msg.sender] -= wad;
        (bool ok,) = msg.sender.call{ value: wad }("");
        require(ok);
        emit Transfer(msg.sender, address(0), wad);
    }
    function totalSupply() external view returns (uint256) { return address(this).balance; }
    function approve(address s, uint256 v) external returns (bool) { allowance[msg.sender][s] = v; emit Approval(msg.sender, s, v); return true; }
    function transfer(address to, uint256 v) external returns (bool) { return transferFrom(msg.sender, to, v); }
    function transferFrom(address from, address to, uint256 v) public returns (bool) {
        if (from != msg.sender && allowance[from][msg.sender] != type(uint256).max) allowance[from][msg.sender] -= v;
        balanceOf[from] -= v;
        balanceOf[to] += v;
        emit Transfer(from, to, v);
        return true;
    }
}

/// @notice The Universal Router's V4_SWAP command (0x10) and nothing else: the same V4Router actions, the same
/// Permit2 payment path and the same msgSender() semantics, so every Foundation path runs unchanged offline.
contract LocalUniversalRouter is V4Router {
    IAllowanceTransfer public immutable permit2;
    address private _locker;

    error Unsupported();
    error Expired();

    constructor(IPoolManager manager, IAllowanceTransfer permits) V4Router(manager) {
        permit2 = permits;
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable {
        if (block.timestamp > deadline) revert Expired();
        if (commands.length != 1 || commands[0] != 0x10 || inputs.length != 1) revert Unsupported();
        _locker = msg.sender;
        _executeActions(inputs[0]);
        _locker = address(0);
    }

    function msgSender() public view override returns (address) {
        return _locker;
    }

    function _pay(Currency token, address payer, uint256 amount) internal override {
        if (payer == address(this)) token.transfer(address(poolManager), amount);
        else permit2.transferFrom(payer, address(poolManager), uint160(amount), Currency.unwrap(token));
    }

    receive() external payable { }
}

/// @notice What TrenchersInfraV1 reads on a local chain. Immutables, so it survives being etched.
contract LocalInfraRegistry {
    address public immutable manager;
    address public immutable positions;
    address public immutable router;
    address public immutable permit2;
    address public immutable wrappedEth;

    constructor(address m, address p, address r, address p2, address w) {
        manager = m; positions = p; router = r; permit2 = p2; wrappedEth = w;
    }
}

/// @notice Stands up Core, Permit2 (canonical bytecode at the canonical address), PositionManager, a V4 router and
/// WETH on a local chain, and registers them where TrenchersInfraV1 looks.
abstract contract LocalInfraBase is Test {
    address internal MANAGER;
    address internal POSM;
    address internal ROUTER;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal WETH;

    function _deployLocalInfra() internal {
        vm.chainId(31337);
        MANAGER = address(new PoolManager(address(this)));
        new DeployPermit2().deployPermit2();
        WETH = address(new LocalWETH());
        POSM = address(
            new PositionManager(
                IPoolManager(MANAGER), IAllowanceTransfer(PERMIT2), 300_000, IPositionDescriptor(address(0)), IWETH9(WETH)
            )
        );
        ROUTER = address(new LocalUniversalRouter(IPoolManager(MANAGER), IAllowanceTransfer(PERMIT2)));
        LocalInfraRegistry reg = new LocalInfraRegistry(MANAGER, POSM, ROUTER, PERMIT2, WETH);
        vm.etch(TrenchersInfraV1.LOCAL_REGISTRY, address(reg).code);
    }
}

/// @notice For tests that are not Foundry Test contracts themselves.
contract LocalInfraDeployer is LocalInfraBase {
    function deploy() external {
        _deployLocalInfra();
    }
}
