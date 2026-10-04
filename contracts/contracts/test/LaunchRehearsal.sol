// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRhNft {
    function setMintOpen(bool open) external;
    function mint(uint256 quantity) external payable;
    function mintPrice() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function tokenURI(uint256 id) external view returns (string memory);
    function ownerOf(uint256 id) external view returns (address);
}
interface IRhFund {
    function setAccount(address impl, bytes32 salt) external;
    function claim(uint256 id) external;
    function agentWallet(uint256 id) external view returns (address);
    function accountImplementation() external view returns (address);
}
interface IRhRegistry {
    function createAccount(address impl, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) external returns (address);
}
interface IRhSplitter {
    function release(uint8 bucket) external;
    function owed(uint8 bucket) external view returns (uint256);
}
interface IRhAgent {
    function setPolicy(uint128 perTrade, uint128 dailyCap, bool live, bytes32 ruleHash, string calldata ruleUri) external;
    function pause() external;
    function trade(uint256 value, bytes calldata data) external returns (bytes memory);
    function approveRouter(address token, uint256 amount) external;
    function withdraw(uint256 amount) external;
    function lockedNow() external view returns (uint256);
    function withdrawable() external view returns (uint256);
}
interface IRhAdapter {
    function buy(address token, uint256 minTokensOut) external payable returns (uint256);
    function sell(address token, uint256 tokensIn, uint256 minEthOut) external returns (uint256);
}
interface IRhConfig { function pause() external; }

/// @dev Stand-in code for a team EOA inside an eth_call (state override): forwards a call so that it
///      comes from that EOA's address. Never deployed.
contract Forwarder {
    function fwd(address to, uint256 value, bytes calldata data) external payable returns (bytes memory r) {
        bool ok;
        (ok, r) = to.call{value: value}(data);
        if (!ok) assembly { revert(add(r, 32), mload(r)) }
    }
    receive() external payable {}
}

