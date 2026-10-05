// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./Harness.sol";

interface IAgentV2 {
    function launchCoin(TokenParams calldata params, uint256 launchConfigId) external returns (address coin, address curve);
    function claimCoinFees() external returns (uint256);
    function withdraw(uint256 amount) external;
    function VERSION() external view returns (uint256);
    function ruleVersion() external view returns (uint32);
    function policy() external view returns (uint128, uint128, bool, address);
}
interface IWalletProxy {
    function setAgentVersion(address logic) external;
    function agentLogic() external view returns (address);
    function ORIGINAL_VERSION() external view returns (address);
}
interface IV2Errs { error NotHolder(); error NotAllowed(); error UnknownVersion(); }

/// @notice Agent wallet version 2 against the real Pons V2 factory: the agent wallet itself deploys its coin.
contract AgentWalletV2Test is TrenchersHarness {
    address v2;

    function setUp() public {
        _deployLocalStack();
        _deployTrenchers();      // launcher (key 2) = the Pons factory, as on mainnet after the switch
        _awakenAgent();          // Trencher #6, 0.01 ETH starter + 3 ETH free, a rule applied
        v2 = vm.deployCode(_t("TrenchersAgentAccountV2"), abi.encode(address(config), fund));
        // The real mainnet path: the config is sealed, so the new version is offered after the 48h notice.
        config.propose(4, v2);
        vm.warp(block.timestamp + 48 hours + 1);
        config.execute(4);
    }

    function _p(string memory name, string memory sym, address feeTo) internal pure returns (TokenParams memory) {
        return TokenParams(name, sym, "ipfs://logo", "Trencher #6's coin", Socials("", "", "", "https://trenchers.io", ""), feeTo, CREATOR_TAX, false, bytes32(0));
    }
    function _optIn() internal {
        vm.prank(holder);
        IWalletProxy(address(agent)).setAgentVersion(v2);
        assertEq(IWalletProxy(address(agent)).agentLogic(), v2);
        assertEq(IAgentV2(address(agent)).VERSION(), 2);
    }

    function test_OptInKeepsEverything() public {
        uint256 bal = address(agent).balance;
        (uint128 pt, uint128 dc, bool live, address by) = IAgentV2(address(agent)).policy();
        uint32 rv = IAgentV2(address(agent)).ruleVersion();
        _optIn();
        assertEq(address(agent).balance, bal, "balance");
        (uint128 pt2, uint128 dc2, bool live2, address by2) = IAgentV2(address(agent)).policy();
        assertEq(pt2, pt); assertEq(dc2, dc); assertEq(live2, live); assertEq(by2, by);
        assertEq(IAgentV2(address(agent)).ruleVersion(), rv, "rule history");
        assertEq(agent.starterLocked(), 0.01 ether, "starter lock");
        assertEq(agent.lockedNow(), 0.01 ether);
        // and back to the original
        vm.prank(holder);
        IWalletProxy(address(agent)).setAgentVersion(address(0));
        assertEq(IWalletProxy(address(agent)).agentLogic(), IWalletProxy(address(agent)).ORIGINAL_VERSION());
    }

    function test_OnlyTheHolderCanOptIn() public {
        vm.prank(whale);
        vm.expectRevert(IV2Errs.NotHolder.selector);
        IWalletProxy(address(agent)).setAgentVersion(v2);
    }

    function test_AgentWalletDeploysItsCoin_WithOnlyItsStarter() public {
        _optIn();
        // Leave only the locked 0.01 ETH starter in the wallet.
        uint256 free = agent.withdrawable();
        vm.prank(holder);
        IAgentV2(address(agent)).withdraw(free);
        assertEq(address(agent).balance, 0.01 ether);

        vm.recordLogs();
        vm.prank(holder);
        // The holder even tries to send the creator fees to themselves: the wallet overrides it.
        (address coin, address c) = IAgentV2(address(agent)).launchCoin(_p("Agent Six", "SIX", holder), 0);

        LaunchedToken memory rec = factory.getLaunchedToken(coin);
        assertTrue(rec.exists, "a real Pons coin");
        assertEq(rec.curve, c);
        assertEq(rec.deployer, address(agent), "the agent wallet is the coin's deployer");
        assertEq(rec.creatorFeeRecipient, address(agent), "and its creator (fees, creator controls)");
        assertEq(rec.pairToken, address(0), "ETH-paired");
        assertEq(agent.coin(), coin, "recorded from Pons's own return value");
        assertEq(address(agent).balance, 0.01 ether - LAUNCH_FEE, "the fee came out of the starter");
        assertEq(agent.withdrawable(), 0, "nothing of the starter became withdrawable");
        assertEq(agent.starterLocked(), 0.01 ether - LAUNCH_FEE, "the locked starter shrank by the fee it paid");

        // Pons's own TokenLaunched event names the agent wallet as deployer (what explorers and GMGN show).
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool seen;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(factory) && logs[i].topics.length >= 4 && address(uint160(uint256(logs[i].topics[1]))) == coin) {
                assertEq(address(uint160(uint256(logs[i].topics[3]))), address(agent), "TokenLaunched deployer");
                seen = true;
            }
        }
        assertTrue(seen, "TokenLaunched");

        // Once only.
        vm.prank(holder);
        vm.expectRevert(IV2Errs.NotAllowed.selector);
        IAgentV2(address(agent)).launchCoin(_p("Again", "AGN", address(0)), 0);

        // The engine can never trade the agent's own coin.
        vm.warp(block.timestamp + 60);
        vm.prank(engine);
        vm.expectRevert(_callFailed(abi.encodeWithSelector(IErrs.OwnCoin.selector)));
        agent.trade(0.001 ether, abi.encodeCall(IAdapter.buy, (coin, 0)));

        // Others trade it: creator fees build up for the agent, which collects them during the starter lock.
        vm.prank(whale);
        assertGt(adapter.buy{value: 1 ether}(coin, 0), 0);
        uint256 before = address(agent).balance;
        vm.prank(whale); // anyone may trigger the collection; the ETH can only go to the agent wallet
        uint256 got = IAgentV2(address(agent)).claimCoinFees();
        assertGt(got, 0, "creator fees collected");
        assertEq(address(agent).balance, before + got);
        assertEq(agent.withdrawable(), got, "collected fees are free balance");
        vm.prank(holder);
        IAgentV2(address(agent)).withdraw(got);
    }

    function test_OnlyTheHolderLaunches() public {
        _optIn();
        vm.prank(whale);
        vm.expectRevert(IV2Errs.NotHolder.selector);
        IAgentV2(address(agent)).launchCoin(_p("Nope", "NOPE", address(0)), 0);
    }

    function test_NoFeesBeforeACoin() public {
        _optIn();
        vm.expectRevert(IV2Errs.NotAllowed.selector);
        IAgentV2(address(agent)).claimCoinFees();
    }

    function test_UnofferedVersionRefused() public {
        address rogue = vm.deployCode(_t("TrenchersAgentAccountV2"), abi.encode(address(config), fund));
        vm.prank(holder);
        vm.expectRevert(IV2Errs.UnknownVersion.selector);
        IWalletProxy(address(agent)).setAgentVersion(rogue);
    }
}
