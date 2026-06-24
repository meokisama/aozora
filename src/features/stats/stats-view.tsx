import { useEffect, useMemo, useState } from "react";
import { BarChart3, BookCheck, CalendarDays, Clock, Flame, Gauge, Loader2, Type } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LibrarySidebar } from "@/features/library/library-sidebar";
import { useLibraryStore } from "@/stores/library-store";
import { useStatsPrefs } from "@/stores/stats-prefs-store";
import { readingStatus } from "@/lib/format";
import { toDayKey, shiftDay, computeStreaks, formatDuration, formatCompact } from "@/lib/stats/aggregate";
import type { DayValue } from "@/lib/stats/aggregate";
import type { Stats } from "@/lib/types";
import { Heatmap, HeatmapLegend } from "./heatmap";
import { StatCard, BarChart, BookBar } from "./stats-widgets";
import { GoalCard } from "./goal-card";
import { Milestones } from "./milestones";

const api = () => window.electronAPI.stats;

/**
 * The reading-statistics page. Renders beside the shared sidebar (like the
 * library) and visualises the reading_sessions time-series: headline totals, a
 * daily goal, a GitHub-style activity heatmap, daily / hourly rhythm charts,
 * milestones and a most-read books ranking. All aggregation is done in SQLite;
 * this component fetches it, derives streaks / heatmap geometry, and lays out
 * the (mostly presentational) section components.
 */
