// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test stand-in for Programmable's Module Mode (Foundation) V2 native factory on Robinhood Chain: the same
///      launchWithEthRoute(LaunchParams, bytes) signature and LaunchResultV2 layout, a hook and a fee ledger with the
///      same getters. The first buy costs `initialBuyQuoteAmount` wei of ETH (as if routed into the quote) and the rest
///      of msg.value is refunded to the caller in the same call, like the real factory.
contract MockFoundationToken is ERC20 {
    string public website;
    constructor(string memory n, string memory s, string memory site, address to, uint256 supply) ERC20(n, s) { website = site; _mint(to, supply); }
}

contract MockFoundationLedger {
    address public hook; address public quote; address public creator;
    uint256 public creatorCredited; uint256 public creatorClaimed;
    constructor(address hook_, address quote_, address creator_) { hook = hook_; quote = quote_; creator = creator_; }
    /// @dev Test helper: fees earned (the quote tokens must already be here).
    function credit(uint256 amount) external { creatorCredited += amount; }
    function claimCreator() external returns (uint256 amount) {
        amount = creatorCredited - creatorClaimed;
        creatorClaimed += amount;
        ERC20(quote).transfer(creator, amount);
    }
}

contract MockFoundationHook {
    address public initializer; address public token; address public quote; address public creator; address public ledger;
    address public lastActionCaller; uint256 public lastActionIndex; bytes public lastActionData;
    constructor(address initializer_, address token_, address quote_, address creator_) {
        initializer = initializer_; token = token_; quote = quote_; creator = creator_;
    }
    function setLedger(address l) external { require(ledger == address(0)); ledger = l; }
    function executeModuleAction(uint256 index, bytes calldata data) external {
        lastActionCaller = msg.sender; lastActionIndex = index; lastActionData = data;
    }
}

contract MockFoundationFactory {
    struct Metadata { string name; string symbol; string description; string imageURI; string website; bytes socialData; }
    struct ModuleSelection { address factory; bytes32 factoryCodeHash; bytes32 moduleCodeHash; bytes32 descriptorHash; bytes configuration; uint16 creatorShareBps; }
    struct LaunchParams {
        Metadata metadata; address quote; uint8 quoteDecimals; int24 initialTick; uint16 creatorFeeBps;
        uint128 additionalQuoteAmount; uint128 initialBuyQuoteAmount; uint128 initialBuyMinimumTokenAmount;
        uint64 deadline; bytes32 tokenSalt; bytes32 hookSalt; ModuleSelection[] modules;
    }
    struct LaunchResultV2 {
        address token; address hook; address ledger; bytes32 poolId;
        address basePositionOwner; address creatorPositionOwner; address roundingInventoryRecipient;
        uint256 basePositionId; uint256 creatorPositionId; uint256 initialBuyTokenAmount;
        uint128 baseTokenPrincipal; uint128 baseTokenRounding; uint128 creatorQuotePrincipal; uint256 actualQuoteRefund;
    }
    mapping(address => LaunchResultV2) private _launches;
    event FoundationLaunchedV2(address indexed token, address indexed creator, bytes32 indexed poolId, address hook, address ledger, address quote, bytes32 metadataHash, bytes32 compositionHash, bytes32 custodyId, uint256 initialBuyQuoteAmount, LaunchResultV2 result);
    /// @dev Test switch: 1 = record a different creator in the hook, 2 = report a different token than launched.
    uint8 public evil;
    function setEvil(uint8 e) external { evil = e; }

    function launchWithEthRoute(LaunchParams calldata p, bytes calldata fundingPath) external payable returns (LaunchResultV2 memory r) {
        require(fundingPath.length > 0, "path");
        require(msg.value >= p.initialBuyQuoteAmount, "budget");
        MockFoundationToken t = new MockFoundationToken(p.metadata.name, p.metadata.symbol, p.metadata.website, address(this), 1e27);
        MockFoundationHook h = new MockFoundationHook(address(this), address(t), p.quote, evil == 1 ? address(this) : msg.sender);
        MockFoundationLedger l = new MockFoundationLedger(address(h), p.quote, evil == 1 ? address(this) : msg.sender);
        h.setLedger(address(l));
        uint256 out = 1e24;
        t.transfer(msg.sender, out);
        r.token = address(t); r.hook = address(h); r.ledger = address(l); r.initialBuyTokenAmount = out;
        _launches[address(t)] = r;
        _announce(r, p.quote, p.initialBuyQuoteAmount);
        uint256 refund = msg.value - p.initialBuyQuoteAmount;
        if (refund > 0) { (bool ok, ) = msg.sender.call{value: refund}(""); require(ok, "refund"); }
        if (evil == 2) r.token = address(0xdead);
    }
    function _announce(LaunchResultV2 memory r, address quote, uint256 buy) internal {
        emit FoundationLaunchedV2(r.token, msg.sender, bytes32(0), r.hook, r.ledger, quote, bytes32(0), bytes32(0), bytes32(0), buy, r);
    }
    function launchOf(address token) external view returns (LaunchResultV2 memory) { return _launches[token]; }
    /// @dev The other entry point (ERC20-funded): not allowed from an agent wallet.
    function launch(LaunchParams calldata) external pure returns (LaunchResultV2 memory r) { return r; }
}
