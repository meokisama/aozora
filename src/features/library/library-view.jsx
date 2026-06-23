import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, BookPlus, LayoutGrid, List, Loader2, Search, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookCard } from "./book-card";
import { BookRow } from "./book-row";
import { LibrarySidebar } from "./library-sidebar";
import { useLibraryStore } from "@/stores/library-store";
import { useReaderStore } from "@/stores/reader-store";
import { useLibraryPrefs, SORT_OPTIONS } from "@/stores/library-prefs-store";
import { readingStatus } from "@/lib/format";

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "reading", label: "Reading" },
  { value: "finished", label: "Finished" },
  { value: "unread", label: "Unread" },
];

/**
 * Normalizes a string for search matching: NFKC-folds half/full-width forms
 * (so 半角ｶﾅ ↔ 全角カナ and ＡＢＣ ↔ ABC match) and strips ALL whitespace,
 * including the full-width ideographic space U+3000 — JS `\s` covers it. This
 * makes "かずきふみ" and "かずき　ふみ" compare equal. Returns lowercase.
 */
function normalizeSearch(str) {
  return (str ?? "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/** Pure sort over a copy — never returned straight from a Zustand selector. */
function sortBooks(list, sort) {
  const arr = [...list];
  switch (sort) {
    case "added":
      arr.sort((a, b) => b.addedAt - a.addedAt);
      break;
    case "title":
      arr.sort((a, b) => a.title.localeCompare(b.title, "ja"));
      break;
    case "author":
      arr.sort((a, b) => (a.author || "￿").localeCompare(b.author || "￿", "ja"));
      break;
    case "progress":
      arr.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
      break;
    case "lastOpened":
    default:
      arr.sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0) || b.addedAt - a.addedAt);
      break;
  }
  return arr;
}

/**
 * The library home: a left sidebar (status nav / authors / progress / import)
 * beside a main column with a toolbar (search / sort / view), a "Continue
 * reading" shelf and the full grid (or list) of imported books.
 */
