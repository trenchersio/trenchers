/** Why an agent can't buy right now, as reported by the engine (/arena → agents[].blocked). */
export type Blocked = { code: "no-rule" | "unsupported" | "off" | "no-limit" | "max-positions" | "daily-limit" | "no-eth"; text: string } | null | undefined;

const untilReset = () => {
  const now = new Date(), next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const m = Math.max(1, Math.round((next - now.getTime()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

/** Short badge for lists (Arena rows), or null when the agent is fine or only paused. */
export function badgeOf(b: Blocked): { label: string; tone: "warn" | "info" } | null {
  if (!b) return null;
  switch (b.code) {
    case "no-eth": return { label: "No ETH", tone: "warn" };
    case "unsupported": return { label: "Can't trade", tone: "warn" };
    case "daily-limit": return { label: "Limit hit", tone: "info" };
    case "max-positions": return { label: "Full", tone: "info" };
    case "no-rule": return { label: "No strategy", tone: "info" };
    default: return null;
  }
}

/** Full explanation for the agent's own profile, with the fix the holder can make. */
export function explain(b: Blocked): { title: string; body: string; fix: "funding" | "guide" | "start" | null; fixLabel: string | null; tone: "warn" | "info" } | null {
  if (!b) return null;
  switch (b.code) {
    case "no-eth": return { title: "Out of ETH", body: "Its wallet is empty, so it can't buy anything. Top it up and it trades again on the next signal.", fix: "funding", fixLabel: "Top it up", tone: "warn" };
    case "unsupported": return { title: "This strategy can't trade yet", body: "It's set to buy on DexScreener updates, a signal the engine doesn't support yet, so it never buys. Pick another strategy, for example one of the ready-made ones.", fix: "guide", fixLabel: "Pick a strategy", tone: "warn" };
    case "daily-limit": return { title: "Daily limit reached", body: `It has spent its daily limit and resumes at 00:00 UTC (in ${untilReset()}). Want it to keep going? Raise "Max per day".`, fix: "guide", fixLabel: "Raise the limit", tone: "info" };
    case "max-positions": return { title: "Holding the maximum positions", body: "It buys again as soon as one of its open positions is sold.", fix: null, fixLabel: null, tone: "info" };
    case "no-rule": return { title: "No strategy yet", body: "Teach it what to trade: talk to it in plain English or pick a ready-made strategy.", fix: "guide", fixLabel: "Choose a strategy", tone: "info" };
    case "no-limit": return { title: "No per-trade limit", body: "Set how much it may spend per trade before it can buy.", fix: "guide", fixLabel: "Set limits", tone: "info" };
    case "off": return null; // the profile already shows Paused with a Start button
  }
}

/** Opens a folded profile section and scrolls to it. */
export function goToSection(id: string) {
  window.dispatchEvent(new CustomEvent("fold-open", { detail: id }));
  setTimeout(() => document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
}
