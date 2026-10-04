// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title AgentConfig
/// @notice Shared settings every Trenchers agent wallet reads: which trading engine may trade for
///         agents, which router it may trade through, which launcher agents use for their coins, where
///         starter balances come from, and which fixed agent wallet versions holders may opt in to.
///         Owned by the team Safe. Every change after the first setting waits behind a public 48-hour
///         timelock, so holders can see it coming (and pause their agent or withdraw first).
///
///         Fixing bugs after launch:
///           - Engine / Router: swap in a fixed engine or trading route (48h notice).
///           - AccountLogic:    the first value is the original agent wallet code. Later values are fixed
///                              versions offered to holders (48h notice). Agent wallets never switch on
///                              their own: each holder chooses (TrenchersAgentWallet.setAgentVersion).
///         Emergency stop: the Safe or the guardian can pause all engine trading instantly. Pausing
///         never moves funds and never blocks holders: they can still withdraw. Only the Safe unpauses.
contract AgentConfig is Ownable {
    enum Key { Engine, Router, Launcher, StarterFund, AccountLogic }

    uint256 public constant TIMELOCK = 48 hours;

    mapping(Key => address) public get;
    struct Pending { address value; uint64 eta; }
    mapping(Key => Pending) public pending;

    /// @notice Every agent wallet version that has been offered (holders may switch to any of them).
    mapping(address => bool) public isAccountLogic;
    address[] public accountLogicHistory;

    /// @notice Emergency stop for all engine trading (see above).
    bool public paused;
    /// @notice Can pause (not unpause), e.g. a team member's hot wallet for fast reaction.
    address public guardian;

    event Set(Key indexed key, address value);
    event Proposed(Key indexed key, address value, uint256 eta);
    event Cancelled(Key indexed key);
    event Paused(address indexed by, bool paused);
    event GuardianSet(address guardian);

    error ZeroAddress();
    error NoPending();
    error TooEarly();
    error NotAllowed();
    error NotContract();

    constructor(address owner_) { _transferOwnership(owner_); }

    function engine() external view returns (address) { return get[Key.Engine]; }
    function router() external view returns (address) { return get[Key.Router]; }
    function launcher() external view returns (address) { return get[Key.Launcher]; }
    function starterFund() external view returns (address) { return get[Key.StarterFund]; }
    function accountLogic() external view returns (address) { return get[Key.AccountLogic]; }
    function accountLogicVersions() external view returns (uint256) { return accountLogicHistory.length; }

    /// @notice First setting of an empty key is immediate; changing a set key needs the timelock.
    function propose(Key key, address value) external onlyOwner {
        if (value == address(0)) revert ZeroAddress();
        if (key == Key.AccountLogic && value.code.length == 0) revert NotContract();
        if (get[key] == address(0)) { _set(key, value); return; }
        uint64 eta = uint64(block.timestamp + TIMELOCK);
        pending[key] = Pending(value, eta);
        emit Proposed(key, value, eta);
    }

    function execute(Key key) external onlyOwner {
        Pending memory p = pending[key];
        if (p.value == address(0)) revert NoPending();
        if (block.timestamp < p.eta) revert TooEarly();
        delete pending[key];
        _set(key, p.value);
    }

    function cancel(Key key) external onlyOwner { delete pending[key]; emit Cancelled(key); }

    function _set(Key key, address value) internal {
        get[key] = value;
        if (key == Key.AccountLogic && !isAccountLogic[value]) { isAccountLogic[value] = true; accountLogicHistory.push(value); }
        emit Set(key, value);
    }

    // ------------------------------------------------------------------ emergency stop

    function setGuardian(address g) external onlyOwner { guardian = g; emit GuardianSet(g); }

    /// @notice Stops all engine trading at once. The Safe or the guardian.
    function pause() external {
        if (msg.sender != owner() && msg.sender != guardian) revert NotAllowed();
        paused = true;
        emit Paused(msg.sender, true);
    }

    /// @notice Resumes engine trading. The Safe only.
    function unpause() external onlyOwner { paused = false; emit Paused(msg.sender, false); }
}
