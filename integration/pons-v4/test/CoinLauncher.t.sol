// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./Harness.sol";

interface ICoinLauncher {
    function launch(TokenParams calldata params, uint256 launchConfigId, address expected) external payable returns (address coin);
}
interface IAgentWithdraw { function withdraw(uint256 amount) external; }

/// @notice Agent coin launches through AgentCoinLauncher, against the real Pons V2 factory.
contract CoinLauncherTest is TrenchersHarness {
    ICoinLauncher launcher;

    function setUp() public {
        _deployLocalStack();
        _deployTrenchers();
        _awakenAgent();
        launcher = ICoinLauncher(vm.deployCode(_t("AgentCoinLauncher"), abi.encode(address(factory))));
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

    function test_AgentLaunchesItsOwnCoin() public {
        address expected = _predict();
        uint256 before = address(agent).balance;
        vm.prank(holder);
        agent.launchCoin(_data("Agent Six", "SIX", expected), LAUNCH_FEE, expected);
        assertEq(agent.coin(), expected, "coin recorded");
        LaunchedToken memory rec = factory.getLaunchedToken(expected);
        assertEq(rec.token, expected, "it is the real Pons coin");
        assertEq(rec.creatorFeeRecipient, address(agent), "creator fees go to the agent wallet");
        assertEq(rec.pairToken, address(0), "ETH-paired");
        assertEq(before - address(agent).balance, LAUNCH_FEE, "only the launch fee was spent");
        // The engine can never trade the agent's own coin.
        vm.warp(block.timestamp + 60);
        vm.prank(engine);
        vm.expectRevert(_callFailed(abi.encodeWithSelector(IErrs.OwnCoin.selector)));
        agent.trade(0.01 ether, abi.encodeCall(IAdapter.buy, (expected, 0)));
        // Others can trade it, and that earns the agent creator fees.
        vm.prank(whale);
        assertGt(adapter.buy{value: 0.5 ether}(expected, 0), 0);
        // Once only.
        vm.prank(holder);
        vm.expectRevert(IErrs.NotAllowed.selector);
        agent.launchCoin(_data("Again", "AGN", _predict()), LAUNCH_FEE, _predict());
    }

    function test_SomeoneElseLaunchesFirst_NothingRecordedNothingSpent() public {
        address expected = _predict();
        // Another Pons launch lands first and takes that address.
        vm.prank(creator);
        factory.launchToken{value: LAUNCH_FEE}(_params("Other", "OTH", creator, 0, false), 0, address(0));
        uint256 before = address(agent).balance;
        vm.prank(holder);
        vm.expectRevert(); // AgentCoinLauncher.WrongCoin, bubbled up through the agent wallet
        agent.launchCoin(_data("Agent Six", "SIX", expected), LAUNCH_FEE, expected);
        assertEq(agent.coin(), address(0), "no wrong coin recorded");
        assertEq(address(agent).balance, before, "nothing spent");
        // Retry with a fresh prediction works.
        address again = _predict();
        vm.prank(holder);
        agent.launchCoin(_data("Agent Six", "SIX", again), LAUNCH_FEE, again);
        assertEq(agent.coin(), again);
        assertEq(factory.getLaunchedToken(again).creatorFeeRecipient, address(agent));
    }

    function test_LaunchFeeComesFromFreeBalance_NotTheStarter() public {
        // Leave only the locked 0.01 ETH starter in the wallet: the launch must be refused.
        uint256 free = agent.withdrawable();
        vm.prank(holder);
        IAgentWithdraw(address(agent)).withdraw(free);
        assertEq(address(agent).balance, 0.01 ether);
        address expected = _predict();
        vm.prank(holder);
        vm.expectRevert();
        agent.launchCoin(_data("Agent Six", "SIX", expected), LAUNCH_FEE, expected);
        assertEq(agent.coin(), address(0));
    }

    function test_OnlyTheHolderCanLaunch() public {
        address expected = _predict();
        vm.prank(engine);
        vm.expectRevert(bytes4(keccak256("NotHolder()")));
        agent.launchCoin(_data("X", "X", expected), LAUNCH_FEE, expected);
    }
}
