// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./Harness.sol";

interface ICoinLauncher {
    function launch(TokenParams calldata params, uint256 launchConfigId, address expected) external payable returns (address coin);
}
interface IAgentWithdraw { function withdraw(uint256 amount) external; }
interface IOwnerWithdraw { function withdraw(address to, uint256 amount) external; }

/// @notice Agent coin launches through AgentCoinLauncher, against the real Pons V2 factory.
contract CoinLauncherTest is TrenchersHarness {
    ICoinLauncher launcher;

    function setUp() public {
        _deployLocalStack();
        _deployTrenchers();
        _awakenAgent();
        launcher = ICoinLauncher(vm.deployCode(_t("AgentCoinLauncher"), abi.encode(address(factory), fund, nft, safe)));
        vm.deal(address(this), 10 ether);
        (bool ok,) = address(launcher).call{value: 0.01 ether}(""); // the team funds launch fees
        assertTrue(ok);
        // The real mainnet path: the config is sealed, so the launcher goes live after the 48h notice.
        config.propose(2, address(launcher));
        vm.warp(block.timestamp + 48 hours + 1);
        config.execute(2);
    }

    function _data(string memory name, string memory sym, address expected) internal pure returns (bytes memory) {
        TokenParams memory p = TokenParams(name, sym, "", "", Socials("", "", "", "", ""), address(0), 0, false, bytes32(0));
        return abi.encodeCall(ICoinLauncher.launch, (p, 0, expected));
    }
    function _predict() internal view returns (address) { return vm.computeCreateAddress(launchDeployer, vm.getNonce(launchDeployer) + 1); }

    function test_AgentLaunchesWithOnlyItsStarter_TeamPaysTheFee() public {
        // Leave only the locked 0.01 ETH starter in the wallet.
        uint256 free = agent.withdrawable();
        vm.prank(holder);
        IAgentWithdraw(address(agent)).withdraw(free);
        assertEq(address(agent).balance, 0.01 ether);
        address expected = _predict();
        uint256 subsidy = address(launcher).balance;
        vm.prank(holder);
        agent.launchCoin(_data("Agent Six", "SIX", expected), 0, expected);
        assertEq(agent.coin(), expected, "coin recorded");
        LaunchedToken memory rec = factory.getLaunchedToken(expected);
        assertEq(rec.token, expected, "it is the real Pons coin");
        assertEq(rec.creatorFeeRecipient, address(agent), "creator fees go to the agent wallet");
        assertEq(rec.pairToken, address(0), "ETH-paired");
        assertEq(address(agent).balance, 0.01 ether, "the starter is untouched");
        assertEq(subsidy - address(launcher).balance, LAUNCH_FEE, "Trenchers paid the launch fee");
        // The engine can never trade the agent's own coin; others can, which earns the agent creator fees.
        vm.warp(block.timestamp + 60);
        vm.prank(engine);
        vm.expectRevert(_callFailed(abi.encodeWithSelector(IErrs.OwnCoin.selector)));
        agent.trade(0.005 ether, abi.encodeCall(IAdapter.buy, (expected, 0)));
        vm.prank(whale);
        assertGt(adapter.buy{value: 0.5 ether}(expected, 0), 0);
        // Once only.
        vm.prank(holder);
        vm.expectRevert(IErrs.NotAllowed.selector);
        agent.launchCoin(_data("Again", "AGN", _predict()), 0, _predict());
    }

    function test_AgentPaysItselfIfItSendsETH_ExtraRefunded() public {
        address expected = _predict();
        uint256 before = address(agent).balance;
        uint256 subsidy = address(launcher).balance;
        vm.prank(holder);
        agent.launchCoin(_data("Agent Six", "SIX", expected), LAUNCH_FEE * 3, expected);
        assertEq(before - address(agent).balance, LAUNCH_FEE, "only the fee left the agent, the rest came back");
        assertEq(address(launcher).balance, subsidy, "team money untouched");
    }

    function test_OnlyGenuineAgents_NoDrainingTheFeeMoney() public {
        vm.prank(creator);
        vm.expectRevert(bytes4(keccak256("NotAnAgent()")));
        launcher.launch(_params("Mine", "MINE", creator, 0, false), 0, address(0));
    }

    function test_NoFeeMoney_ClearRevert_NothingRecorded() public {
        vm.prank(safe);
        IOwnerWithdraw(address(launcher)).withdraw(safe, address(launcher).balance);
        address expected = _predict();
        vm.prank(holder);
        vm.expectRevert();
        agent.launchCoin(_data("Agent Six", "SIX", expected), 0, expected);
        assertEq(agent.coin(), address(0));
    }

    function test_SomeoneElseLaunchesFirst_NothingRecordedNothingSpent() public {
        address expected = _predict();
        vm.prank(creator);
        factory.launchToken{value: LAUNCH_FEE}(_params("Other", "OTH", creator, 0, false), 0, address(0));
        uint256 before = address(agent).balance;
        uint256 subsidy = address(launcher).balance;
        vm.prank(holder);
        vm.expectRevert(); // AgentCoinLauncher.WrongCoin, bubbled up through the agent wallet
        agent.launchCoin(_data("Agent Six", "SIX", expected), 0, expected);
        assertEq(agent.coin(), address(0), "no wrong coin recorded");
        assertEq(address(agent).balance, before, "nothing spent");
        assertEq(address(launcher).balance, subsidy, "no fee spent");
        address again = _predict();
        vm.prank(holder);
        agent.launchCoin(_data("Agent Six", "SIX", again), 0, again);
        assertEq(agent.coin(), again);
    }

    function test_OnlyTheHolderCanLaunch() public {
        address expected = _predict();
        vm.prank(engine);
        vm.expectRevert(bytes4(keccak256("NotHolder()")));
        agent.launchCoin(_data("X", "X", expected), 0, expected);
    }
}
