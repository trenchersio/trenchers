/**
 * Runs inside every page (the page's own JavaScript world), so it can sit between the site and the wallet.
 * Every request that could move funds or sign something is read here first, on this computer, with the same rules
 * as trenchers.io/protect. Risky ones pause behind a warning; the wallet only opens if you choose Continue.
 * Nothing about the request is sent anywhere.
 */
import { scan, CHECKED, type Ctx, type Finding, type Level } from "../../engine/src/guard-scan";

type Req = { method: string; params?: unknown[] };
type Provider = { request: (a: Req) => Promise<unknown>; __trenchersGuard?: boolean };

const ctx: Ctx = { trusted: new Set(), flagged: new Set(), names: {} };
let settings = { on: true, every: false };
let originFlag: Finding | null = null;

// Lists and settings come from the extension's other half (bridge.ts) by window messages.
window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.__tg !== "lists") return;
  const d = e.data as { trusted?: Record<string, string>; flagged?: string[]; settings?: typeof settings; phishing?: boolean; host?: string };
  if (d.trusted) { ctx.trusted = new Set(Object.keys(d.trusted)); ctx.names = d.trusted; }
  if (d.flagged) ctx.flagged = new Set(d.flagged);
  if (d.settings) settings = d.settings;
  if (d.phishing) originFlag = { level: "danger", kind: "phishing", title: `${d.host} is a known phishing site`, lines: ["Close this tab. Nothing it asks you to sign is safe."] };
});
const tell = (type: string, extra: Record<string, unknown> = {}) => window.postMessage({ __tg: "event", type, ...extra }, "*");

const COLORS: Record<Level, string> = { ok: "#39FF88", info: "#6EC8FF", warn: "#FFB020", danger: "#FF4D4D" };
const LABEL: Record<Level, string> = { ok: "Looks fine", info: "Check the details", warn: "Be careful", danger: "This could drain your wallet" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]!);

/** The warning, in a closed shadow root so the page can't restyle or click it. Resolves true for Continue. */
function ask(level: Level, findings: Finding[]): Promise<boolean> {
  return new Promise((done) => {
    const host = document.createElement("div");
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647";
    const root = host.attachShadow({ mode: "closed" });
    const c = COLORS[level];
    root.innerHTML = `<style>
      *{box-sizing:border-box;margin:0}
      .bg{position:fixed;inset:0;background:rgba(5,7,6,.72);backdrop-filter:blur(3px);display:grid;place-items:center;padding:16px;font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#E8ECE9}
      .card{width:min(460px,100%);background:#0F1211;border:1px solid #232826;border-top:3px solid ${c};border-radius:14px;padding:20px;box-shadow:0 24px 80px rgba(0,0,0,.6);max-height:90vh;overflow:auto}
      .top{display:flex;align-items:center;gap:10px;margin-bottom:14px}
      .shield{width:28px;height:28px;flex:none}
      .brand{font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;color:#8A938E;text-transform:uppercase}
      .lvl{font-weight:700;font-size:18px;color:${c}}
      .f{border:1px solid #232826;border-radius:10px;padding:12px;margin-top:10px;background:#121514}
      .f b{display:block;font-size:15px;margin-bottom:4px}
      .f p{color:#AEB6B1;font-size:13px;margin-top:3px}
      .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;vertical-align:1px}
      .row{display:flex;gap:10px;margin-top:18px}
      button{flex:1;font:600 14px/1 inherit;font-family:inherit;padding:12px;border-radius:10px;cursor:pointer;border:1px solid #2C322F}
      .no{background:${c};color:#0B0D0C;border-color:${c}}
      .yes{background:transparent;color:#AEB6B1}
      .yes:disabled{opacity:.4;cursor:default}
      label{display:flex;gap:8px;align-items:flex-start;margin-top:14px;font-size:13px;color:#AEB6B1;cursor:pointer}
      .site{font:12px ui-monospace,Menlo,monospace;color:#8A938E;margin-top:12px;word-break:break-all}
    </style>
    <div class="bg" role="dialog" aria-modal="true" aria-label="Trenchers Guard warning"><div class="card">
      <div class="top"><svg class="shield" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"/><path d="M9 12l2 2 4-4"/></svg>
        <div><div class="brand">Trenchers Guard</div><div class="lvl">${LABEL[level]}</div></div></div>
      ${findings.map((f) => `<div class="f"><b><span class="dot" style="background:${COLORS[f.level]}"></span>${esc(f.title)}</b>${f.lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>`).join("")}
      ${level === "danger" ? `<label><input type="checkbox" class="ok"> I understand the risk and still want to open my wallet.</label>` : ""}
      <div class="site">${esc(location.host)}</div>
      <div class="row"><button class="no">Reject</button><button class="yes" ${level === "danger" ? "disabled" : ""}>Continue to wallet</button></div>
    </div></div>`;
    const yes = root.querySelector(".yes") as HTMLButtonElement, no = root.querySelector(".no") as HTMLButtonElement;
    root.querySelector(".ok")?.addEventListener("change", (e) => { yes.disabled = !(e.target as HTMLInputElement).checked; });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); finish(false); } };
    const finish = (v: boolean) => { window.removeEventListener("keydown", onKey, true); host.remove(); done(v); };
    window.addEventListener("keydown", onKey, true);
    no.addEventListener("click", () => finish(false));
    yes.addEventListener("click", () => finish(true));
    (document.body ?? document.documentElement).appendChild(host);
    no.focus();
  });
}

