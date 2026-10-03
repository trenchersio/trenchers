import type { ReactNode } from "react";

/** The site's only button style: [ bracketed text ] in white, green on hover. */
export function TextButton({ href, external, disabled, onClick, children, large }: {
  href?: string; external?: boolean; disabled?: boolean; onClick?: () => void; children: ReactNode; large?: boolean;
}) {
  const cls = `tbtn${large ? " tbtn-lg" : ""}`;
  if (href && !disabled) {
    return <a className={cls} href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{children}</a>;
  }
  return <button type="button" className={cls} onClick={onClick} disabled={disabled}>{children}</button>;
}
