/**
 * The extension's half inside each page (Chrome's isolated world): passes lists and settings to inject.ts, checks
 * this site against the phishing list (held by the background worker, never sent to the site), and counts checks.
 */
type Msg = { __tg?: string; type?: string; level?: string };
const host = location.hostname.replace(/^www\./, "").toLowerCase();

async function send() {
  const [lists, phishing] = await Promise.all([
    chrome.runtime.sendMessage({ type: "lists" }).catch(() => null) as Promise<{ trusted: Record<string, string>; flagged: string[]; settings: { on: boolean; every: boolean } } | null>,
    chrome.runtime.sendMessage({ type: "origin", host }).catch(() => ({ phishing: false })) as Promise<{ phishing: boolean }>,
  ]);
  window.postMessage({ __tg: "lists", ...(lists ?? {}), phishing: phishing?.phishing, host }, "*");
  if (phishing?.phishing && lists?.settings?.on !== false) block();
}

/** A known phishing site: cover the page before anything can be signed. */
function block() {
  const show = () => {
    const el = document.createElement("div");
    el.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647";
    const r = el.attachShadow({ mode: "closed" });
    r.innerHTML = `<div style="position:fixed;inset:0;background:#0B0D0C;color:#E8ECE9;display:grid;place-items:center;padding:16px;font:15px/1.5 system-ui,sans-serif">
      <div style="max-width:460px;border:1px solid #3a1a1a;border-top:3px solid #FF4D4D;border-radius:14px;padding:24px;background:#121514">
        <div style="font:600 11px ui-monospace,monospace;letter-spacing:.14em;color:#8A938E">TRENCHERS GUARD</div>
        <h1 style="font-size:22px;color:#FF4D4D;margin:8px 0">This is a known phishing site</h1>
        <p style="color:#AEB6B1;margin:0 0 6px">${host.replace(/[<>&"]/g, "")} is on the public phishing list that MetaMask maintains. Sites like this copy real apps to get you to sign away your tokens.</p>
        <p style="color:#AEB6B1;margin:0 0 18px">Close this tab. If you already signed something here, open trenchers.io/protect to check your wallet.</p>
        <button id="x" style="font:inherit;background:transparent;border:1px solid #2C322F;color:#8A938E;border-radius:10px;padding:10px 14px;cursor:pointer">I understand the risk, show the site</button>
      </div></div>`;
    r.getElementById("x")!.addEventListener("click", () => el.remove());
    document.documentElement.appendChild(el);
  };
  if (document.documentElement) show(); else document.addEventListener("readystatechange", show, { once: true });
}

window.addEventListener("message", (e) => {
  const d = e.data as Msg;
  if (e.source !== window || d?.__tg !== "event") return;
  if (d.type === "ready") void send();
  else chrome.runtime.sendMessage({ type: "stat", what: d.type, level: d.level }).catch(() => {});
});
void send();
chrome.storage.onChanged.addListener(() => void send());
