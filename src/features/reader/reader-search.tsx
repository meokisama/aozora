import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { SearchResult } from "@/lib/reader/search";

/** A search result with the chapter label + progress attached for display. */
type DisplayResult = SearchResult & { label: string; progress: number };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  results: DisplayResult[];
  total: number;
  capped: boolean;
  onJump: (result: DisplayResult) => void;
}

/**
 * In-book search sheet: a query field plus the list of matches. Each result
 * shows a snippet (with the matched run emphasised) and its chapter + progress,
 * and jumps to the hit's character offset on click.
 */
export function ReaderSearch({ open, onOpenChange, query, onQueryChange, results, total, capped, onJump }: Props) {
  const trimmed = query.trim();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-80 gap-0 p-0 sm:max-w-80">
        <SheetHeader className="border-b">
          <SheetTitle>Search</SheetTitle>
        </SheetHeader>
        <div className="border-b p-2">
          <div className="relative">
            <Input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search in book"
              aria-label="Search in book"
              autoFocus
              className={query ? "pr-8" : undefined}
            />
            {query && (
              <button
                type="button"
                onClick={() => onQueryChange("")}
                aria-label="Clear search"
                className="absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {trimmed && (
            <p className="px-1 pt-1.5 text-[10px] text-muted-foreground">
              {total === 0 ? "No matches" : `${total} match${total === 1 ? "" : "es"}${capped ? ` (showing first ${results.length})` : ""}`}
            </p>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onJump(r)}
              className="block w-full rounded-none px-2 py-1.5 text-left transition-colors hover:bg-accent"
            >
              <span className="block text-xs leading-relaxed">
                <span className="text-muted-foreground">{r.pre}</span>
                <mark className="bg-yellow-300/50 px-0.5 text-foreground">{r.hit}</mark>
                <span className="text-muted-foreground">{r.post}</span>
              </span>
              {r.label && (
                <span className="mt-0.5 block truncate text-[10px] tabular-nums text-muted-foreground/80">
                  {r.label} · {r.progress}%
                </span>
              )}
            </button>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
