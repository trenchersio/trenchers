// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IAgentLogicConfig {
    function accountLogic() external view returns (address);
    function isAccountLogic(address logic) external view returns (bool);
}

/// @title TrenchersAgentWallet
/// @notice The ERC-6551 implementation every agent wallet is created from.
///
///         Not upgradeable by default: every agent wallet runs the original agent wallet code
///         (TrenchersAgentAccount, fixed in this contract's bytecode at deployment) and nobody,
///         including the team, can change that.
///
///         Holder opt-in: if a bug is ever found, the team can offer a fixed version through
///         AgentConfig (announced publicly, 48-hour timelock). Nothing changes for any agent unless its
///         holder chooses to switch with setAgentVersion. The holder can switch back to the original
///         or any other offered version at any time. Wallet addresses, balances and track records stay.
///
/// @dev    Storage: offered versions must keep the original storage layout and only append.
///         The chosen version lives in its own hashed slot, so it never collides with wallet storage.
contract TrenchersAgentWallet {
    IAgentLogicConfig private immutable CONFIG;
    /// @notice The original agent wallet code, fixed forever. Every wallet runs it unless its holder opts in to another.
    address public immutable ORIGINAL_VERSION;
    /// @dev keccak256("trenchers.agent.pinnedLogic") - 1
    bytes32 private constant VERSION_SLOT = 0xb7b5a01d4aafd4bfc48752d90fbca5d48b765dd637cd324b455d0308dee35ef8;

    event AgentVersionChosen(address indexed holder, address indexed logic);

    error NotHolder();
    error UnknownVersion();
    error NoLogic();

    constructor(IAgentLogicConfig config_) {
        CONFIG = config_;
        ORIGINAL_VERSION = config_.accountLogic();
        if (ORIGINAL_VERSION == address(0)) revert NoLogic();
    }

    /// @notice The agent wallet code this wallet runs: the original, unless its holder opted in to another.
    function agentLogic() public view returns (address l) {
        l = chosenAgentVersion();
        if (l == address(0)) l = ORIGINAL_VERSION;
    }

    /// @notice The version the holder opted in to, or 0 (the original).
    function chosenAgentVersion() public view returns (address l) {
        bytes32 slot = VERSION_SLOT;
        assembly { l := sload(slot) }
    }

    /// @notice Holder only: switch this wallet to a version the team has publicly offered, or back to
    ///         the original (pass the original's address or 0).
    function setAgentVersion(address logic) external {
        if (msg.sender != _holder()) revert NotHolder();
        if (logic == ORIGINAL_VERSION) logic = address(0);
        if (logic != address(0) && !CONFIG.isAccountLogic(logic)) revert UnknownVersion();
        bytes32 slot = VERSION_SLOT;
        assembly { sstore(slot, logic) }
        emit AgentVersionChosen(msg.sender, logic == address(0) ? ORIGINAL_VERSION : logic);
    }

    function _holder() internal view returns (address) {
        bytes memory footer = new bytes(0x60);
        assembly { extcodecopy(address(), add(footer, 0x20), 0x4d, 0x60) }
        (uint256 chainId, address tokenContract, uint256 tokenId) = abi.decode(footer, (uint256, address, uint256));
        if (chainId != block.chainid) return address(0);
        return IERC721(tokenContract).ownerOf(tokenId);
    }

    receive() external payable { _delegate(); }
    fallback() external payable { _delegate(); }

    function _delegate() internal {
        address l = agentLogic();
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), l, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok case 0 { revert(0, returndatasize()) } default { return(0, returndatasize()) }
        }
    }
}
