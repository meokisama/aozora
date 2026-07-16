import type { ReactNode } from "react";

/** A titled group matching the settings page's section styling. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">{title}</p>
      {children}
    </div>
  );
}
