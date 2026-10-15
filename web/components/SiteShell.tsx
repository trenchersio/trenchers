import type { ReactNode } from "react";
import type { Where } from "@/lib/steps";

/** The page wrapper. (There used to be an intro screen in front of the site; it was removed, so the site shows at once.) */
export function SiteShell({ children }: { children: ReactNode; section?: Where }) {
  return <div className="site site-in">{children}</div>;
}
