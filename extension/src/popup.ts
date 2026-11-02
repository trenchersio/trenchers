type S = { settings?: { on: boolean; every: boolean }; stats?: Record<string, number>; phishing?: string[]; phishingAt?: number };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
async function render() {
  const s = await chrome.storage.local.get(["settings", "stats", "phishingAt"]) as S;
  const st = s.stats ?? {}, set = s.settings ?? { on: true, every: false };
  $("checked").textContent = String(st.checked ?? 0);
  $("flagged").textContent = String(st.flagged ?? 0);
  $("rejected").textContent = String(st.rejected ?? 0);
  ($("on") as HTMLInputElement).checked = set.on;
  ($("every") as HTMLInputElement).checked = set.every;
  $("state").textContent = set.on ? "On: checking every wallet request" : "Paused";
  $("state").className = set.on ? "on" : "off";
  $("list").textContent = s.phishingAt ? `Phishing list updated ${new Date(s.phishingAt).toLocaleDateString()}` : "Phishing list: downloading…";
}
async function save() {
  await chrome.storage.local.set({ settings: { on: ($("on") as HTMLInputElement).checked, every: ($("every") as HTMLInputElement).checked } });
  void render();
}
$("on").addEventListener("change", save);
$("every").addEventListener("change", save);
$("refresh").addEventListener("click", async () => { $("list").textContent = "Updating…"; await chrome.runtime.sendMessage({ type: "refresh" }); void render(); });
void render();
