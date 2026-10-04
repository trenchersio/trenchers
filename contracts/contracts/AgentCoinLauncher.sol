// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev The Pons V2 launch factory's launch entry point (github.com/ponsdotdev/pons-labs, contractsV2).
interface IPonsV2LaunchFactory {
    struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }
    struct TokenParams {
        string name;
        string symbol;
        string logo;
        string description;
        Socials socials;
        address creatorFeeRecipient;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        bytes32 expectedEconomics;
    }
    function launchToken(TokenParams calldata params, uint256 launchConfigId, address pairToken)
        external payable returns (address token, address curve);
    function launchFee() external view returns (uint256);
}

/// @title AgentCoinLauncher
/// @notice The "launcher" Trenchers agent wallets use to launch their own coin on Pons
///         (TrenchersAgentAccount.launchCoin → this → PonsV2LaunchFactory.launchToken).
///         - The coin is always ETH-paired and its creator fees always go to the calling agent wallet.
///         - The agent wallet records its coin's address before the launch (so the engine never trades
///           it). Pons deploys coins with CREATE, so a launch by anyone else in between would shift the
///           address: this launcher reverts unless the coin lands exactly at the expected address, so a
///           wrong coin can never be recorded. On a revert nothing is spent but gas; just try again.
///         Holds no funds and has no owner.
contract AgentCoinLauncher {
    IPonsV2LaunchFactory public immutable factory;

    event AgentCoinLaunched(address indexed agent, address indexed coin, address curve);
    error WrongCoin(address expected, address launched);

    constructor(IPonsV2LaunchFactory factory_) { factory = factory_; }

    /// @param expected The coin address the agent wallet records (address(0) only for a dry run).
    function launch(IPonsV2LaunchFactory.TokenParams calldata params, uint256 launchConfigId, address expected)
        external payable returns (address coin)
    {
        IPonsV2LaunchFactory.TokenParams memory p = params;
        p.creatorFeeRecipient = msg.sender; // the agent wallet earns its coin's creator fees
        address curve;
        (coin, curve) = factory.launchToken{value: msg.value}(p, launchConfigId, address(0));
        if (expected != address(0) && coin != expected) revert WrongCoin(expected, coin);
        emit AgentCoinLaunched(msg.sender, coin, curve);
    }
}
