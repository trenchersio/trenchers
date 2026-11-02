/**
 * Background worker: keeps the phishing list (MetaMask's public eth-phishing-detect list, refreshed daily), the
 * Trenchers lists of trusted and known-drainer contracts, settings and simple counts. Only lists are downloaded;
 * nothing about your browsing or your wallet is ever uploaded.
 */
const ENGINE = "https://mainnet-production-c38a.up.railway.app";
const PHISHING = "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json";
let phishing: Set<string> | null = null;
let allow: Set<string> = new Set();

type Store = { phishing?: string[]; allow?: string[]; phishingAt?: number; trusted?: Record<string, string>; flagged?: string[]; listsAt?: number; settings?: { on: boolean; every: boolean }; stats?: Record<string, number> };
const get = <K extends keyof Store>(...k: K[]) => chrome.storage.local.get(k) as Promise<Pick<Store, K>>;

async function refresh(force = false) {
  const s = await get("phishingAt", "listsAt");
  const day = 86_400_000, now = Date.now();
  if (force || !s.phishingAt || now - s.phishingAt > day) {
    try {
      const j = await (await fetch(PHISHING)).json() as { blacklist?: string[]; whitelist?: string[] };
      if (j.blacklist?.length) { await chrome.storage.local.set({ phishing: j.blacklist, allow: j.whitelist ?? [], phishingAt: now }); phishing = new Set(j.blacklist); allow = new Set(j.whitelist ?? []); }
    } catch { /* try again next time */ }
  }
  if (force || !s.listsAt || now - s.listsAt > day / 4) {
    try {
      const j = await (await fetch(`${ENGINE}/guard/lists`)).json() as { trusted?: Record<string, string>; flagged?: string[] };
      await chrome.storage.local.set({ trusted: j.trusted ?? {}, flagged: j.flagged ?? [], listsAt: now });
    } catch { /* keep the old lists */ }
  }
}
async function load() {
  if (phishing) return;
  const s = await get("phishing", "allow");
  phishing = new Set(s.phishing ?? []); allow = new Set(s.allow ?? []);
}
function listed(host: string) {
  if (!phishing || allow.has(host)) return false;
  const parts = host.split(".");
  for (let i = 0; i < parts.length - 1; i++) if (phishing.has(parts.slice(i).join("."))) return true;
  return false;
}

chrome.runtime.onInstalled.addListener(async () => {
  const s = await get("settings");
  if (!s.settings) await chrome.storage.local.set({ settings: { on: true, every: false }, stats: {} });
  await refresh(true);
});
chrome.runtime.onStartup.addListener(() => void refresh());

chrome.runtime.onMessage.addListener((m: { type: string; host?: string; what?: string; level?: string }, _s, reply) => {
  (async () => {
    if (m.type === "origin") { await load(); return { phishing: listed(String(m.host ?? "")) }; }
    if (m.type === "lists") { void refresh(); const s = await get("trusted", "flagged", "settings"); return { trusted: s.trusted ?? {}, flagged: s.flagged ?? [], settings: s.settings ?? { on: true, every: false } }; }
    if (m.type === "stat") {
      const { stats = {} } = await get("stats");
      const k = m.what === "checked" ? (m.level === "danger" || m.level === "warn" ? "flagged" : "checked") : String(m.what);
      stats[k] = (stats[k] ?? 0) + 1;
      if (m.what === "checked" && (m.level === "danger" || m.level === "warn")) stats.checked = (stats.checked ?? 0) + 1;
      await chrome.storage.local.set({ stats });
      return true;
    }
    if (m.type === "refresh") { await refresh(true); phishing = null; await load(); return { phishing: phishing?.size ?? 0 }; }
    return null;
  })().then(reply, () => reply(null));
  return true;
});
