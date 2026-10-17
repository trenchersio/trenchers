import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Trenchies waitlist: people leave an email on trenchers.io/trenchies.
 *
 * Settings (Railway variables):
 *   WAITLIST_FILE  where the list is kept, e.g. /data/waitlist.json on a Railway volume (default ./waitlist.json;
 *                  without a volume the list is lost on every redeploy)
 *   WAITLIST_KEY   a long random password of your own; the list is downloadable as CSV at
 *                  /waitlist/export?key=<WAITLIST_KEY>. Without it, export is switched off.
 */
type Entry = { email: string; t: number; ref?: string };
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const FILE = clean(process.env.WAITLIST_FILE) || "./waitlist.json";
const KEY = () => clean(process.env.WAITLIST_KEY);
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]{1,190}\.[a-z]{2,24}$/i;
const PER_IP = 5, WINDOW_MS = 3600_000, MAX = 200_000;

export class Waitlist {
  private list: Entry[] = [];
  private seen = new Set<string>();
  private hits = new Map<string, number[]>();

  constructor() {
    try {
      if (existsSync(FILE)) { this.list = (JSON.parse(readFileSync(FILE, "utf8")) as { list: Entry[] }).list ?? []; for (const e of this.list) this.seen.add(e.email); }
    } catch { /* start empty */ }
  }
  private save() {
    try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(`${FILE}.tmp`, JSON.stringify({ list: this.list })); renameSync(`${FILE}.tmp`, FILE); } catch { /* keep in memory */ }
  }
  private limited(ip: string) {
    const now = Date.now(), h = (this.hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    h.push(now); this.hits.set(ip, h);
    if (this.hits.size > 50_000) this.hits.clear();
    return h.length > PER_IP;
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (path !== "/waitlist" && !path.startsWith("/waitlist/")) return false;
    res.setHeader("cache-control", "no-store");
    const send = (code: number, body: unknown) => { res.statusCode = code; res.end(JSON.stringify(body)); };
    if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "content-type"); res.statusCode = 204; res.end(); return true; }

    if (req.method === "GET" && path === "/waitlist/export") {
      const key = new URLSearchParams((req.url ?? "").split("?")[1] ?? "").get("key") ?? "";
      if (!KEY() || key !== KEY()) { send(403, { error: "not allowed" }); return true; }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=trenchies-waitlist.csv");
      res.end("email,joined\n" + this.list.map((e) => `${e.email},${new Date(e.t).toISOString()}`).join("\n") + "\n");
      return true;
    }
    if (req.method === "GET" && path === "/waitlist") { send(200, { count: this.list.length }); return true; }
    if (req.method !== "POST" || path !== "/waitlist") { send(405, { error: "use POST" }); return true; }

    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 2_000) { send(413, { error: "too long" }); return true; } }
    let b: Record<string, unknown>;
    try { b = JSON.parse(raw || "{}"); } catch { send(400, { error: "bad request" }); return true; }
    if (typeof b.website === "string" && b.website) { send(200, { ok: true }); return true; } // a field only bots fill in
    const email = String(b.email ?? "").trim().toLowerCase();
    if (!EMAIL.test(email)) { send(400, { error: "That doesn't look like an email address." }); return true; }
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
    if (this.limited(ip)) { send(429, { error: "Too many sign-ups from here. Try again later." }); return true; }
    if (this.seen.has(email)) { send(200, { ok: true, already: true }); return true; }
    if (this.list.length >= MAX) { send(503, { error: "The waitlist is full for now." }); return true; }
    this.seen.add(email); this.list.push({ email, t: Date.now() }); this.save();
    send(200, { ok: true });
    return true;
  }
}
