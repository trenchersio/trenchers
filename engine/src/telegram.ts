import { decodeEventLog, formatEther, parseAbi, type Address, type Hash, type PublicClient } from "viem";

/**
 * Live Telegram channel: posts every Trenchers mint and every sale, with the Trencher's art.
 * Turned on by TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT (the channel's @username or numeric id; the bot
 * must be an admin of the channel). Plain wallet-to-wallet transfers without a payment aren't posted.
 */
const NFT_TRANSFER = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"])[0];
const ERC20_TRANSFER = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"])[0];
const ERC20 = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
const ZERO = "0x0000000000000000000000000000000000000000";

export type TelegramConfig = { api?: string; token: string; chat: string; site: string; explorer: string; imageBase: string; nft: Address };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (v: number) => (v >= 1 ? v.toFixed(3) : v >= 0.01 ? v.toFixed(4) : v.toPrecision(3)).replace(/\.?0+$/, "");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export class TelegramFeed {
  private queue: Promise<unknown> = Promise.resolve();
  private seen = new Set<Hash>();
  posted = 0;
  lastError: string | null = null;

  constructor(private cfg: TelegramConfig, private pub: PublicClient, private log: (m: string) => void,
    /** Extra line about the Trencher's agent (rank, return), if it has one. */
    private agentLine: (id: number) => string | null = () => null) {}

  /** Called with all NFT Transfer logs of one sync range, in order (live blocks only). */
  async onTransfers(logs: { transactionHash: Hash | null; args: { from?: Address; to?: Address; tokenId?: bigint } }[]) {
    const byTx = new Map<Hash, { from: Address; to: Address; id: number }[]>();
    for (const l of logs) {
      if (!l.transactionHash || this.seen.has(l.transactionHash)) continue;
      const list = byTx.get(l.transactionHash) ?? [];
      list.push({ from: l.args.from!, to: l.args.to!, id: Number(l.args.tokenId) });
      byTx.set(l.transactionHash, list);
    }
    for (const [hash, items] of byTx) {
      this.seen.add(hash);
      if (this.seen.size > 5000) this.seen.clear();
      try { await this.handleTx(hash, items); } catch (e) { this.lastError = (e as Error).message.split("\n")[0]; this.log(`telegram: ${this.lastError}`); }
    }
  }

  /** An agent woke up: its holder claimed the starter balance into its new wallet. */
  async onAwaken(id: number, holder: Address, wallet: Address, amount: bigint, hash: Hash | null) {
    if (hash && this.seen.has(`awake:${hash}` as Hash)) return;
    if (hash) this.seen.add(`awake:${hash}` as Hash);
    const lines = [
      `⚡ <b>Trencher #${id} awakened</b>`,
      `${fmt(Number(formatEther(amount)))} ETH is now in its own agent wallet <code>${short(wallet)}</code>, ready to trade.`,
      `Holder <code>${short(holder)}</code>`,
      `<a href="${this.cfg.site}/arena">Arena</a>${hash ? ` · <a href="${this.cfg.explorer}/tx/${hash}">tx</a>` : ""}`,
    ];
    try { await this.post([id], "awake", lines.join("\n")); } catch (e) { this.lastError = (e as Error).message.split("\n")[0]; this.log(`telegram: ${this.lastError}`); }
  }

  private async handleTx(hash: Hash, items: { from: Address; to: Address; id: number }[]) {
    const mints = items.filter((i) => i.from === ZERO);
    const moves = items.filter((i) => i.from !== ZERO && i.to !== ZERO);
    const tx = await this.pub.getTransaction({ hash });
    const link = `${this.cfg.explorer}/tx/${hash}`;

    if (mints.length) {
      const ids = mints.map((m) => m.id);
      const paid = Number(formatEther(tx.value));
      const title = ids.length === 1 ? `Trencher #${ids[0]} minted` : `${ids.length} Trenchers minted`;
      const lines = [
        `🟢 <b>${title}</b>`,
        ids.length > 1 ? `#${ids.join(", #")}` : null,
        paid > 0 ? `${fmt(paid)} ETH${ids.length > 1 ? ` (${fmt(paid / ids.length)} each)` : ""} · by <code>${short(mints[0].to)}</code>` : `by <code>${short(mints[0].to)}</code>`,
        `0.01 ETH of every mint is set aside for the agent's own wallet.`,
        `<a href="${this.cfg.site}/mint">Mint on trenchers.io</a> · <a href="${link}">tx</a>`,
      ];
      await this.post(ids, "dormant", lines.filter(Boolean).join("\n"));
    }

    if (moves.length) {
      const price = await this.salePrice(hash, tx.value, moves[0].to);
      if (!price) return; // a plain transfer, not a sale
      const each = price.amount / moves.length;
      const ids = moves.map((m) => m.id);
      const title = ids.length === 1 ? `Trencher #${ids[0]} sold` : `${ids.length} Trenchers sold`;
      const agent = ids.length === 1 ? this.agentLine(ids[0]) : null;
      const lines = [
        `💰 <b>${title}</b> for ${fmt(each)} ${esc(price.symbol)}${ids.length > 1 ? " each" : ""}`,
        ids.length > 1 ? `#${ids.join(", #")}` : null,
        `<code>${short(moves[0].from)}</code> → <code>${short(moves[0].to)}</code>`,
        agent,
        `<a href="${this.cfg.site}/arena">Arena</a> · <a href="${link}">tx</a>`,
      ];
      await this.post(ids, "awake", lines.filter(Boolean).join("\n"));
    }
  }

  /** What the buyer paid: ETH sent with the transaction, or else tokens (e.g. WETH offers) the buyer sent out. */
  private async salePrice(hash: Hash, value: bigint, buyer: Address): Promise<{ amount: number; symbol: string } | null> {
    if (value > 0n) return { amount: Number(formatEther(value)), symbol: "ETH" };
    const receipt = await this.pub.getTransactionReceipt({ hash });
    const sums = new Map<Address, bigint>();
    for (const l of receipt.logs) {
      if (l.address.toLowerCase() === this.cfg.nft.toLowerCase() || l.topics.length !== 3) continue;
      try {
        const ev = decodeEventLog({ abi: [ERC20_TRANSFER], data: l.data, topics: l.topics as [Hash, ...Hash[]] });
        const from = (ev.args as { from: Address }).from;
        if (from.toLowerCase() !== buyer.toLowerCase()) continue;
        sums.set(l.address, (sums.get(l.address) ?? 0n) + (ev.args as { value: bigint }).value);
      } catch { /* not an ERC-20 transfer */ }
    }
    const [token, amount] = [...sums.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1))[0] ?? [];
    if (!token || !amount) return null;
    const [symbol, decimals] = await Promise.all([
      this.pub.readContract({ address: token, abi: ERC20, functionName: "symbol" }).catch(() => "tokens"),
      this.pub.readContract({ address: token, abi: ERC20, functionName: "decimals" }).catch(() => 18),
    ]);
    return { amount: Number(amount) / 10 ** Number(decimals), symbol: String(symbol) };
  }

  private post(ids: number[], state: "awake" | "dormant", caption: string) {
    const photo = (id: number) => `${this.cfg.imageBase}${state}/${id}.png`;
    const job = this.queue.then(async () => {
      const api = (method: string, body: unknown) => fetch(`${this.cfg.api ?? "https://api.telegram.org"}/bot${this.cfg.token}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }).then((r) => r.json() as Promise<{ ok: boolean; description?: string }>);
      let r = ids.length === 1
        ? await api("sendPhoto", { chat_id: this.cfg.chat, photo: photo(ids[0]), caption, parse_mode: "HTML" })
        : await api("sendMediaGroup", { chat_id: this.cfg.chat, media: ids.slice(0, 10).map((id, i) => ({ type: "photo", media: photo(id), ...(i === 0 ? { caption, parse_mode: "HTML" } : {}) })) });
      // If Telegram can't fetch the image, still post the text.
      if (!r.ok) r = await api("sendMessage", { chat_id: this.cfg.chat, text: caption, parse_mode: "HTML", disable_web_page_preview: true });
      if (!r.ok) throw new Error(`Telegram refused the post: ${r.description}`);
      this.posted++;
      this.log(`telegram: posted ${caption.split("\n")[0].replace(/<[^>]+>/g, "")}`);
      await new Promise((res) => setTimeout(res, 3000)); // stay well under Telegram's channel rate limit
    });
    this.queue = job.catch((e) => { this.lastError = (e as Error).message; this.log(`telegram: ${this.lastError}`); });
    return this.queue;
  }
}
