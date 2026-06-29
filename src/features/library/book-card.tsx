import { useEffect, useState } from "react";
import { Check, Clock3 } from "lucide-react";
import { BookContextMenu } from "./book-actions";
import { readingStatus, relativeTime } from "@/lib/format";
import { useLibraryPrefs } from "@/stores/library-prefs-store";
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
  const showMetadata = useLibraryPrefs((s) => s.showCardMetadata);

  // Fall back to the placeholder when the cover is missing or fails to decode;
  // reset the error when the cover changes.
  const [coverError, setCoverError] = useState(false);
  useEffect(() => setCoverError(false), [book.coverDataUrl]);
  const useFallback = !book.coverDataUrl || coverError;

  return (
    <BookContextMenu book={book}>
      <div className="flex flex-col">
        <div className="group/cover">
          <div className="relative aspect-2/3 w-full overflow-hidden bg-muted transition-all transform-gpu will-change-transform duration-300 ease-out group-hover/cover:-translate-y-1 group-hover/cover:shadow-xl">
            <button type="button" onClick={() => onOpen?.(book)} title={book.title} className="block h-full w-full cursor-pointer text-left">
              <img
                src={useFallback ? bookTemplate : (book.coverDataUrl ?? bookTemplate)}
                alt={useFallback ? "" : book.title}
                onError={() => setCoverError(true)}
                className="h-full w-full object-cover"
                draggable={false}
              />
            </button>

            {showMetadata && status === "finished" && (
              <div className="pointer-events-none absolute left-1.5 top-1.5 flex size-5 items-center justify-center bg-black/40 text-white shadow-sm backdrop-blur-xs">
                <Check className="size-3" />
              </div>
            )}

            {showMetadata && status === "reading" && lastRead && (
              <div className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 bg-black/30 px-1.5 py-1 text-[10px] font-medium leading-none text-white shadow-sm backdrop-blur-xs">
                <Clock3 className="size-2.5 opacity-80" />
                <span className="tabular-nums">{lastRead}</span>
              </div>
            )}

            {showMetadata && status === "reading" && pct > 0 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-linear-to-t from-black/40 to-transparent">
                <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
                  <div className="h-full bg-amber-700" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>

        {showMetadata && (
          <div className="mt-2 space-y-0.5">
            <p className="line-clamp-2 px-0.5 font-mincho text-xs leading-snug text-foreground select-text">{book.title}</p>
          </div>
        )}
      </div>
    </BookContextMenu>
  );
}
