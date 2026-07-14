import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageInfo: { currentPage: number; totalPages: number };
  onJump: (targetPage: number) => void;
}

export function ReaderJump({ open, onOpenChange, pageInfo, onJump }: Props) {
  const [pageInput, setPageInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPageInput("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(pageInput, 10);
    if (isNaN(num) || num < 1) return;
    const target = Math.min(num, pageInfo.totalPages);
    onJump(target);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-72 gap-0 p-0 sm:max-w-72">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-xs font-semibold">Jump to page</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 p-4">
          <input
            ref={inputRef}
            type="number"
            min={1}
            max={pageInfo.totalPages}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            placeholder={`1\u2013${pageInfo.totalPages}`}
            className="w-full bg-background border border-input text-xs px-2 py-1.5 outline-none"
          />
          <div className="text-[10px] text-muted-foreground">
            Page {pageInfo.currentPage} of {pageInfo.totalPages}
          </div>
          <button
            type="submit"
            className="w-full py-1.5 text-xs bg-foreground text-background hover:opacity-90 transition-opacity"
          >
            Go
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
