/** The live testnet deployment (made from trenchers.io/setup), so every device and the live Arena use it.
 *  null = use the deployment saved in this browser instead. */
export const TESTNET_DEPLOYMENT: null | {
  chainId: number; owner: `0x${string}`; registry: `0x${string}`; splitter: `0x${string}`; nft: `0x${string}`;
  fund: `0x${string}`; launchpad: `0x${string}`; adapter: `0x${string}`; startBlock: string;
  config: `0x${string}`; logic: `0x${string}`; impl: `0x${string}`; dist: `0x${string}`; version: number;
} = {
  chainId: 46630,
  owner: "0x36fc71d1cfff6fc3f5a110ca18a201cc5b5dd673",
  registry: "0x000000006551c19487814612e58FE06813775758",
  splitter: "0x134d872cd6a1ac5a5304d85730a767a80119e4e6",
  nft: "0xca5125c6e81f9074c6063826ecaad136e213fbbd",
  fund: "0xf8a28e6dbe0e19ab1fe93ded9ef2c1c6fbe242ab",
  launchpad: "0x7b32b3218f2b464a95609d2c812d3a3de64883d0",
  adapter: "0xc43c4d9d74237e42e810f8cf6ede713910674fb0",
  startBlock: "128785507",
  config: "0xa240009172807d2186d099709966d1f44125c1f6",
  logic: "0x5ec8e0f396997f4d871a1193835c571ed49c9047",
  impl: "0x9ac862b2119e7ae8464d4de99b7e799b31567afe",
  dist: "0x0d6537b8dcfbe6caae02ad4356f5b3cfbc7c6afc",
  version: 6,
};
