import { useEffect } from "react";
import type { Book } from "@/lib/types";
import type { Section } from "@/lib/epub/generate-html";
import { useSettingsStore } from "@/stores/settings-store";

interface Params {
  book: Book | null;
  chapters: Section[];
  activeChapterIndex: number;
  progressPct: number;
}

/**
 * Discord Rich Presence: mirror the current book/chapter/progress while reading.
 * Enabling/disabling and the idle presence live in App (always mounted); the
 * main process throttles the actual sends.
 */
export function useDiscordPresence({ book, chapters, activeChapterIndex, progressPct }: Params) {
  const discordRichPresence = useSettingsStore((s) => s.discordRichPresence);
  const discordCover = useSettingsStore((s) => s.discordCover);

  useEffect(() => {
    if (!discordRichPresence || !book) return;
    const idx = activeChapterIndex;
    window.electronAPI.discord.update({
      bookTitle: book.title,
      author: book.author,
      chapterName: idx >= 0 ? chapters[idx].label : undefined,
      chapterIndex: idx >= 0 ? idx + 1 : undefined,
      chapterTotal: chapters.length || undefined,
      progress: progressPct,
      coverBookId: discordCover ? book.id : undefined, // opt-in: main uploads the cover for the large image
    });
  }, [discordRichPresence, discordCover, book, chapters, activeChapterIndex, progressPct]);
}
