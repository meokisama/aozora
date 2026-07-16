import type { Section } from "@/lib/epub/generate-html";

/** Index of the last chapter that starts at or before `char` (chapters are in
 *  document order), or -1 if none — the shared basis for the active-chapter
 *  indicator, Discord presence, bookmark names, and search-result labels. */
export function chapterIndexAt(chapters: Section[], char: number): number {
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) {
    if ((chapters[i].startCharacter ?? 0) <= char) idx = i;
    else break;
  }
  return idx;
}
