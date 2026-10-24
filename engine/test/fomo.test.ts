import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, parseEther, type Address } from "viem";
import { CURVE_BUY, CURVE_SELL } from "../src/abis";
import { TraderWatch, FOMO_TRADERS } from "../src/fomo";

const W = FOMO_TRADERS[0].wallet, CURVE = "0x00000000000000000000000000000000000c0e7e" as Address, TOKEN = "0x0000000000000000000000000000000000007070" as Address;
const ROUTER = "0x000000000000000000000000000000000000a11c" as Address;
const NOW = Math.floor(Date.now() / 1000);
const hx = (n: number) => `0x${n.toString(16)}`;
const buyLog = (block: number) => ({
  address: CURVE, blockNumber: hx(block), logIndex: "0x1", transactionHash: `0x${"ab".repeat(31)}${block.toString(16).padStart(2, "0")}`,
  topics: encodeEventTopics({ abi: [CURVE_BUY], eventName: "CurveBuy", args: { buyer: ROUTER, recipient: W } }),
  data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [parseEther("0.2"), 10n ** 24n, 0n, 0n]),
});
const sellOut = (block: number) => ({
  address: TOKEN, blockNumber: hx(block), logIndex: "0x2", transactionHash: `0x${"cd".repeat(32)}`,
  topics: encodeEventTopics({ abi: [parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)")], eventName: "Transfer", args: { from: W, to: ROUTER } }),
  data: encodeAbiParameters([{ type: "uint256" }], [5n]),
});

test("FOMO trader watch: curve buys with their size, coins leaving the wallet as sells, live ones passed on", async () => {
  let calls = 0; const live: unknown[] = [];
  const head = { n: 1000 };
  const pub = {
    getBlock: async () => ({ timestamp: BigInt(NOW - 250) }),
    request: async ({ params: [f] }: { params: [{ fromBlock: string; toBlock: string; topics: unknown[] }] }) => {
      calls++;
      const lo = Number(f.fromBlock), hi = Number(f.toBlock);
      const isTransfer = typeof f.topics[0] === "string";
      const all = isTransfer ? [sellOut(1001)] : [buyLog(900), buyLog(1001)];
      return all.filter((l) => Number(l.blockNumber) >= lo && Number(l.blockNumber) <= hi);
    },
  };
  const w = new TraderWatch(pub as never, {
    tokenOfCurve: (c) => (c === CURVE ? TOKEN : undefined), isPons: (t) => t === TOKEN, symbolOf: async () => "PEPU",
    copied: () => new Set(), onTrade: (t) => live.push(t), log: () => {}, rangeMax: 50_000n,
  });
  await w.run(BigInt(head.n), NOW);
  assert.equal(w.trades.length, 1); assert.equal(w.trades[0].eth, 0.2); assert.equal(live.length, 0, "history isn't copied");
  await w.run(1002n, NOW + 1); // not due yet (no copiers, every 3 minutes)
  assert.equal(w.trades.length, 1);
  (w as unknown as { lastRun: number }).lastRun = 0;
  await w.run(1002n, NOW + 1);
  assert.equal(w.trades.length, 3); assert.equal(live.length, 2);
  const c = w.cards(() => 2).find((x) => x.wallet === W)!;
  assert.equal(c.buys, 2); assert.equal(c.sells, 1); assert.equal(c.copiedBy, 2); assert.deepEqual(c.top, ["PEPU"]);
  assert.ok(calls >= 4);
});
