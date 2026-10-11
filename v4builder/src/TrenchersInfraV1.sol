// SPDX-License-Identifier: MIT
// Derived from Programmable module-foundation (MIT), github.com/programmablehq/PROGRAMMABLE. Adapted for Trenchers.
pragma solidity 0.8.26;

interface ILocalInfraV1 {
    function manager() external view returns (address);
    function positions() external view returns (address);
    function router() external view returns (address);
    function permit2() external view returns (address);
    function wrappedEth() external view returns (address);
}

/// @notice The only place Uniswap v4 infrastructure is named. On Robinhood Chain (4663) every address and runtime
/// code hash is pinned to the official deployment. On a local test chain (31337) the addresses come from a local
/// registry and are checked against their own runtime, so the same contracts can be tested end to end offline.
/// Every other chain is refused.
library TrenchersInfraV1 {
    struct Infra {
        address manager;
        address positions;
        address router;
        address permit2;
        address wrappedEth;
        bytes32 managerHash;
        bytes32 positionsHash;
        bytes32 routerHash;
        bytes32 permit2Hash;
        bytes32 wrappedEthHash;
    }

    /// @dev Where a local test chain keeps its infrastructure registry. Never used on Robinhood Chain.
    address internal constant LOCAL_REGISTRY = 0x0000000000000000000000000000000000Ba5e00;

    error UnsupportedChain();

    function current() internal view returns (Infra memory i) {
        if (block.chainid == 4663) {
            i.manager = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
            i.positions = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
            i.router = 0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99;
            i.permit2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
            i.wrappedEth = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
            i.managerHash = 0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626;
            i.positionsHash = 0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2;
            i.routerHash = 0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5;
            i.permit2Hash = 0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca;
            i.wrappedEthHash = 0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353;
        } else if (block.chainid == 31337 && LOCAL_REGISTRY.code.length != 0) {
            ILocalInfraV1 r = ILocalInfraV1(LOCAL_REGISTRY);
            i.manager = r.manager();
            i.positions = r.positions();
            i.router = r.router();
            i.permit2 = r.permit2();
            i.wrappedEth = r.wrappedEth();
            i.managerHash = i.manager.codehash;
            i.positionsHash = i.positions.codehash;
            i.routerHash = i.router.codehash;
            i.permit2Hash = i.permit2.codehash;
            i.wrappedEthHash = i.wrappedEth.codehash;
        } else {
            revert UnsupportedChain();
        }
    }
}
