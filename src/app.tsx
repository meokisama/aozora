import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TitleBar } from "@/components/title-bar";
import { LibraryView } from "@/features/library/library-view";
import { ReaderView } from "@/features/reader/reader-view";
import { StatsView } from "@/features/stats/stats-view";
import { DictionariesView } from "@/features/dictionaries/dictionaries-view";
import { useReaderStore } from "@/stores/reader-store";
import { useUiStore } from "@/stores/ui-store";
import { useSettingsStore, THEMES } from "@/stores/settings-store";

export function App() {
  const reading = useReaderStore((s) => s.currentBook !== null);
  const view = useUiStore((s) => s.view);
  const theme = useSettingsStore((s) => s.theme);

  // Toggle the `.dark` class on the document root to swap the Tailwind palette
  // in index.css per the selected theme.
  useEffect(() => {
    const isDark = (THEMES[theme] || THEMES.sepia).dark;
    document.documentElement.classList.toggle("dark", isDark);
  }, [theme]);

  // Dropping a file anywhere outside an explicit drop zone makes Chromium
  // navigate the window to file://… and blow away the app. Swallow those.
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <TitleBar />
      <main className="flex-1 overflow-hidden">
        {reading ? <ReaderView /> : view === "stats" ? <StatsView /> : view === "dictionaries" ? <DictionariesView /> : <LibraryView />}
      </main>
      <Toaster />
    </div>
  );
}
