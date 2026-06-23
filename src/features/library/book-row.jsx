import { MoreVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BookActionsMenu, BookContextMenu } from "./book-actions";
import { readingStatus, relativeTime, STATUS_LABELS } from "@/lib/format";

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

  return (
    <BookContextMenu book={book}>
      <div className="group/row flex items-center gap-3 border-b px-2 py-2 transition-colors hover:bg-muted/40">
        <button
          type="button"
          onClick={() => onOpen?.(book)}
          title={book.title}
          className="relative h-14 w-10 shrink-0 overflow-hidden border bg-muted transition-colors group-hover/row:border-foreground/30"
        >
          {book.coverDataUrl ? <img src={book.coverDataUrl} alt="" className="h-full w-full object-cover" draggable={false} /> : null}
        </button>

        <button type="button" onClick={() => onOpen?.(book)} className="min-w-0 flex-1 text-left">
          <p className="truncate text-xs font-medium">{book.title}</p>
          {book.author && <p className="truncate text-[11px] text-muted-foreground">{book.author}</p>}
        </button>

        <Badge variant={STATUS_VARIANT[status]} className="hidden shrink-0 sm:inline-flex">
          {STATUS_LABELS[status]}
        </Badge>

        <div className="hidden w-28 shrink-0 items-center gap-2 md:flex">
          <div className="h-1 flex-1 overflow-hidden bg-muted">
            <div className="h-full bg-muted-foreground/70" style={{ width: `${pct}%` }} />
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
