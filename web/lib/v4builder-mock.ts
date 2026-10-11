/** Sample data for building the V4 Builder pages offline (INFERENCE_MOCK=1). Nothing here is real. */
import type { BuilderCoin, BuilderConfig, ModuleKey } from "@/lib/v4builder";
import { TRENCHERS, WETH } from "@/lib/v4builder";

const a = (n: number) => `0x${n.toString(16).padStart(4, "0").repeat(10)}` as `0x${string}`;
const now = Math.floor(Date.now() / 1000);

function chart(seed: number, start: number, drift: number) {
  let p = start, x = seed;
  const out: { t: number; p: number }[] = [];
  for (let i = 0; i < 120; i++) {
    x = (x * 9301 + 49297) % 233280;
    p = Math.max(start * 0.2, p * (1 + ((x / 233280) - 0.47) * 0.09 + drift));
    out.push({ t: now - (120 - i) * 900, p });
  }
  return out;
}

const SAMPLES: [string, string, string, "eth" | "trenchers", ModuleKey[], number, number, number, number][] = [
  ["Tidewatch", "TIDE", "A coin that only lets you buy between 14:00 and 22:00 UTC. The tide comes in, the tide goes out.", "eth", ["buyWindow", "buybackBurn"], 300, 300, 2.1e-9, 0.004],
  ["Crown Court", "CROWN", "Biggest recent buyer wears the crown and collects the pot. The crown fades, so someone can always take it.", "trenchers", ["kingOfTheHill", "launchWalletCap"], 500, 200, 3.8e-2, 0.002],
  ["Slow Burn", "SLOW", "Thirty seconds between buys per wallet. Every hour, a slice of fees buys back and burns.", "eth", ["buyCooldown", "buybackBurn", "priceMoveGuard"], 200, 400, 6.4e-10, 0.001],
  ["Potato Club", "SPUD", "Catch the potato with a big buy and you can't sell for five minutes. Pass it on.", "eth", ["hotPotato"], 100, 100, 1.2e-9, -0.001],
  ["Every 25th", "NTH", "Every 25th qualifying buyer takes the pot that builds from fees.", "trenchers", ["nthBuyPot", "growingBuyLimit"], 400, 0, 9.1e-3, 0.003],
  ["Deep End", "DEEP", "Fees go into permanent full-range liquidity. The pool only gets deeper.", "eth", ["fullRangeLp", "launchWalletCap"], 300, 300, 4.0e-10, 0.0015],
  ["Contagion", "PLAGUE", "You can only buy if you already hold some. Ask a holder to infect you.", "trenchers", ["plague"], 200, 200, 1.4e-2, -0.0005],
  ["Dip Catcher", "DIPS", "When price drops 10% under its average, fees buy the dip automatically.", "eth", ["dipBuyback", "buyerRewards"], 300, 600, 7.7e-10, 0.002],
];

export function mockConfig(): BuilderConfig {
  return {
    ready: true, reason: null, mock: true, factory: a(0xf00d), hookDeployer: a(0xd0d0), startBlock: 1,
    modules: Object.fromEntries((["buyCooldown", "buyWindow", "priceMoveGuard", "growingBuyLimit", "launchWalletCap", "buybackBurn", "dipBuyback", "lpRewards", "fullRangeLp", "buyerRewards", "nthBuyPot", "kingOfTheHill", "hotPotato", "plague", "reactivePair", "entangled"] as ModuleKey[]).map((k, i) => [k, a(0x1000 + i)])),
  };
}

export function mockCoins(): BuilderCoin[] {
  return SAMPLES.map(([name, symbol, description, pair, modules, buy, sell, price, drift], i) => {
    const c = chart(i * 77 + 13, price * 0.6, drift);
    const last = c[c.length - 1].p;
    const priceQuote = BigInt(Math.round(last * 1e18)).toString();
    const quote = pair === "eth" ? WETH : TRENCHERS;
    const volume = (pair === "eth" ? 2 + i * 1.7 : 4e6 + i * 2.2e6);
    return {
      token: a(0xa000 + i), hook: a(0xb000 + i), ledger: a(0xc000 + i), poolId: `0x${"ab".repeat(31)}${String(i).padStart(2, "0")}` as `0x${string}`,
      quote, creator: a(0xe000 + i), name, symbol, image: "", description, website: "",
      launchedAt: now - (i + 1) * 5400 - i * 3600, block: 1000 + i, tx: null,
      creatorBuyBps: buy, creatorSellBps: sell, modules,
      priceQuote, marketCapQuote: (BigInt(priceQuote) * 1_000_000_000n).toString(),
      volumeQuote: BigInt(Math.round(volume * 1e18)).toString(), trades: 40 + i * 37,
      feesQuote: BigInt(Math.round(volume * ((buy + sell) / 20000) * 1e18)).toString(),
      chart: c,
    };
  });
}

export function mockBuilder(p: string, token = "") {
  if (p === "coin") return mockCoins().find((c) => c.token.toLowerCase() === token.toLowerCase()) ?? null;
  return p === "config" ? mockConfig() : { coins: mockCoins(), total: SAMPLES.length, updatedAt: now };
}
