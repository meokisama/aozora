import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLibraryStore } from "@/stores/library-store";

/**
 * Edit a book's title, author and cover. The cover is chosen with a plain file
 * input and read to an ArrayBuffer here in the renderer; the bytes are handed to
 * the main process (same path covers take at import) which downscales and stores
 * them.
 */
export function BookEditDialog({ book, open, onOpenChange }) {
  const updateBook = useLibraryStore((s) => s.updateBook);
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author ?? "");
  const [cover, setCover] = useState(null); // { bytes, mime, previewUrl } | null
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  // Reset the form each time the dialog opens (the same component instance is
  // reused across edits of the same card).
  useEffect(() => {
    if (open) {
      setTitle(book.title);
      setAuthor(book.author ?? "");
      setCover(null);
    }
  }, [open, book]);

  // Release the preview object URL when it is replaced or the dialog unmounts.
  useEffect(() => () => cover?.previewUrl && URL.revokeObjectURL(cover.previewUrl), [cover]);

  const pickCover = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    const bytes = await file.arrayBuffer();
    setCover({ bytes, mime: file.type, previewUrl: URL.createObjectURL(file) });
  };

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Title can't be empty");
      return;
    }
    setSaving(true);
    try {
      await updateBook(book.id, {
        title: trimmed,
        author: author.trim(),
        ...(cover ? { coverBytes: cover.bytes, coverMime: cover.mime } : {}),
      });
      toast.success("Book updated");
      onOpenChange(false);
    } catch {
      toast.error("Failed to update book");
    } finally {
      setSaving(false);
    }
  };

  const previewSrc = cover?.previewUrl ?? book.coverDataUrl;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>Update the title, author, or cover image.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="group relative aspect-2/3 w-24 shrink-0 overflow-hidden border bg-muted transition-colors hover:border-foreground/30"
            aria-label="Change cover"
          >
            {previewSrc ? (
              <img src={previewSrc} alt="" className="h-full w-full object-cover" draggable={false} />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <ImagePlus className="size-5 text-muted-foreground" />
              </div>
            )}
            <span className="absolute inset-x-0 bottom-0 bg-black/60 py-1 text-center text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
              Change
            </span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickCover} />

          <div className="flex flex-1 flex-col gap-3">
            <label className="space-y-1.5">
              <span className="text-xs font-medium">Title</span>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Book title" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium">Author</span>
              <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author (optional)" />
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
