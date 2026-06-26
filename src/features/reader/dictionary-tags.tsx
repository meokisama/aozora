import type { DictionaryTag } from "@/lib/types";

/**
 * Renders dictionary tags (part-of-speech, frequency, kanji grade, …) as badges
 * coloured by tag-bank category, with the tag's note as a tooltip.
 */

// A subset of Yomitan tag-bank categories mapped to a badge colour. Anything
// else (including untagged tokens) falls back to the muted style.
const CATEGORY_CLASS: Record<string, string> = {
  partOfSpeech: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  frequent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  popular: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  archaism: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  dialect: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  name: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  expression: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

export function TagBadges({ tags }: { tags: DictionaryTag[] }) {
  if (!tags.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <span
          key={t.name}
          title={t.notes || undefined}
          className={`rounded-sm px-1 py-px text-[10px] ${CATEGORY_CLASS[t.category] ?? "bg-muted text-muted-foreground/80"}`}
        >
          {t.name}
        </span>
      ))}
    </span>
  );
}