async function check(args: Req): Promise<void> {
  if (!settings.on || !args || !CHECKED.has(args.method)) return;
  let r: { level: Level; findings: Finding[] };
  try { r = scan({ ...args, origin: location.origin }, ctx); } catch { return; }
  if (originFlag) { r.findings.unshift(originFlag); r.level = "danger"; }
  tell("checked", { level: r.level });
  const show = r.level === "danger" || r.level === "warn" || (settings.every && r.findings.length);
  if (!show) return;
  let go: boolean;
  try { go = await ask(r.level, r.findings); }
  catch { go = window.confirm(`Trenchers Guard: ${LABEL[r.level]}\n\n${r.findings.map((f) => `${f.title}\n${f.lines.join(" ")}`).join("\n\n")}\n\nOpen your wallet anyway?`); }
  tell(go ? "continued" : "rejected", { level: r.level });
  if (!go) throw Object.assign(new Error("Trenchers Guard: you rejected this request."), { code: 4001 });
}

function wrap(p: Provider | undefined | null) {
  if (!p || typeof p.request !== "function" || p.__trenchersGuard) return;
  const orig = p.request;
  const guarded = async function (this: unknown, args: Req) { await check(args); return orig.call(this ?? p, args); };
  try {
    Object.defineProperty(p, "request", { value: guarded, configurable: true, writable: true });
    Object.defineProperty(p, "__trenchersGuard", { value: true });
  } catch { /* a frozen provider: we can't protect it, and say so in the popup's stats */ tell("unprotected"); }
  // Old-style calls some sites still use.
  for (const m of ["sendAsync", "send"] as const) {
    const f = (p as unknown as Record<string, unknown>)[m];
    if (typeof f !== "function") continue;
    try {
      Object.defineProperty(p, m, { configurable: true, writable: true, value: function (this: unknown, a: unknown, cb?: (e: unknown, r?: unknown) => void) {
        const req = (typeof a === "string" ? { method: a, params: cb as unknown as unknown[] } : a) as Req;
        if (!req || !CHECKED.has(req.method)) return (f as (...x: unknown[]) => unknown).call(this ?? p, a, cb);
        const run = check(req).then(() => (f as (...x: unknown[]) => unknown).call(this ?? p, a, cb));
        if (typeof cb === "function") { run.catch((e) => cb(e)); return undefined; }
        return run;
      } });
    } catch { /* leave it */ }
  }
}

// window.ethereum: now, and whenever a wallet sets it later.
try {
  let current = (window as unknown as { ethereum?: Provider }).ethereum;
  wrap(current);
  const d = Object.getOwnPropertyDescriptor(window, "ethereum");
  if (!d || d.configurable) {
    Object.defineProperty(window, "ethereum", { configurable: true, enumerable: true,
      get: () => current, set: (v: Provider) => { current = v; wrap(v); } });
  }
} catch { /* another extension owns it; EIP-6963 below still covers modern sites */ }
// EIP-6963: every wallet announces itself; protect each one.
window.addEventListener("eip6963:announceProvider", (e) => { wrap((e as CustomEvent<{ provider: Provider }>).detail?.provider); });
// Wallets that inject a bit later.
for (const ms of [0, 50, 300, 1500]) setTimeout(() => wrap((window as unknown as { ethereum?: Provider }).ethereum), ms);
tell("ready");
