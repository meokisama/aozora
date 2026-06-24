import { BookmarkPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Bookmark } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookmarks: Bookmark[];
  nameInput: string;
  onNameInputChange: (value: string) => void;
  onAdd: () => void;
  onJump: (char: number) => void;
  onRemove: (id: string) => void;
}

/**
 * Bookmarks sheet: an add field (pre-filled with a suggested name) plus the
 * list of saved bookmarks, each jumping to its character offset or deletable.
 */
export function ReaderBookmarks({ open, onOpenChange, bookmarks, nameInput, onNameInputChange, onAdd, onJump, onRemove }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 gap-0 p-0 sm:max-w-72">
        <SheetHeader className="border-b">
          <SheetTitle>Bookmarks</SheetTitle>
        </SheetHeader>
        <div className="flex items-center gap-1 border-b p-2">
          <Input
            value={nameInput}
            onChange={(e) => onNameInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAdd();
              }
            }}
            placeholder="Bookmark name"
            aria-label="Bookmark name"
          />
          <Button variant="outline" size="icon" className="size-8 shrink-0" onClick={onAdd} aria-label="Add bookmark">
            <BookmarkPlus className="size-4" />
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {bookmarks.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">No bookmarks yet.</p>
          ) : (
            bookmarks.map((bm) => (
              <div key={bm.id} className="group flex items-start gap-1 rounded-none px-2 py-1.5 transition-colors hover:bg-accent">
                <button type="button" onClick={() => onJump(bm.charOffset)} className="min-w-0 flex-1 text-left" title={bm.snippet || ""}>
                  <span className="block truncate text-xs">{bm.snippet || "(unnamed)"}</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">{Math.round((bm.progress || 0) * 100)}%</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(bm.id)}
                  aria-label="Delete bookmark"
                  className="shrink-0 rounded-none p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
