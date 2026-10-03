// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title AgentConfig
/// @notice Shared settings every Trenchers agent wallet reads: which trading engine may trade for
///         agents, which router it may trade through, which launcher agents use for their coins and
///         where starter balances come from. Owned by the team Safe; every change after the first
///         setting waits behind a 48-hour timelock, so holders can pause their agents first.
contract AgentConfig is Ownable {
    enum Key { Engine, Router, Launcher, StarterFund }

    uint256 public constant TIMELOCK = 48 hours;

    mapping(Key => address) public get;
    struct Pending { address value; uint64 eta; }
    mapping(Key => Pending) public pending;

    event Set(Key indexed key, address value);
    event Proposed(Key indexed key, address value, uint256 eta);

    error ZeroAddress();
    error NoPending();
    error TooEarly();

    constructor(address owner_) { _transferOwnership(owner_); }

    function engine() external view returns (address) { return get[Key.Engine]; }
    function router() external view returns (address) { return get[Key.Router]; }
    function launcher() external view returns (address) { return get[Key.Launcher]; }
    function starterFund() external view returns (address) { return get[Key.StarterFund]; }

    /// @notice First setting of an empty key is immediate; changing a set key needs the timelock.
    function propose(Key key, address value) external onlyOwner {
        if (value == address(0)) revert ZeroAddress();
        if (get[key] == address(0)) { get[key] = value; emit Set(key, value); return; }
        uint64 eta = uint64(block.timestamp + TIMELOCK);
        pending[key] = Pending(value, eta);
        emit Proposed(key, value, eta);
    }

    function execute(Key key) external onlyOwner {
        Pending memory p = pending[key];
        if (p.value == address(0)) revert NoPending();
        if (block.timestamp < p.eta) revert TooEarly();
        delete pending[key];
        get[key] = p.value;
        emit Set(key, p.value);
    }

    function cancel(Key key) external onlyOwner { delete pending[key]; }
}
