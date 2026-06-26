import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { buildHeatmapWeeks, intensityLevel, formatDuration, formatCompact } from "@/lib/stats/aggregate";
import type { DayValue, HeatmapCell } from "@/lib/stats/aggregate";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["", "Mon", "", "Wed", "", "Fri", ""];

// 0 = idle, 1–4 = increasing intensity. Tailwind needs the classes spelled out
// (no interpolation) so the JIT keeps them.
const LEVEL_CLASS = ["bg-muted/60", "bg-primary/25", "bg-primary/45", "bg-primary/70", "bg-primary"];

/**
 * GitHub-style contribution calendar for one year. Each column is a week
 * (Sun→Sat top to bottom); cell shade is the chosen metric relative to the
 * busiest day. Clicking a day selects it.
 */
interface HeatmapProps {
  year: number;
  valueByDay: Map<string, DayValue>;
  metric: string;
  goalChars?: number;
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
}

export function Heatmap({ year, valueByDay, metric, goalChars = 0, selectedDay, onSelectDay }: HeatmapProps) {
  const weeks = useMemo(() => buildHeatmapWeeks(year, valueByDay), [year, valueByDay]);

  const valueOf = (cell: HeatmapCell) => (metric === "minutes" ? cell.ms / 60000 : cell.chars);

  const max = useMemo(() => {
    let m = 0;
    for (const week of weeks) for (const cell of week) if (cell) m = Math.max(m, valueOf(cell));
    return m;
  }, [weeks, metric]);

  // A month label on the first week column where that month begins.
  const monthLabels = useMemo(() => {
    let last = -1;
    return weeks.map((week) => {
      const first = week.find(Boolean);
      if (!first) return "";
      const m = Number(first.day.slice(5, 7)) - 1;
      if (m !== last) {
        last = m;
        return MONTHS[m];
      }
      return "";
    });
  }, [weeks]);

  const tip = (cell: HeatmapCell) => {
    const unit = cell.chars === 1 ? "char" : "chars";
    return `${cell.day} · ${formatCompact(cell.chars)} ${unit} · ${formatDuration(cell.ms)} · ${cell.sessions} session${cell.sessions === 1 ? "" : "s"}`;
  };

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {/* Weekday labels down the left edge. */}
      <div className="mt-4.5 flex shrink-0 flex-col gap-0.75 pr-0.5">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="h-2.5 text-[9px] leading-2.5 text-muted-foreground/70">
            {d}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        {/* Month labels aligned to their starting week column. */}
        <div className="flex gap-0.75">
          {monthLabels.map((label, i) => (
            <span key={i} className="w-2.5 text-[9px] leading-none text-muted-foreground/70">
              {label}
            </span>
          ))}
        </div>

        <div className="flex gap-0.75">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-0.75">
              {week.map((cell, di) => {
                if (!cell) return <div key={di} className="size-2.5" />;
                const level = intensityLevel(valueOf(cell), max);
                const selected = cell.day === selectedDay;
                // A small ring marks days that met the daily goal.
                const metGoal = goalChars > 0 && cell.chars >= goalChars;
                return (
                  <button
                    key={di}
                    type="button"
                    title={tip(cell)}
                    onClick={() => onSelectDay(selected ? null : cell.day)}
                    className={cn(
                      "size-2.5 rounded-[2px] transition-colors cursor-pointer hover:ring-1 hover:ring-foreground/40",
                      LEVEL_CLASS[level],
                      selected ? "ring-1 ring-foreground" : metGoal && "ring-1 ring-amber-500/80 dark:ring-amber-400/80",
                    )}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** "Less ▢▢▢▢▢ More" legend matching the heatmap shades. */
export function HeatmapLegend() {
  return (
    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <span>Less</span>
      {LEVEL_CLASS.map((c, i) => (
        <span key={i} className={cn("size-2.5 rounded-[2px]", c)} />
      ))}
      <span>More</span>
    </div>
  );
}
