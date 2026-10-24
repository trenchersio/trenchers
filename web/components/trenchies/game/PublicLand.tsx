"use client";
/** Someone's land, for anyone to look at: their Trenchie in 3D, what they've built, and a way in for you. */
import { useEffect, useState } from "react";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { artPalette, loadArtFor } from "@/lib/art-vector";
import { REFERRAL, item } from "@/lib/trenchies-catalog";
import { Icon } from "./icons";
import { Land } from "./Land";
import type { Pub } from "./model";
import type { Palette } from "./types";

export type Showcase = Pub & { landValue: number; cheers: number; rank: number; players: number; achievements: number; species: number; members: number };
const FALLBACK: Palette = { bg: "#141a17", main: "#39ff88", second: "#2b8a57", sig: "#ffd84d", eye: "#ffffff" };
const n0 = (v: number) => v.toLocaleString("en-US");

export function PublicLand({ p }: { p: Showcase }) {
  const [palette, setPalette] = useState<Palette>(FALLBACK);
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { loadArtFor([p.nft]).then(() => { const x = artPalette(p.nft); if (x) setPalette(x); }).catch(() => {}); const t = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(t); }, [p.nft]);
  useEffect(() => { try { localStorage.setItem("trenchies:ref", p.name); } catch { /* */ } }, [p.name]);
  const look = { name: p.name, house: p.house, vehicle: p.vehicle, items: p.items, palette, trophies: p.hits, level: p.level, x: p.x, wear: p.wear };
  const play = `/trenchies/play?ref=${encodeURIComponent(p.name)}`;
  return (
    <div className="tg tg-public">
      <Land look={look} nft={p.nft} grow={{ wood: 0, stone: 0, fish: 0 }} now={now} mine={false} />
      <header className="tg-hud">
        <div className="tg-hud-l">
          <a className="tg-card tg-home" href="/" aria-label="trenchers.io"><Icon n="home" size={15} /></a>
          <div className="tg-card tg-who"><ArtCanvas id={p.nft} size={34} /><span className="tg-who-t"><b>{p.name}</b><span className="tg-lv"><span className="tg-lvb">Lv {p.level}</span><small>{item(p.house)?.name}{p.x ? ` · @${p.x}` : ""}</small></span></span></div>
        </div>
        <div className="tg-stats">
          <span className="tg-card tg-stat" title="Land value"><Icon n="brick" size={14} /><b>{n0(p.landValue)}</b></span>
          <span className="tg-card tg-stat" title="Rank"><Icon n="ranks" size={14} /><b>#{p.rank} of {p.players}</b></span>
          <span className="tg-card tg-stat" title="Cheers"><Icon n="heart" size={14} /><b>{p.cheers}</b></span>
          <span className="tg-card tg-stat tg-hide-s" title="Achievements"><Icon n="medal" size={14} /><b>{p.achievements}</b></span>
        </div>
      </header>
      <div className="tg-pubcta">
        <div><b>{p.name}&apos;s land in Trenchies</b><span>{p.items.length} things built · {p.hits} top-3 picks · {p.species} butterflies</span></div>
        <a className="tg-btn tg-btn-go" href={play}><Icon n="gift" size={14} />Build yours: +{REFERRAL.newBricks} bricks</a>
      </div>
    </div>
  );
}
