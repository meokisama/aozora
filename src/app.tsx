import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TitleBar } from "@/components/title-bar";
import { LibraryView } from "@/features/library/library-view";
import { ReaderView } from "@/features/reader/reader-view";
import { StatsView } from "@/features/stats/stats-view";
import { useReaderStore } from "@/stores/reader-store";
import { useUiStore } from "@/stores/ui-store";
import { useSettingsStore, THEMES } from "@/stores/settings-store";

export function App() {
  const reading = useReaderStore((s) => s.currentBook !== null);
  const view = useUiStore((s) => s.view);
  const theme = useSettingsStore((s) => s.theme);

  // Drive the whole-app colour scheme from the selected theme: toggling the
  // `.dark` class on the document root swaps the Tailwind palette in index.css.
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
      <main className="flex-1 overflow-hidden">{reading ? <ReaderView /> : view === "stats" ? <StatsView /> : <LibraryView />}</main>
      <Toaster />
    </div>
  );
}