export function StatsView() {
  const books = useLibraryStore((s) => s.books);
  const dailyGoal = useStatsPrefs((s) => s.dailyGoal);
  const setDailyGoal = useStatsPrefs((s) => s.setDailyGoal);
  const [data, setData] = useState<Stats | null>(null); // { overview, daily, hourly, perBook }
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState("chars"); // chars | minutes
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api()
      .get()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const daily = data?.daily ?? [];
  const overview = data?.overview ?? { totalChars: 0, totalMs: 0, sessionCount: 0, activeDays: 0 };
  const todayKey = toDayKey(new Date());

  const valueByDay = useMemo(() => {
    const m = new Map<string, DayValue>();
    for (const d of daily) m.set(d.day, { chars: d.chars || 0, ms: d.ms || 0, sessions: d.sessions || 0, books: d.books || 0 });
    return m;
  }, [daily]);

  const streaks = useMemo(
    () =>
      computeStreaks(
        daily.map((d) => d.day),
        todayKey,
      ),
    [daily, todayKey],
  );

  // Years present in the data, newest first; the current year is always offered.
  const years = useMemo(() => {
    const set = new Set([new Date().getFullYear()]);
    for (const d of daily) set.add(Number(d.day.slice(0, 4)));
    return [...set].sort((a, b) => b - a);
  }, [daily]);

  // Last 30 days, gaps filled with zero, for the daily-rhythm chart.
  const trend = useMemo(() => {
    const arr = [];
    for (let i = 29; i >= 0; i -= 1) {
      const key = shiftDay(todayKey, -i);
      const v = valueByDay.get(key);
      const value = metric === "minutes" ? (v?.ms || 0) / 60000 : v?.chars || 0;
      arr.push({ key, value, tip: `${key} · ${formatCompact(v?.chars || 0)} chars · ${formatDuration(v?.ms || 0)}` });
    }
    return arr;
  }, [valueByDay, todayKey, metric]);

  // 24 hour-of-day buckets.
  const hourly = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ key: h, value: 0, chars: 0, ms: 0 }));
    for (const h of data?.hourly ?? []) {
      const b = buckets[h.hour];
      if (b) {
        b.chars = h.chars || 0;
        b.ms = h.ms || 0;
        b.value = metric === "minutes" ? (h.ms || 0) / 60000 : h.chars || 0;
      }
    }
    return buckets.map((b) => ({ ...b, tip: `${String(b.key).padStart(2, "0")}:00 · ${formatCompact(b.chars)} chars · ${formatDuration(b.ms)}` }));
  }, [data, metric]);

  const topBooks = useMemo(() => (data?.perBook ?? []).slice(0, 8), [data]);
  const topBooksMax = topBooks.reduce((m, b) => Math.max(m, b.ms || 0), 0);

  const booksFinished = useMemo(() => books.filter((b) => readingStatus(b) === "finished").length, [books]);

  const speedCpm = overview.totalMs > 0 ? Math.round(overview.totalChars / (overview.totalMs / 60000)) : 0;
  const hasData = overview.sessionCount > 0;
  const selected = selectedDay ? valueByDay.get(selectedDay) : null;

  // Daily goal: today's characters vs the target, plus the run of consecutive
  // goal-meeting days (reuses the streak calc over the days that met the goal).
  const todayChars = valueByDay.get(todayKey)?.chars || 0;
  const goalPct = dailyGoal > 0 ? todayChars / dailyGoal : 0;
  const goalStreak = useMemo(() => {
    if (dailyGoal <= 0) return { current: 0, longest: 0 };
    return computeStreaks(
      daily.filter((d) => (d.chars || 0) >= dailyGoal).map((d) => d.day),
      todayKey,
    );
  }, [daily, dailyGoal, todayKey]);

  return (
    <div className="flex h-full">
      <LibrarySidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : !hasData ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="flex w-full max-w-sm flex-col items-center gap-3 border-2 border-dashed border-border px-8 py-12 text-center">
              <BarChart3 className="size-10 text-muted-foreground" strokeWidth={1.5} />
              <div className="space-y-1">
                <p className="text-sm font-medium">No reading recorded yet</p>
                <p className="text-xs text-muted-foreground">Open a book and start reading — your activity will show up here.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-8 overflow-auto p-6">
            {/* Headline totals. */}
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <StatCard icon={Type} label="Characters" value={formatCompact(overview.totalChars)} sub={`${overview.sessionCount} sessions`} />
              <StatCard icon={Clock} label="Time read" value={formatDuration(overview.totalMs)} sub={`${overview.activeDays} active days`} />
              <StatCard icon={Gauge} label="Speed" value={formatCompact(speedCpm)} sub="chars / min" />
              <StatCard icon={CalendarDays} label="Active days" value={overview.activeDays} sub="all time" />
              <StatCard icon={Flame} label="Streak" value={`${streaks.current}d`} sub={`Longest ${streaks.longest}d`} />
              <StatCard icon={BookCheck} label="Finished" value={booksFinished} sub="books" />
            </section>

            {/* Daily goal + Activity side by side on wide screens. */}
            <section className="grid gap-x-6 gap-y-6 lg:grid-cols-3">
              <GoalCard dailyGoal={dailyGoal} setDailyGoal={setDailyGoal} todayChars={todayChars} goalPct={goalPct} goalStreak={goalStreak} />

              {/* Activity heatmap. */}
              <div className="space-y-3 lg:col-span-2">
                <div className="flex min-h-7 flex-wrap items-center gap-3">
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Activity</h2>
                  <div className="ml-auto flex items-center gap-2">
                    <ToggleGroup type="single" variant="outline" spacing={0} size="sm" value={metric} onValueChange={(v) => v && setMetric(v)}>
                      <ToggleGroupItem value="chars" className="px-2 text-[11px]">
                        Chars
                      </ToggleGroupItem>
                      <ToggleGroupItem value="minutes" className="px-2 text-[11px]">
                        Minutes
                      </ToggleGroupItem>
                    </ToggleGroup>
                    <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                      <SelectTrigger size="sm" className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {years.map((y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Card size="sm" className="gap-3">
                  <div className="px-3 pt-1">
                    <Heatmap
                      year={year}
                      valueByDay={valueByDay}
                      metric={metric}
                      goalChars={dailyGoal}
                      selectedDay={selectedDay}
                      onSelectDay={setSelectedDay}
                    />
                  </div>
                  <div className="flex items-center justify-between px-3">
                    <p className="text-[11px] text-muted-foreground">
                      {selected
                        ? `${selectedDay} — ${formatCompact(selected.chars || 0)} chars · ${formatDuration(selected.ms || 0)} · ${selected.sessions} session${selected.sessions === 1 ? "" : "s"}`
                        : "Click a day for details"}
                    </p>
                    <HeatmapLegend />
                  </div>
                </Card>
              </div>
            </section>

            {/* Daily + hourly rhythm. */}
            <section className="grid gap-3 lg:grid-cols-2">
              <Card size="sm" className="gap-3">
                <div className="px-3 pt-1">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Last 30 days</h3>
                </div>
                <div className="px-3 pb-2">
                  <BarChart bars={trend} />
                  <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                    <span>{trend[0]?.key.slice(5)}</span>
                    <span>Today</span>
                  </div>
                </div>
              </Card>

              <Card size="sm" className="gap-3">
                <div className="px-3 pt-1">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">By hour of day</h3>
                </div>
                <div className="px-3 pb-2">
                  <BarChart bars={hourly} />
                  <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                    <span>00</span>
                    <span>06</span>
                    <span>12</span>
                    <span>18</span>
                    <span>23</span>
                  </div>
                </div>
              </Card>
            </section>

            <Milestones
              totalChars={overview.totalChars}
              activeDays={overview.activeDays}
              bestStreak={streaks.longest}
              booksFinished={booksFinished}
            />

            {/* Most-read books. */}
            {topBooks.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Most-read books</h2>
                <Card size="sm" className="gap-4">
                  <div className="space-y-3 px-3 py-1">
                    {topBooks.map((b) => (
                      <BookBar key={b.bookId} title={b.title || "Untitled"} author={b.author} ms={b.ms || 0} chars={b.chars || 0} max={topBooksMax} />
                    ))}
                  </div>
                </Card>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
