import { Check } from "lucide-react";
import { BookContextMenu } from "./book-actions";
import { readingStatus, relativeTime } from "@/lib/format";

/**
 * A single book in the library grid: cover, title, author, reading state.
 * Clicking the cover opens the book; right-clicking opens the action menu.
 */
export function BookCard({ book, onOpen }) {
  const status = readingStatus(book);
  const pct = Math.round((book.progress ?? 0) * 100);
  const lastRead = relativeTime(book.lastOpenedAt);

  // A single compact metric pinned to the right of the author line: percent
  // while reading, "Finished" when done, else the last-read time if we have one.
  const meta = status === "reading" ? `${pct}%` : status === "finished" ? "Finished" : lastRead;

  return (
    <BookContextMenu book={book}>
      <div className="group/card relative flex flex-col">
        <div className="relative aspect-2/3 w-full overflow-hidden border bg-muted transition-colors group-hover/card:border-foreground/40">
          <button type="button" onClick={() => onOpen?.(book)} title={book.title} className="block h-full w-full text-left cursor-pointer">
            {book.coverDataUrl ? (
              <img src={book.coverDataUrl} alt={book.title} className="h-full w-full object-cover" draggable={false} />
            ) : (
              <div className="flex h-full w-full items-center justify-center p-3">
                <span className="line-clamp-5 text-center font-mincho text-xs text-muted-foreground">{book.title}</span>
              </div>
            )}
          </button>

          {status === "finished" && (
            <div className="pointer-events-none absolute left-1.5 top-1.5 flex size-5 items-center justify-center bg-primary text-primary-foreground shadow-sm">
              <Check className="size-3.5" />
            </div>
          )}

          {status === "reading" && pct > 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-black/25">
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>

        <div className="mt-2 space-y-0.5">
          <p className="line-clamp-2 font-mincho text-xs font-medium leading-snug">{book.title}</p>
          <div className="flex items-baseline justify-between gap-2">
            {book.author ? (
              <p className="truncate font-mincho text-[11px] text-muted-foreground">{book.author}</p>
            ) : (
              <span className="text-[11px] text-transparent">·</span>
            )}
            {meta && <span className="shrink-0 text-[11px] text-muted-foreground/80 tabular-nums">{meta}</span>}
          </div>
        </div>
      </div>
    </BookContextMenu>
  );
}
