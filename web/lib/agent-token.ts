/**
 * Self-funding agents: an agent can launch its own token on Pons from its agent wallet. The agent
 * wallet is the token's creator, so the creator share of every trade on that token is paid to the
 * agent. Separately, 10% of all $TRENCHERS trading fees are split across every registered agent
 * wallet. Both land in the agent wallet as trading capital.
 *
 * SAMPLE MODE: launches and fee income are simulated from the launch / registration time.
 */
export const AGENT_FEE_SHARE_PCT = 10; // % of $TRENCHERS trading fees paid to registered agents

export type AgentToken = {
  name: string; symbol: string; description: string;
  website: string; x: string; telegram: string;
  image: string;          // data URL (sample mode) or IPFS URI once live
  address: string;
  launchedAt: number;
  feeRate: number;        // sample: ETH of creator fees per hour
};

export type TokenDraft = Omit<AgentToken, "address" | "launchedAt" | "feeRate">;
export const EMPTY_DRAFT: TokenDraft = { name: "", symbol: "", description: "", website: "", x: "", telegram: "", image: "" };

export function validateDraft(d: TokenDraft): string | null {
  if (!d.image) return "Add an image for the token.";
  if (!d.name.trim() || d.name.trim().length > 32) return "Give the token a name (up to 32 characters).";
  if (!/^[A-Z0-9]{2,10}$/.test(d.symbol)) return "The symbol needs 2 to 10 letters or numbers.";
  if (d.description.length > 280) return "Keep the description under 280 characters.";
  for (const [k, v] of [["Website", d.website], ["X", d.x], ["Telegram", d.telegram]] as const) {
    if (v && !/^https?:\/\/[^\s.]+\.[^\s]+$/.test(v)) return `${k} must be a full link starting with https://`;
  }
  return null;
}

const HOUR = 3_600_000;
/** Creator fees the agent's token has paid into the agent wallet so far (sample). */
export const tokenFees = (t: AgentToken, now = Date.now()) => Math.max(0, (now - t.launchedAt) / HOUR) * t.feeRate;
/** The agent's 10% share of $TRENCHERS fees since registration (sample: a flat rate per agent). */
export const trenchersShare = (registeredAt: number | null, now = Date.now()) =>
  registeredAt ? Math.max(0, (now - registeredAt) / HOUR) * 0.003 : 0;

/** Shrinks an uploaded image to a 256 px square data URL. */
export function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = c.height = 256;
      const g = c.getContext("2d")!; const s = Math.min(img.width, img.height);
      g.imageSmoothingQuality = "high";
      g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/webp", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't an image we can read.")); };
    img.src = url;
  });
}
