import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Reading-stats prefs (daily character target), persisted in the renderer via
 * Zustand persist, not the main process. 0 = goal off.
 */

export const DAILY_GOAL_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 1000, label: "1,000 chars" },
  { value: 2500, label: "2,500 chars" },
  { value: 5000, label: "5,000 chars" },
  { value: 10000, label: "10,000 chars" },
  { value: 20000, label: "20,000 chars" },
];

interface StatsPrefsState {
  dailyGoal: number;
  setDailyGoal: (dailyGoal: number) => void;
}

export const useStatsPrefs = create<StatsPrefsState>()(
  persist(
    (set) => ({
      dailyGoal: 5000,
      setDailyGoal: (dailyGoal) => set({ dailyGoal }),
    }),
    { name: "aozora-stats-prefs" },
  ),
);
