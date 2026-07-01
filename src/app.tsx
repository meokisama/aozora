import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TitleBar } from "@/components/title-bar";
import { LibraryView } from "@/features/library/library-view";
import { ReaderView } from "@/features/reader/reader-view";
import { StatsView } from "@/features/stats/stats-view";
import { DictionariesView } from "@/features/dictionaries/dictionaries-view";
import { SettingsView } from "@/features/settings/settings-view";
import { useReaderStore } from "@/stores/reader-store";
import { useUiStore } from "@/stores/ui-store";
import { useSettingsStore, THEMES } from "@/stores/settings-store";
import { useFontsStore } from "@/stores/fonts-store";
import { useDictionaryImportStore } from "@/stores/dictionary-import-store";
import { syncDictionaryStyles } from "@/lib/dictionary/dict-styles";

export function App() {
  const reading = useReaderStore((s) => s.currentBook !== null);
  const view = useUiStore((s) => s.view);
  const fullscreen = useUiStore((s) => s.fullscreen);
  const theme = useSettingsStore((s) => s.theme);
  const discordRichPresence = useSettingsStore((s) => s.discordRichPresence);

  // Mirror the native window's fullscreen state so the title bar can hide and the
  // reader's toggle can reflect it (source of truth is the main process).
  useEffect(() => {
    const api = window.electronAPI?.window;
    if (!api) return;
    const setFullscreen = useUiStore.getState().setFullscreen;
    api.isFullscreen().then(setFullscreen);
    return api.onFullscreenChanged(setFullscreen);
  }, []);

  // Load user-imported fonts (IndexedDB) and register their FontFaces once.
  useEffect(() => {
    useFontsStore.getState().init();
  }, []);

  // Inject imported dictionaries' custom CSS (styles.css), scoped per dictionary,
  // so rich glosses (e.g. Jitendex) render styled in the reader popup.
  useEffect(() => {
    void syncDictionaryStyles();
  }, []);

  // Mirror dictionary-import progress into a store at the app level, so the
  // status survives navigating between views (the import itself runs in the
  // main process) and any view / the title bar can show it.
  useEffect(() => {
    const api = window.electronAPI?.dictionary;
    if (!api) return;
    return api.onImportProgress((p) => useDictionaryImportStore.getState().applyProgress(p));
  }, []);

  // Connect/disconnect Discord Rich Presence with the setting. Done here (not in
  // the reader) so it's live regardless of which view is open.
  useEffect(() => {
    window.electronAPI.discord.setEnabled(discordRichPresence);
  }, [discordRichPresence]);

  // Show the idle presence whenever no book is open; the reader owns the
  // reading presence while it's mounted.
  useEffect(() => {
    if (discordRichPresence && !reading) window.electronAPI.discord.clear();
  }, [discordRichPresence, reading]);

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
      {!fullscreen && <TitleBar />}
      <main className="flex-1 overflow-hidden">
        {reading ? (
          <ReaderView />
        ) : view === "stats" ? (
          <StatsView />
        ) : view === "dictionaries" ? (
          <DictionariesView />
        ) : view === "settings" ? (
          <SettingsView />
        ) : (
          <LibraryView />
        )}
      </main>
      <Toaster />
    </div>
  );
}
