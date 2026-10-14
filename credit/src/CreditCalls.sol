// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title CreditCalls
/// @notice Helpers the pool runs by DELEGATECALL (a linked library), only to keep the pool under the code-size limit.
///         Hook calls therefore come from the pool's own address.
library CreditCalls {
    uint256 internal constant HOOK_GAS = 300_000;
    uint256 internal constant HOOK_OVERHEAD = 12_000;

    error HookStarved();

    /// @notice An EOA signs with ECDSA; a contract owner answers through EIP-1271.
    function validSig(address signer, bytes32 digest, bytes calldata sig) external view returns (bool) {
        return SignatureChecker.isValidSignatureNow(signer, digest, sig);
    }

    /// @notice Asks a backer's hook, with a fixed gas budget. Anything but a clean "1" blocks the borrow. A caller
    ///         who starves the hook makes the whole call revert, so the answer can never be skipped.
    function canBorrow(address h, bytes memory data) external view returns (bool) {
        if (h.code.length == 0) return false;
        if (gasleft() < HOOK_GAS * 64 / 63 + HOOK_OVERHEAD) revert HookStarved();
        bool ok;
        uint256 word;
        uint256 g = HOOK_GAS;
        assembly {
            ok := staticcall(g, h, add(data, 0x20), mload(data), 0, 0)
            if and(ok, gt(returndatasize(), 31)) {
                returndatacopy(0, 0, 32)
                word := mload(0)
            }
        }
        if (!ok && gasleft() <= HOOK_GAS / 63) revert HookStarved();
        return ok && word == 1;
    }

    /// @notice Tells a backer's hook what happened. A hook that fails never blocks the pool (unless starved on
    ///         purpose, which reverts so the call can be retried with enough gas).
    function notify(address h, bytes memory data) external returns (bool ok) {
        if (h.code.length == 0) return true;
        if (gasleft() < HOOK_GAS * 64 / 63 + HOOK_OVERHEAD) revert HookStarved();
        uint256 g = HOOK_GAS;
        assembly {
            ok := call(g, h, 0, add(data, 0x20), mload(data), 0, 0)
        }
        if (!ok && gasleft() <= HOOK_GAS / 63) revert HookStarved();
    }
}
