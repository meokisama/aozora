import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Section } from "@/lib/epub/generate-html";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chapters: Section[];
  activeChapterId: string | null;
  onJump: (reference: string) => void;
}

/** Table-of-contents sheet: lists TOC chapters and jumps to the chosen one. */
export function ReaderToc({ open, onOpenChange, chapters, activeChapterId, onJump }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 gap-0 p-0 sm:max-w-72">
        <SheetHeader className="border-b">
          <SheetTitle>Table of Contents</SheetTitle>
        </SheetHeader>
        <nav className="flex-1 overflow-y-auto p-2">
          {chapters.map((ch) => (
            <button
              key={ch.reference}
              type="button"
              onClick={() => onJump(ch.reference)}
              className={`block w-full truncate rounded-none px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent ${
                ch.reference === activeChapterId ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground"
              }`}
              title={ch.label}
            >
              {ch.label}
            </button>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
