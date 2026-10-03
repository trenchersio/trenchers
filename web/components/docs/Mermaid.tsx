"use client";
import { useEffect, useId, useState } from "react";

/** Renders a ```mermaid block as a diagram in the site's dark palette. Falls back to the source text. */
export function Mermaid({ code }: { code: string }) {
  const id = "m" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    let alive = true;
    import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false, theme: "base", securityLevel: "strict", fontFamily: "JetBrains Mono, ui-monospace, monospace",
        themeVariables: {
          darkMode: true, background: "#121514", primaryColor: "#14231B", primaryTextColor: "#E8ECE9",
          primaryBorderColor: "#39FF88", lineColor: "#8A938E", secondaryColor: "#171B19", tertiaryColor: "#121514",
          textColor: "#E8ECE9", fontSize: "15px", edgeLabelBackground: "#121514",
          actorBkg: "#14231B", actorBorder: "#39FF88", actorTextColor: "#E8ECE9", signalColor: "#8A938E", signalTextColor: "#E8ECE9",
          noteBkgColor: "#171B19", noteTextColor: "#E8ECE9", noteBorderColor: "#232826",
        },
      });
      try {
        const { svg } = await mermaid.render(id, code);
        const vb = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(svg);
        if (alive) { setSvg(svg); setWide(!!vb && Number(vb[1]) / Number(vb[2]) > 2.2); }
      } catch { /* keep source */ }
    });
    return () => { alive = false; };
  }, [code, id]);
  return svg
    ? <div className={`docs-diagram${wide ? " docs-diagram-wide" : ""}`} dangerouslySetInnerHTML={{ __html: svg }} />
    : <pre className="docs-diagram docs-diagram-src"><code>{code}</code></pre>;
}
