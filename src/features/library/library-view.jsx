import { useEffect } from "react";
import { BookPlus, Library, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BookCard } from "./book-card";
import { useLibraryStore } from "@/stores/library-store";
import { useReaderStore } from "@/stores/reader-store";

/**
 * The library home: a grid of imported books with an import action.
 * Reading is wired up in a later phase.
 */
export function LibraryView() {
  const books = useLibraryStore((s) => s.books);
  const loading = useLibraryStore((s) => s.loading);
  const importing = useLibraryStore((s) => s.importing);
  const loadBooks = useLibraryStore((s) => s.loadBooks);
  const importBooks = useLibraryStore((s) => s.importBooks);
  const removeBook = useLibraryStore((s) => s.removeBook);
  const openReader = useReaderStore((s) => s.open);

  useEffect(() => {
    loadBooks().catch(() => toast.error("Failed to load library"));
  }, [loadBooks]);

  const handleImport = async () => {
    try {
      const { added, failed } = await importBooks();
      if (added) {
        toast.success(`Imported ${added} book${added > 1 ? "s" : ""}`);
      }
      if (failed.length) {
        toast.error(`Could not import: ${failed.join(", ")}`);
      }
    } catch {
      toast.error("Import failed");
    }
  };

  const handleOpen = (book) => {
    openReader(book);
  };

  const handleRemove = async (book) => {
    try {
      await removeBook(book.id);
      toast.success("Book removed");
    } catch {
      toast.error("Failed to remove book");
    }
  };

  const importButton = (
    <Button onClick={handleImport} disabled={importing}>
      {importing ? <Loader2 className="size-4 animate-spin" /> : <BookPlus className="size-4" />}
      {importing ? "Importing…" : "Import EPUB"}
    </Button>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-sm font-semibold">Library</h1>
          <p className="text-xs text-muted-foreground">
            {books.length} {books.length === 1 ? "book" : "books"}
          </p>
        </div>
        {books.length > 0 && importButton}
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : books.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <Library className="size-10 text-muted-foreground" strokeWidth={1.5} />
          <div className="space-y-1">
            <p className="text-sm font-medium">Your library is empty</p>
            <p className="text-xs text-muted-foreground">Import EPUB files to start building your collection.</p>
          </div>
          {importButton}
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-5 gap-y-6">
            {books.map((book) => (
              <BookCard key={book.id} book={book} onOpen={handleOpen} onRemove={handleRemove} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
