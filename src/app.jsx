import React, { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TitleBar } from "@/components/title-bar";
import { LibraryView } from "@/features/library/library-view";
import { ReaderView } from "@/features/reader/reader-view";
import { useReaderStore } from "@/stores/reader-store";
import { useSettingsStore, THEMES } from "@/stores/settings-store";

export function App() {
  const reading = useReaderStore((s) => s.currentBook !== null);
  const theme = useSettingsStore((s) => s.theme);

  // Drive the whole-app colour scheme from the selected theme: toggling the
  // `.dark` class on the document root swaps the Tailwind palette in index.css.
  useEffect(() => {
    const isDark = (THEMES[theme] || THEMES.sepia).dark;
    document.documentElement.classList.toggle("dark", isDark);
  }, [theme]);

  return (
    <div className="flex h-screen flex-col">
      <TitleBar />
      <main className="flex-1 overflow-hidden">
        {reading ? <ReaderView /> : <LibraryView />}
      </main>
      <Toaster />
    </div>
  );
}