/// @dev The whole launch, simulated against the live mainnet contracts in one eth_call (state overrides
///      put this code at the team Safe's address and Forwarder code at the engine, guardian and Deployer):
///      the Safe opens awakening and the mint, a holder mints and awakens, sets limits, the engine buys
///      and sells real Pons coins (curve and Uniswap pool), a house agent trades and withdraws, the
///      holder's pause and the guardian's emergency stop both block trading, and the dev share reaches
///      the Safe. Nothing is sent; uses no storage (the Safe's storage stays untouched).
contract LaunchRehearsal {
    struct A {
        address nft; address fund; address splitter; address config; address impl; address adapter; address registry;
        address engine; address guardian; address deployer; address curveCoin; address poolCoin;
    }
    error Failed(string step, bytes reason);

    function _do(string memory step, address from, address to, uint256 value, bytes memory data) internal returns (bytes memory r) {
        bool ok;
        if (from == address(this)) (ok, r) = to.call{value: value}(data);
        else (ok, r) = from.call(abi.encodeCall(Forwarder.fwd, (to, value, data)));
        if (!ok) revert Failed(step, r);
        if (from != address(this)) r = abi.decode(r, (bytes));
    }
    function _fails(address from, address to, bytes memory data) internal returns (uint256) {
        (bool ok, ) = from.call(abi.encodeCall(Forwarder.fwd, (to, 0, data)));
        return ok ? 0 : 1;
    }

    /// @dev Buys with `eth` through the agent, then sells everything back. Returns (tokens, agent ETH after).
    function _roundTrip(string memory what, A memory a, address agent, address coin, uint256 eth) internal returns (uint256 tokens, uint256 after_) {
        _do(string.concat(what, ": engine buy"), a.engine, agent, 0, abi.encodeCall(IRhAgent.trade, (eth, abi.encodeCall(IRhAdapter.buy, (coin, 0)))));
        tokens = IERC20(coin).balanceOf(agent);
        if (tokens == 0) revert Failed(string.concat(what, ": bought nothing"), "");
        _do(string.concat(what, ": approve"), a.engine, agent, 0, abi.encodeCall(IRhAgent.approveRouter, (coin, tokens)));
        _do(string.concat(what, ": engine sell"), a.engine, agent, 0, abi.encodeCall(IRhAgent.trade, (0, abi.encodeCall(IRhAdapter.sell, (coin, tokens, 0)))));
        if (IERC20(coin).balanceOf(agent) != 0) revert Failed(string.concat(what, ": coins left after sell"), "");
        after_ = agent.balance;
    }

    /// @return n  [0 id, 1 agent balance after awakening, 2 locked, 3 curve tokens, 4 agent ETH after curve trip,
    ///             5 pool tokens, 6 agent ETH after pool trip, 7 holder withdrew, 8 holder pause blocks (1),
    ///             9 house tokens, 10 house ETH withdrawn to Deployer, 11 dev share reached Safe,
    ///             12 guardian stop blocks (1), 13 starter fund received at mint]
    function run(A calldata a) external payable returns (uint256[] memory n, string memory uriBefore, string memory uriAfter) {
        n = new uint256[](14);
        address agent;
        (agent, uriBefore, uriAfter) = _mintAndAwaken(a, n);
        _trade(a, agent, n);
        _house(a, n);
        _stops(a, agent, n);
    }

    /// 1. The Safe's two transactions, then a holder (here: this address) mints one and awakens it.
    function _mintAndAwaken(A calldata a, uint256[] memory n) internal returns (address agent, string memory uriBefore, string memory uriAfter) {
        IRhNft nft = IRhNft(a.nft);
        if (IRhFund(a.fund).accountImplementation() == address(0)) _do("Safe: open awakening", address(this), a.fund, 0, abi.encodeCall(IRhFund.setAccount, (a.impl, bytes32(0))));
        else if (IRhFund(a.fund).accountImplementation() != a.impl) revert Failed("awakening opened with the wrong wallet code", "");
        _do("Safe: open the mint", address(this), a.nft, 0, abi.encodeCall(IRhNft.setMintOpen, (true)));
        uint256 id = nft.totalSupply() + 1;
        uint256 fundBefore = a.fund.balance;
        _do("mint", address(this), a.nft, nft.mintPrice(), abi.encodeCall(IRhNft.mint, (1)));
        n[13] = a.fund.balance - fundBefore;
        if (nft.ownerOf(id) != address(this)) revert Failed("mint: wrong owner", "");
        uriBefore = nft.tokenURI(id);
        _do("awaken (claim)", address(this), a.fund, 0, abi.encodeCall(IRhFund.claim, (id)));
        uriAfter = nft.tokenURI(id);
        agent = IRhFund(a.fund).agentWallet(id);
        n[0] = id; n[1] = agent.balance; n[2] = IRhAgent(agent).lockedNow();
    }

    /// 2. Limits, real trades through the engine, and the holder's withdrawal of the free balance.
    function _trade(A calldata a, address agent, uint256[] memory n) internal {
        _do("set limits", address(this), agent, 0, abi.encodeCall(IRhAgent.setPolicy, (0.005 ether, 0.02 ether, true, keccak256("rehearsal"), "rehearsal")));
        (n[3], n[4]) = _roundTrip("curve coin", a, agent, a.curveCoin, 0.004 ether);
        if (a.poolCoin != address(0)) (n[5], n[6]) = _roundTrip("pool coin", a, agent, a.poolCoin, 0.004 ether);
        _do("top up agent", address(this), agent, 0.003 ether, "");
        uint256 w = IRhAgent(agent).withdrawable();
        uint256 mine = address(this).balance;
        _do("holder withdraw", address(this), agent, 0, abi.encodeCall(IRhAgent.withdraw, (w)));
        n[7] = address(this).balance - mine;
    }

    /// 3. House agent #1 (held by the Deployer): wallet, funding, trade, full withdrawal.
    function _house(A calldata a, uint256[] memory n) internal {
        IRhRegistry(a.registry).createAccount(a.impl, bytes32(0), block.chainid, a.nft, 1);
        address house = IRhFund(a.fund).agentWallet(1);
        if (house.balance > 0) _do("house: withdraw existing", a.deployer, house, 0, abi.encodeCall(IRhAgent.withdraw, (IRhAgent(house).withdrawable())));
        _do("fund house agent", address(this), house, 0.01 ether, "");
        _do("house: set limits", a.deployer, house, 0, abi.encodeCall(IRhAgent.setPolicy, (0.005 ether, 0.02 ether, true, keccak256("house"), "house")));
        (n[9], ) = _roundTrip("house agent", a, house, a.curveCoin, 0.004 ether);
        uint256 dep = a.deployer.balance;
        _do("house: withdraw all", a.deployer, house, 0, abi.encodeCall(IRhAgent.withdraw, (house.balance)));
        n[10] = a.deployer.balance - dep;
    }

    /// 4. The holder's pause and the guardian's emergency stop both block the engine; the dev share reaches the Safe.
    function _stops(A calldata a, address agent, uint256[] memory n) internal {
        bytes memory buy = abi.encodeCall(IRhAgent.trade, (0.001 ether, abi.encodeCall(IRhAdapter.buy, (a.curveCoin, 0))));
        _do("holder pause", address(this), agent, 0, abi.encodeCall(IRhAgent.pause, ()));
        n[8] = _fails(a.engine, agent, buy);
        uint256 safeBefore = address(this).balance;
        if (IRhSplitter(a.splitter).owed(1) > 0) _do("release dev share", address(this), a.splitter, 0, abi.encodeCall(IRhSplitter.release, (1)));
        n[11] = address(this).balance - safeBefore;
        _do("set limits again", address(this), agent, 0, abi.encodeCall(IRhAgent.setPolicy, (0.005 ether, 0.02 ether, true, bytes32(0), "")));
        _do("guardian stop", a.guardian, a.config, 0, abi.encodeCall(IRhConfig.pause, ()));
        n[12] = _fails(a.engine, agent, buy);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) { return this.onERC721Received.selector; }
    receive() external payable {}
}
