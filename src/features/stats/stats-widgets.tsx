import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}

/** A single headline metric tile. */
export function StatCard({ icon: Icon, label, value, sub }: StatCardProps) {
  return (
    <Card size="sm" className="gap-2">
      <div className="flex items-center gap-2 px-3 text-muted-foreground">
        <Icon className="size-3.5" />
        <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="px-3">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </Card>
  );
}

export interface Bar {
  key: string | number;
  value: number;
  tip?: string;
}

/** A compact dependency-free vertical bar chart. */
export function BarChart({ bars, height = 96 }: { bars: Bar[]; height?: number }) {
  const max = bars.reduce((m, b) => Math.max(m, b.value), 0);
  return (
    <div className="flex items-end gap-px" style={{ height }}>
      {bars.map((b) => (
        <div key={b.key} className="group/bar relative flex flex-1 items-end" style={{ height }} title={b.tip}>
          <div
            className={cn("w-full rounded-t-[2px] transition-colors", b.value > 0 ? "bg-primary/70 group-hover/bar:bg-primary" : "bg-muted/50")}
            style={{ height: max > 0 ? `${Math.max(b.value > 0 ? 3 : 0, (b.value / max) * 100)}%` : 0 }}
          />
        </div>
      ))}
    </div>
  );
}
