import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * A single book in the library grid: cover, title, author, optional progress.
 * Hovering reveals a remove action (guarded by a confirm dialog).
 */
export function BookCard({ book, onOpen, onRemove }) {
  const progressPct = Math.round((book.progress ?? 0) * 100);

  return (
    <div className="group relative flex flex-col">
      <button
        type="button"
        onClick={() => onOpen?.(book)}
        title={book.title}
        className="relative block aspect-2/3 w-full overflow-hidden rounded-none border bg-muted text-left transition-colors hover:border-foreground/30"
      >
        {book.coverDataUrl ? (
          <img src={book.coverDataUrl} alt={book.title} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-3">
            <span className="line-clamp-5 text-center text-xs text-muted-foreground">{book.title}</span>
          </div>
        )}

        {progressPct > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/25">
            <div className="h-full bg-primary" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </button>

      <div className="mt-2 space-y-0.5">
        <p className="line-clamp-2 text-xs font-medium leading-snug">{book.title}</p>
        {book.author && <p className="truncate text-xs text-muted-foreground">{book.author}</p>}
      </div>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Remove book"
            className="absolute right-1.5 top-1.5 size-7 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove book?</AlertDialogTitle>
            <AlertDialogDescription>
              “{book.title}” will be removed from your library and its files deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => onRemove?.(book)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
