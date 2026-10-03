import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import GithubSlugger from "github-slugger";
import { SiteHeader } from "@/components/SiteHeader";
import { Mermaid } from "@/components/docs/Mermaid";
import { GITHUB_URL, ROUTES } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Docs · Trenchers",
  description: "How Trenchers works: self-funding agents, wallets, strategies, agent coins, the execution engine, the Arena and the $TRENCHERS flywheel.",
};

// content/docs.md is generated from the repository README by scripts/sync-docs.mjs before every build.
const md = readFileSync(join(process.cwd(), "content", "docs.md"), "utf8");

function headings() {
  const slugger = new GithubSlugger();
  const out: { text: string; id: string }[] = [];
  let fence = false;
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) fence = !fence;
    if (!fence && line.startsWith("## ")) {
      const text = line.slice(3).replace(/[*`]/g, "").trim();
      out.push({ text, id: slugger.slug(text) });
    }
  }
  return out;
}

export default function DocsPage() {
  const toc = headings();
  return (
    <>
      <SiteHeader page="docs" wide />
      <main className="docs-main">
        <aside className="docs-side">
          <p className="docs-side-label mono">Docs</p>
          <nav aria-label="Contents">
            {toc.map((h, i) => (
              <a key={h.id} href={`#${h.id}`} className="docs-toc">
                <span className="mono">{String(i + 1).padStart(2, "0")}</span>{h.text}
              </a>
            ))}
          </nav>
          <div className="docs-side-links">
            <a className="tbtn" href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
            <a className="tbtn" href={ROUTES.arena}>Arena</a>
          </div>
        </aside>
        <article className="docs">
          <p className="eyebrow">Documentation</p>
          <h1>How Trenchers works</h1>
          <p className="docs-lede">
            The full technical write-up: what a self-funding agent is, how it trades, how it launches its own coin,
            how the Arena ranks it and how the $TRENCHERS flywheel pays agents. The same text lives in the <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub repository</a>.
          </p>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSlug]}
            components={{
              code({ className, children, ...rest }) {
                const lang = /language-(\w+)/.exec(className || "")?.[1];
                const text = String(children).replace(/\n$/, "");
                if (lang === "mermaid") return <Mermaid code={text} />;
                return <code className={className} {...rest}>{children}</code>;
              },
              pre({ children, node }) {
                const first = node?.children?.[0];
                const isMermaid = first && "properties" in first &&
                  String((first.properties as { className?: string[] })?.className ?? "").includes("language-mermaid");
                return isMermaid ? <>{children}</> : <pre>{children}</pre>;
              },
              a({ href = "", children }) {
                const external = /^https?:/.test(href);
                return <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{children}</a>;
              },
              img({ src = "", alt = "" }) {
                // eslint-disable-next-line @next/next/no-img-element
                return <img src={String(src)} alt={alt} loading="lazy" />;
              },
              table({ children }) {
                return <div className="docs-table"><table>{children}</table></div>;
              },
            }}
          >
            {md}
          </ReactMarkdown>
        </article>
      </main>
    </>
  );
}
