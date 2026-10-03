const ICONS = {
  x: { label: "X", d: "M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43Z" },
  discord: { label: "Discord", d: "M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.4C.6 9-.2 13.5.3 18a19.9 19.9 0 0 0 6 3l1.3-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.5-13.6ZM8.7 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm6.6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" },
  telegram: { label: "Telegram", d: "M21.9 4.3 18.8 19c-.2 1-.8 1.3-1.7.8l-4.6-3.4-2.2 2.1c-.3.3-.5.5-1 .5l.3-4.7 8.6-7.8c.4-.3-.1-.5-.6-.2L6.9 13 2.4 11.6c-1-.3-1-1 .2-1.5L20.5 3.2c.8-.3 1.6.2 1.4 1.1Z" },
} as const;

export function Socials({ links, large = false }: { links: Record<keyof typeof ICONS, string>; large?: boolean }) {
  const set = (Object.keys(ICONS) as (keyof typeof ICONS)[]).filter((k) => links[k]);
  if (!set.length) return large ? <p className="mono socials-soon">Socials launching soon</p> : null;
  return (
    <span className={large ? "socials socials-large" : "socials"}>
      {set.map((k) => (
        <a key={k} href={links[k]} target="_blank" rel="noreferrer" aria-label={ICONS[k].label} title={ICONS[k].label}>
          <svg viewBox="0 0 24 24" width={large ? 22 : 18} height={large ? 22 : 18} fill="currentColor"><path d={ICONS[k].d} /></svg>
          {large && <span>{ICONS[k].label}</span>}
        </a>
      ))}
    </span>
  );
}
