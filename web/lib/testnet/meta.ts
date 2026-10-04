import { readFileSync } from "node:fs";
import { join } from "node:path";
import traits from "./traits.json";

/**
 * Testnet NFT metadata, served from trenchers.io instead of IPFS so the test collection can be set
 * up in one go. Same content as the mainnet files (art/dormant.py): dormant = grey art with the
 * starter balance still claimable, awake = full colour.
 */
type Row = [string, string, string, string, string, number, number, number, number, string];
let art: Row[] | null = null;
const loadArt = () => (art ??= JSON.parse(readFileSync(join(process.cwd(), "public", "collection", "art.json"), "utf8")) as Row[]);

export const SITE = "https://trenchers.io";
export const TESTNET_STARTER_ETH = "0.0001";

export function parseId(file: string) {
  const m = /^(\d+)\.(json|svg)$/.exec(file);
  const id = m ? Number(m[1]) : NaN;
  return Number.isInteger(id) && id >= 1 && id <= 2000 ? id : null;
}

/** Token metadata. Mainnet (served at trenchers.io/meta/) uses the 0.01 ETH starter and PNG art for marketplaces. */
export function metadata(id: number, awake: boolean, net: "testnet" | "mainnet" = "testnet") {
  const STARTER = net === "mainnet" ? "0.01" : TESTNET_STARTER_ETH;
  const t = traits as { keys: string[]; values: string[][]; rows: number[][] };
  const attrs = t.keys.map((k, i) => ({ trait_type: k, value: t.values[i][t.rows[id - 1][i]] })).filter((a) => a.value !== undefined);
  const house = id <= 5;
  const status = house ? "House agent" : awake ? "Awake" : "Dormant";
  const starter = house ? "Not applicable" : awake ? "Claimed" : `${STARTER} ETH claimable`;
  const intro = "Trenchers: self-funding trading agents with an identity. 2,000 AI trading agents on Robinhood Chain; every agent is an NFT with its own wallet, rules and track record. Buy one, train it, climb the Arena and sell your proven strategy.";
  const state = house ? "House agent, run by the team in public."
    : awake ? "Awake: this agent has its wallet and has claimed its starter balance."
    : `Dormant: this Trencher's agent has not been awakened. Its ${STARTER} ETH starter balance is still claimable by the holder, straight into the agent wallet.`;
  return {
    name: `Trenchers #${id}`,
    description: net === "mainnet" ? `${intro}\n\n${state}` : `${intro}\n\n${state}\n\nTestnet collection.`,
    image: net === "mainnet" ? `${SITE}/meta/img/${awake || house ? "awake" : "dormant"}/${id}.png` : `${SITE}/testnet-meta/img/${awake || house ? "awake" : "dormant"}/${id}.svg`,
    external_url: `${SITE}/collection#${id}`,
    attributes: [{ trait_type: "Status", value: status }, { trait_type: "Starter ETH", value: starter }, ...attrs],
  };
}

const CELLS = 28, MARGIN = 2, N = 24, GAP = 0.1;
const f = (n: number) => +n.toFixed(3);

/** The token's art as SVG (28 x 28 units), greyed out when dormant. */
export function svg(id: number, dormant: boolean) {
  const [bg, main, second, eye, sig, eyeType, er, ec, scan, pieces] = loadArt()[id - 1];
  const tone = [main, second, sig];
  const out: string[] = [`<rect width="28" height="28" fill="${bg}"/>`];
  const rect = (x: number, y: number, w: number, h: number, c: string) => out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${c}"/>`);
  const disc = (x: number, y: number, d: number, c: string) => out.push(`<circle cx="${f(x + d / 2)}" cy="${f(y + d / 2)}" r="${f(d / 2)}" fill="${c}"/>`);
  for (let i = 0; i < pieces.length; i += 3) {
    let v = parseInt(pieces.slice(i, i + 3), 36);
    const shift = (v % 3) - 1; v = (v / 3) | 0;
    const t = v % 3; v = (v / 3) | 0;
    const circle = v % 2 === 1; v = (v / 2) | 0;
    const s = (v % 3) + 1; v = (v / 3) | 0;
    const c = v % N, r = (v / N) | 0;
    const x0 = c + MARGIN + shift + GAP, y0 = r + MARGIN + GAP, d = s - 2 * GAP;
    if (circle) disc(x0, y0, d, tone[t]); else rect(x0, y0, d, d, tone[t]);
  }
  const ex = ec + MARGIN, ey = er + MARGIN;
  if (eyeType === 0) rect(ex + GAP, ey + GAP, 2 - 2 * GAP, 2 - 2 * GAP, eye);
  else if (eyeType === 1) disc(ex + GAP, ey + GAP, 2 - 2 * GAP, eye);
  else if (eyeType === 2) { disc(ex + GAP, ey + GAP, 2 - 2 * GAP, eye); disc(ex + 0.45, ey + 0.45, 2 - 0.9, bg); }
  else { rect(ex + GAP, ey + GAP, 2 - 2 * GAP, 2 - 2 * GAP, eye); rect(ex + 0.4, ey + 0.4, 1.2, 1.2, bg); rect(ex + 0.75, ey + 0.75, 0.5, 0.5, eye); }
  if (scan >= 0) rect(MARGIN, scan + MARGIN, N, 1, "rgba(57,255,136,0.235)");
  const filter = dormant ? `<filter id="g"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope="0.72"/><feFuncG type="linear" slope="0.72"/><feFuncB type="linear" slope="0.72"/></feComponentTransfer></filter>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CELLS} ${CELLS}" width="1120" height="1120" shape-rendering="geometricPrecision">${filter}<g${dormant ? ' filter="url(#g)"' : ""}>${out.join("")}</g></svg>`;
}
