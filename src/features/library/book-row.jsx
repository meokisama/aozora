import { useEffect, useState } from "react";
import { MoreVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BookActionsMenu, BookContextMenu } from "./book-actions";
import { readingStatus, relativeTime, STATUS_LABELS } from "@/lib/format";
import bookTemplate from "@/assets/book-template.png";

const STATUS_VARIANT = {
  unread: "outline",
  reading: "secondary",
  finished: "default",
};

/**
 * A single book as a list row: small cover, title/author, status, progress and
 * last-read time. Hovering reveals a "⋯" actions menu; right-clicking opens the
 * same actions as the grid card.
 */
export function BookRow({ book, onOpen }) {
  const status = readingStatus(book);
  const pct = Math.round((book.progress ?? 0) * 100);
  const lastRead = relativeTime(book.lastOpenedAt);

  // Fall back to the template placeholder when the cover is missing or fails.
  const [coverError, setCoverError] = useState(false);
  useEffect(() => setCoverError(false), [book.coverDataUrl]);
  const coverSrc = !book.coverDataUrl || coverError ? bookTemplate : book.coverDataUrl;

  return (
    <BookContextMenu book={book}>
      <div className="group/row flex items-center gap-3 border-b px-2 py-2 transition-colors hover:bg-muted/40">
        <button
          type="button"
          onClick={() => onOpen?.(book)}
          title={book.title}
          className="relative h-14 w-10 shrink-0 overflow-hidden rounded-[3px] border bg-muted transform-gpu transition-transform duration-200 ease-out will-change-transform backface-hidden group-hover/row:-translate-y-1 group-hover/row:-rotate-6"
        >
          <img src={coverSrc} alt="" onError={() => setCoverError(true)} className="h-full w-full rounded-[3px] object-cover" draggable={false} />
        </button>

        <button type="button" onClick={() => onOpen?.(book)} className="min-w-0 flex-1 text-left">
          <p className="truncate text font-medium">{book.title}</p>
          {book.author && <p className="truncate text-xs text-muted-foreground">{book.author}</p>}
        </button>

        <Badge variant={STATUS_VARIANT[status]} className="hidden shrink-0 sm:inline-flex">
          {STATUS_LABELS[status]}
        </Badge>

        <div className="hidden w-28 shrink-0 items-center gap-2 md:flex">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-amber-700" style={{ width: `${pct}%` }} />
          </div>
          <span className="w-8 text-right text-[11px] text-muted-foreground tabular-nums">{pct}%</span>
        </div>

        <span className="hidden w-16 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums lg:inline">{lastRead}</span>

        <BookActionsMenu
          book={book}
          trigger={
            <button
              type="button"
              aria-label="Book actions"
              className="flex size-7 shrink-0 items-center justify-center text-muted-foreground opacity-0 transition-colors hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreVertical className="size-4" />
            </button>
          }
        />
      </div>
    </BookContextMenu>
  );
}