export function LibraryView() {
  const books = useLibraryStore((s) => s.books);
  const loading = useLibraryStore((s) => s.loading);
  const importing = useLibraryStore((s) => s.importing);
  const importProgress = useLibraryStore((s) => s.importProgress);
  const loadBooks = useLibraryStore((s) => s.loadBooks);
  const importBooks = useLibraryStore((s) => s.importBooks);
  const importDroppedFiles = useLibraryStore((s) => s.importDroppedFiles);
  const openReader = useReaderStore((s) => s.open);

  const sort = useLibraryPrefs((s) => s.sort);
  const setSort = useLibraryPrefs((s) => s.setSort);
  const view = useLibraryPrefs((s) => s.view);
  const setView = useLibraryPrefs((s) => s.setView);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [authorFilter, setAuthorFilter] = useState(null); // selected author name, or null for all

  // dragenter/dragleave fire for every child element, so track depth with a
  // counter to know when the cursor has truly left the drop zone.
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    loadBooks().catch(() => toast.error("Failed to load library"));
  }, [loadBooks]);

  // Status counts for the tab labels (over the whole library, ignoring search).
  const counts = useMemo(() => {
    const c = { all: books.length, favorites: 0, reading: 0, finished: 0, unread: 0 };
    for (const b of books) {
      c[readingStatus(b)] += 1;
      if (b.favorite) c.favorites += 1;
    }
    return c;
  }, [books]);

  // Books matching the active status tab + author + search box, then sorted.
  const visibleBooks = useMemo(() => {
    const q = normalizeSearch(search);
    const filtered = books.filter((b) => {
      if (statusFilter === "favorites") {
        if (!b.favorite) return false;
      } else if (statusFilter !== "all" && readingStatus(b) !== statusFilter) {
        return false;
      }
      if (authorFilter && b.author?.trim() !== authorFilter) return false;
      if (q && !(normalizeSearch(b.title) + normalizeSearch(b.author)).includes(q)) return false;
      return true;
    });
    return sortBooks(filtered, sort);
  }, [books, statusFilter, authorFilter, search, sort]);

  // The "Continue reading" shelf: the 10 most-recently-read in-progress books,
  // in a horizontal strip. Capped at 10 — beyond that the sort + Reading tab
  // cover it. Only shown on the unfiltered "All" view so it never duplicates
  // the grid below.
  const continueReading = useMemo(() => {
    if (statusFilter !== "all" || authorFilter || search.trim()) return [];
    return books
      .filter((b) => readingStatus(b) === "reading")
      .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))
      .slice(0, 10);
  }, [books, statusFilter, authorFilter, search]);

  // A single sticky toast that tracks import progress ("Importing 3/10…") and is
  // dismissed when the run ends; the final success/error toast is shown by
  // reportImport. Reusing one toast id keeps it updating in place.
  const importToastId = useRef(null);
  useEffect(() => {
    if (importing) {
      const msg =
        importProgress && importProgress.total > 1
          ? `Importing ${importProgress.current}/${importProgress.total}…`
          : "Importing…";
      importToastId.current = toast.loading(msg, { id: importToastId.current ?? undefined });
    } else if (importToastId.current != null) {
      toast.dismiss(importToastId.current);
      importToastId.current = null;
    }
  }, [importing, importProgress]);

  const reportImport = ({ added, failed }) => {
    if (added) toast.success(`Imported ${added} book${added > 1 ? "s" : ""}`);
    if (failed.length) toast.error(`Could not import: ${failed.join(", ")}`);
  };

  const handleImport = async () => {
    try {
      reportImport(await importBooks());
    } catch {
      toast.error("Import failed");
    }
  };

  const handleDragEnter = (e) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    dragDepth.current += 1;
    setDragging(true);
  };

  const handleDragOver = (e) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = e.dataTransfer.files;
    if (!files?.length) return;
    if (!Array.from(files).some((f) => f.name.toLowerCase().endsWith(".epub"))) {
      toast.error("Only EPUB files can be imported");
      return;
    }
    try {
      reportImport(await importDroppedFiles(files));
    } catch {
      toast.error("Import failed");
    }
  };

  // "Importing 3/10…" when batch-importing, plain "Importing…" for a single file.
  const importLabel = importing
    ? importProgress && importProgress.total > 1
      ? `Importing ${importProgress.current}/${importProgress.total}…`
      : "Importing…"
    : "Import EPUB";

  const importButton = (
    <Button onClick={handleImport} disabled={importing}>
      {importing ? <Loader2 className="size-4 animate-spin" /> : <BookPlus className="size-4" />}
      {importLabel}
    </Button>
  );

  const renderBooks = (list) =>
    view === "list" ? (
      <div className="flex flex-col">
        {list.map((book) => (
          <BookRow key={book.id} book={book} onOpen={openReader} />
        ))}
      </div>
    ) : (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-5 gap-y-6">
        {list.map((book) => (
          <BookCard key={book.id} book={book} onOpen={openReader} />
        ))}
      </div>
    );

  const heading =
    authorFilter ??
    (statusFilter === "all"
      ? "All books"
      : statusFilter === "favorites"
        ? "Favorites"
        : STATUS_TABS.find((t) => t.value === statusFilter)?.label);

  return (
    <div className="relative flex h-full" onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-50 flex flex-col items-center justify-center gap-3 rounded-none border-2 border-dashed border-primary bg-background/85 backdrop-blur-sm">
          <UploadCloud className="size-10 text-primary" strokeWidth={1.5} />
          <p className="text-sm font-medium">Drop EPUB files to import</p>
        </div>
      )}

      {books.length > 0 && (
        <LibrarySidebar
          books={books}
          counts={counts}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          authorFilter={authorFilter}
          setAuthorFilter={setAuthorFilter}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {books.length > 0 && (
          <header className="flex h-12 shrink-0 items-center gap-3 border-b px-6">
            <div className="relative w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or author" className="pr-7 pl-8" />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            <div className="ml-auto flex items-center gap-1">
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger size="default" className="w-32">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ArrowUpDown className="size-3.5 text-muted-foreground" />
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <ToggleGroup type="single" variant="outline" spacing={0} value={view} onValueChange={(v) => v && setView(v)} size="default">
                <ToggleGroupItem value="grid" aria-label="Grid view">
                  <LayoutGrid className="size-3.5" />
                </ToggleGroupItem>
                <ToggleGroupItem value="list" aria-label="List view">
                  <List className="size-3.5" />
                </ToggleGroupItem>
              </ToggleGroup>

              {importButton}
            </div>
          </header>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : books.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="flex w-full max-w-sm flex-col items-center gap-4 border-2 border-dashed border-border px-8 py-12 text-center">
              <UploadCloud className="size-10 text-muted-foreground" strokeWidth={1.5} />
              <div className="space-y-1">
                <p className="text-sm font-medium">Your library is empty</p>
                <p className="text-xs text-muted-foreground">Drag &amp; drop EPUB files here, or import them manually.</p>
              </div>
              {importButton}
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-8 overflow-auto p-6">
            {continueReading.length > 0 && (
              <section>
                <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Continue reading</h2>
                {/* Horizontal strip (no wrap): fixed-width cards scroll sideways.
                    overflow-x-auto forces overflow-y to auto too, which would clip
                    a card's hover-lift/shadow. -my-3/py-3 carves out room for it
                    while the negative margin cancels the gap, so the strip lines up
                    with the grid below exactly as if it had no padding. */}
                <div className="flex gap-5 overflow-x-auto -my-3 py-3">
                  {continueReading.map((book) => (
                    <div key={book.id} className="w-35 shrink-0">
                      <BookCard book={book} onOpen={openReader} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {heading}
                <span className="ml-1.5 text-muted-foreground/70 tabular-nums">({visibleBooks.length})</span>
              </h2>
              {visibleBooks.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <Search className="size-7 text-muted-foreground/60" strokeWidth={1.5} />
                  <p className="text-xs text-muted-foreground">No books match your filters.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("all");
                      setAuthorFilter(null);
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              ) : (
                renderBooks(visibleBooks)
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
