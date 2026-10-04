import type { TESTNET_DEPLOYMENT } from "../testnet/deployment";

/** The Trenchers contracts on Robinhood Chain mainnet (deployed 4 October 2026, owned by the team Safe). */
export const MAINNET_DEPLOYMENT: NonNullable<typeof TESTNET_DEPLOYMENT> = {
  chainId: 4663,
  owner: "0xF928e1A70d0CBf092193D4E3FE4F68edfffe4b10",
  registry: "0x000000006551c19487814612e58FE06813775758",
  splitter: "0x30e18147b56c011a76379241aa5abda1d7467741",
  nft: "0xe4b9a60b78c90fca0dcb79d8f1cbca43ef33c83e",
  fund: "0x24bc32bbba4f4ff20b31402dea2bbc63db1579d9",
  launchpad: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  adapter: "0x229671b3464f7b01175d93dbc4ad71e02f05baef",
  startBlock: "80212654",
  config: "0xb9b1483e27f6742b83217c490991edf0f9b42d57",
  logic: "0xe51488ddf620da0de53465520dbf3d95dddfff4d",
  impl: "0x6e43c01f05d8bb00ce134ca52f410bd3ca0c821d",
  dist: "0x3926a801b52cf28c2cb0f5199cf7ec55f45ede1a",
  version: 1,
};
