import { encodeAbiParameters, parseAbiParameters } from "viem";
import { buyWithEth, sellForEth } from "../../web/lib/v4builder.ts";
const token = "0x1111111111111111111111111111111111111111", weth = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", hook = "0x00000000000000000000000000000000000020cC";
const k = { currency0: weth, currency1: token, fee: 0, tickSpacing: 60, hooks: hook } as const;
const out = (c: { commands: `0x${string}`; inputs: `0x${string}`[] }) => encodeAbiParameters(parseAbiParameters("bytes, bytes[]"), [c.commands, c.inputs]);
console.log("buyWeth", out(buyWithEth({ coinKey: k as never, token, quote: weth, trenchersKey: null, ethIn: 10n ** 18n, minOut: 123n })));
console.log("sellWeth", out(sellForEth({ coinKey: k as never, token, quote: weth, trenchersKey: null, amountIn: 5n * 10n ** 18n, minOut: 7n })));
const tk = { currency0: "0x0000000000000000000000000000000000000000", currency1: "0xC65a7C91591A2Dd4d5624E75e814b1bBe88b984a", fee: 10000, tickSpacing: 200, hooks: "0x2222222222222222222222222222222222222222" };
console.log("buyPath", out(buyWithEth({ coinKey: k as never, token, quote: "0xC65a7C91591A2Dd4d5624E75e814b1bBe88b984a", trenchersKey: tk as never, ethIn: 2n * 10n ** 18n, minOut: 9n })));
