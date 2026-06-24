import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { BookContextMenu } from "./book-actions";
import { readingStatus, relativeTime } from "@/lib/format";
import bookTemplate from "@/assets/book-template.png";
import type { Book } from "@/lib/types";

/**
 * A single book in the library grid: cover, title, author, reading state.
 * Clicking the cover opens the book; right-clicking opens the action menu.
 */
export function BookCard({ book, onOpen }: { book: Book; onOpen?: (book: Book) => void }) {
  const status = readingStatus(book);
  const pct = Math.round((book.progress ?? 0) * 100);
  const lastRead = relativeTime(book.lastOpenedAt);

  // Fall back to the template placeholder when there's no cover, or when the
  // stored cover fails to decode. Reset the error when the cover changes.
  const [coverError, setCoverError] = useState(false);
  useEffect(() => setCoverError(false), [book.coverDataUrl]);
  const useFallback = !book.coverDataUrl || coverError;

  // A single compact metric pinned to the right of the author line: percent
  // while reading, "Finished" when done, else the last-read time if we have one.
  const meta = status === "reading" ? `${pct}%` : status === "finished" ? "Finished" : lastRead;

  return (
    <BookContextMenu book={book}>
      <div className="flex flex-col">
        <div className="group/cover">
          <div className="relative aspect-2/3 w-full overflow-hidden rounded-[5px] border bg-muted transition-all transform-gpu will-change-transform duration-300 ease-out group-hover/cover:-translate-y-1 group-hover/cover:shadow-xl">
            <button type="button" onClick={() => onOpen?.(book)} title={book.title} className="block h-full w-full cursor-pointer text-left">
              <img
                src={useFallback ? bookTemplate : book.coverDataUrl ?? bookTemplate}
                alt={useFallback ? "" : book.title}
                onError={() => setCoverError(true)}
                className="h-full w-full object-cover"
                draggable={false}
              />
            </button>

            {status === "finished" && (
              <div className="pointer-events-none absolute left-1.5 top-1.5 flex size-5 items-center justify-center bg-primary text-primary-foreground shadow-sm">
                <Check className="size-3.5" />
              </div>
            )}

            {status === "reading" && pct > 0 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-linear-to-t from-black/40 to-transparent">
                <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
                  <div className="h-full bg-amber-700" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-2 space-y-0.5">
          <p className="line-clamp-2 select-text text-xs font-medium leading-snug">{book.title}</p>
          <div className="flex items-baseline justify-between gap-2">
            {book.author ? (
              <p className="truncate select-text text-[11px] text-muted-foreground">{book.author}</p>
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
