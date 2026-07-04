import { Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { colorSwatch } from "@/lib/reader/annotations";
import type { Annotation } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  annotations: Annotation[];
  onJump: (char: number) => void;
  onRemove: (id: string) => void;
}

/**
 * Highlights sheet: the list of saved highlights (colour dot + selected snippet +
 * any note + progress), each jumping to its position or deletable. Colour and note
 * are edited in-place from the reader (click a highlight); this panel is the
 * overview / jump list.
 */
export function ReaderAnnotations({ open, onOpenChange, annotations, onJump, onRemove }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 gap-0 p-0 sm:max-w-72">
        <SheetHeader className="border-b">
          <SheetTitle>Highlights</SheetTitle>
        </SheetHeader>
        <nav className="flex-1 overflow-y-auto p-2">
          {annotations.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">No highlights yet. Select text in the reader to highlight it.</p>
          ) : (
            annotations.map((a) => (
              <div key={a.id} className="group flex items-start gap-2 rounded-none px-2 py-1.5 transition-colors hover:bg-accent">
                <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorSwatch(a.color) }} aria-hidden />
                <button type="button" onClick={() => onJump(a.startChar)} className="min-w-0 flex-1 text-left" title={a.snippet || ""}>
                  <span className="block truncate text-xs">{a.snippet || "(highlight)"}</span>
                  {a.note && <span className="mt-0.5 block truncate text-[11px] italic text-muted-foreground">{a.note}</span>}
                  <span className="text-[10px] tabular-nums text-muted-foreground">{Math.round((a.progress || 0) * 100)}%</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(a.id)}
                  aria-label="Delete highlight"
                  className="shrink-0 cursor-pointer rounded-none p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
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
