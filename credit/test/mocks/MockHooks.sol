// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ILineHook} from "../../src/interfaces/ICreditDeps.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice A hook whose answers and failures the test controls; it records what it heard.
contract MockHook is ILineHook {
    bool public allow = true;
    bool public revertOnNotify;
    bool public burnGas;
    uint256 public borrows;
    uint256 public defaults;
    uint256 public releases;
    uint256 public lastReleaseAmount;
    uint8 public lastReleaseReason;
    bool public lastLoanFlag;

    function setAllow(bool a) external {
        allow = a;
    }

    function setRevertOnNotify(bool r) external {
        revertOnNotify = r;
    }

    function setBurnGas(bool b) external {
        burnGas = b;
    }

    function canBorrow(uint256, uint256, uint256, uint64, uint256, address, address, address)
        external
        view
        returns (bool)
    {
        if (burnGas) {
            uint256 x;
            while (gasleft() > 0) x++; // runs out of gas
        }
        return allow;
    }

    function onBorrow(uint256, uint256, uint256) external {
        if (revertOnNotify) revert("no");
        borrows++;
    }

    function onDefault(uint256, uint256, uint256, uint256, bool lastLoan) external {
        if (revertOnNotify) revert("no");
        defaults++;
        lastLoanFlag = lastLoan;
    }

    function onRelease(uint256, uint256, uint256 amount, uint8 reason) external {
        if (revertOnNotify) revert("no");
        releases++;
        lastReleaseAmount = amount;
        lastReleaseReason = reason;
    }
}

/// @notice Answers canBorrow with a non-bool word (2), which must count as "no".
contract WeirdHook {
    fallback() external {
        assembly {
            mstore(0, 2)
            return(0, 32)
        }
    }
}

/// @notice A contract wallet that owns agents and signs through EIP-1271 with its EOA signer.
contract Mock1271Wallet is IERC1271 {
    address public signer;

    constructor(address s) {
        signer = s;
    }

    function isValidSignature(bytes32 hash, bytes memory sig) external view returns (bytes4) {
        (address rec,,) = ECDSA.tryRecover(hash, sig);
        return rec == signer ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }

    function exec(address target, bytes calldata data) external payable returns (bytes memory) {
        require(msg.sender == signer, "signer");
        (bool ok, bytes memory ret) = target.call{value: msg.value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    receive() external payable {}
}

/// @notice Refuses ETH.
contract NoEth {}
