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

interface IAgentToken {
    function token() external view returns (uint256 chainId, address tokenContract, uint256 tokenId);
}
interface IStarterFundWallets {
    function agentWallet(uint256 tokenId) external view returns (address);
}

/// @title AgentCoinLauncher
/// @notice The "launcher" Trenchers agent wallets use to launch their own coin on Pons
///         (TrenchersAgentAccount.launchCoin → this → PonsV2LaunchFactory.launchToken).
///         - Only genuine Trenchers agent wallets can launch, once each.
///         - Trenchers pays the Pons launch fee from this contract's balance, so an agent can launch with
///           nothing but its starter balance (the agent sends no ETH; whatever it does send covers the fee
///           first and the rest is refunded).
///         - The coin is ETH-paired and its creator fees always go to the calling agent wallet.
///         - The agent wallet records its coin's address before the launch (so the engine never trades it).
///           Pons deploys coins with CREATE, so another launch in between would shift the address: this
///           reverts unless the coin lands exactly at the expected address, so a wrong coin is never
///           recorded. On a revert nothing is spent but gas; just try again.
///         The owner (the team Safe) can take back unused launch-fee money at any time.
contract AgentCoinLauncher {
    IPonsV2LaunchFactory public immutable factory;
    IStarterFundWallets public immutable fund;
    address public immutable nft;
    address public immutable owner;
    mapping(address => bool) public launched;

    event AgentCoinLaunched(address indexed agent, uint256 indexed tokenId, address indexed coin, address curve, uint256 feePaid);
    event Funded(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    error WrongCoin(address expected, address launched);
    error NotAnAgent();
    error AlreadyLaunched();
    error NoFeeMoney(uint256 fee, uint256 available);
    error NotOwner();
    error TransferFailed();

    constructor(IPonsV2LaunchFactory factory_, IStarterFundWallets fund_, address nft_, address owner_) {
        factory = factory_; fund = fund_; nft = nft_; owner = owner_;
    }

    receive() external payable { emit Funded(msg.sender, msg.value); }

    /// @notice Whether a launch right now would have its fee covered.
    function feeCovered() external view returns (bool) { return address(this).balance >= factory.launchFee(); }

    /// @param expected The coin address the agent wallet records (address(0) only for a dry run).
    function launch(IPonsV2LaunchFactory.TokenParams calldata params, uint256 launchConfigId, address expected)
        external payable returns (address coin)
    {
        uint256 id = _agentId(msg.sender);
        if (launched[msg.sender]) revert AlreadyLaunched();
        launched[msg.sender] = true;

        uint256 fee = factory.launchFee();
        uint256 available = address(this).balance; // includes what the agent sent
        if (available < fee) revert NoFeeMoney(fee, available);

        IPonsV2LaunchFactory.TokenParams memory p = params;
        p.creatorFeeRecipient = msg.sender; // the agent wallet earns its coin's creator fees
        address curve;
        (coin, curve) = factory.launchToken{value: fee}(p, launchConfigId, address(0));
        if (expected != address(0) && coin != expected) revert WrongCoin(expected, coin);

        // The agent's own ETH covers the fee first; anything it sent beyond that goes back.
        if (msg.value > fee) _send(msg.sender, msg.value - fee);
        emit AgentCoinLaunched(msg.sender, id, coin, curve, fee);
    }

    /// @notice The team Safe takes back unused launch-fee money.
    function withdraw(address to, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        _send(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @dev A genuine Trenchers agent wallet: an ERC-6551 account of a Trencher, at the address the starter fund derives.
    function _agentId(address wallet) internal view returns (uint256 id) {
        (bool ok, bytes memory r) = wallet.staticcall(abi.encodeCall(IAgentToken.token, ()));
        if (!ok || r.length != 96) revert NotAnAgent();
        (uint256 chainId, address tokenContract, uint256 tokenId) = abi.decode(r, (uint256, address, uint256));
        if (chainId != block.chainid || tokenContract != nft || fund.agentWallet(tokenId) != wallet) revert NotAnAgent();
        return tokenId;
    }

    function _send(address to, uint256 amount) internal {
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
