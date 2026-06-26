// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import type { Book } from "@/lib/types";

// The store extracts metadata in the renderer and clears the IndexedDB cache on
// remove; both are external to the store's own logic, so mock them.
vi.mock("@/lib/epub/metadata", () => ({ extractEpubMetadata: vi.fn() }));
vi.mock("@/lib/reader-cache", () => ({ deleteCachedBook: vi.fn(() => Promise.resolve()) }));

import { useLibraryStore } from "@/stores/library-store";
import { extractEpubMetadata } from "@/lib/epub/metadata";
import { deleteCachedBook } from "@/lib/reader-cache";

let api: Record<string, Mock>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(extractEpubMetadata).mockResolvedValue({
    title: "T",
    author: "A",
    language: "ja",
    coverBytes: null,
    coverMime: null,
  });

  api = {
    pickFiles: vi.fn(),
    readFile: vi.fn(() => new Uint8Array([1, 2, 3])),
    addBook: vi.fn((b) => Promise.resolve({ id: "new", ...b })),
    list: vi.fn(() => Promise.resolve([])),
    remove: vi.fn(() => Promise.resolve(true)),
    getPathForFile: vi.fn((f) => `/drop/${f.name}`),
  };
  window.electronAPI = { library: api } as unknown as typeof window.electronAPI;

  useLibraryStore.setState({ books: [], loading: true, importing: false });
});

describe("loadBooks", () => {
  it("loads from the main process and clears loading", async () => {
    api.list.mockResolvedValueOnce([{ id: "b1" }]);
    await useLibraryStore.getState().loadBooks();
    const s = useLibraryStore.getState();
    expect(s.books).toEqual([{ id: "b1" }]);
    expect(s.loading).toBe(false);
  });

  it("clears loading even when list rejects, and rethrows", async () => {
    api.list.mockRejectedValueOnce(new Error("boom"));
    await expect(useLibraryStore.getState().loadBooks()).rejects.toThrow("boom");
    expect(useLibraryStore.getState().loading).toBe(false);
  });
});

describe("importBooks (native picker)", () => {
  it("returns an empty summary when the picker is cancelled", async () => {
    api.pickFiles.mockResolvedValueOnce([]);
    const res = await useLibraryStore.getState().importBooks();
    expect(res).toEqual({ added: 0, failed: [] });
    expect(api.addBook).not.toHaveBeenCalled();
  });

  it("imports each picked file and refreshes the list", async () => {
    api.pickFiles.mockResolvedValueOnce([
      { path: "/a.epub", name: "a.epub", size: 1 },
      { path: "/b.epub", name: "b.epub", size: 2 },
    ]);
    api.list.mockResolvedValueOnce([{ id: "x" }, { id: "y" }]);
    const res = await useLibraryStore.getState().importBooks();
    expect(api.addBook).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ added: 2, failed: [] });
    expect(useLibraryStore.getState().books).toHaveLength(2);
    expect(useLibraryStore.getState().importing).toBe(false);
  });

  it("records a failed file when extraction throws and keeps importing the rest", async () => {
    api.pickFiles.mockResolvedValueOnce([
      { path: "/bad.epub", name: "bad.epub", size: 1 },
      { path: "/ok.epub", name: "ok.epub", size: 2 },
    ]);
    vi.mocked(extractEpubMetadata)
      .mockRejectedValueOnce(new Error("corrupt"))
      .mockResolvedValueOnce({ title: "ok", author: "", language: "ja", coverBytes: null, coverMime: null });
    const res = await useLibraryStore.getState().importBooks();
    expect(res.added).toBe(1);
    expect(res.failed).toEqual(["bad.epub"]);
    expect(api.addBook).toHaveBeenCalledTimes(1);
  });
});

describe("importDroppedFiles", () => {
  it("keeps only .epub files (case-insensitive) and resolves their paths", async () => {
    const fileList = [
      { name: "novel.EPUB", size: 10 },
      { name: "notes.txt", size: 5 },
      { name: "vol2.epub", size: 20 },
    ];
    const res = await useLibraryStore.getState().importDroppedFiles(fileList as unknown as FileList);
    expect(api.getPathForFile).toHaveBeenCalledTimes(2);
    expect(api.addBook).toHaveBeenCalledTimes(2);
    expect(res.added).toBe(2);
  });

  it("returns an empty summary when nothing is an epub", async () => {
    const res = await useLibraryStore.getState().importDroppedFiles([{ name: "a.pdf", size: 1 }] as unknown as FileList);
    expect(res).toEqual({ added: 0, failed: [] });
    expect(api.addBook).not.toHaveBeenCalled();
  });
});

describe("removeBook", () => {
  it("removes via IPC, clears the cache, and drops it from the list", async () => {
    useLibraryStore.setState({ books: [{ id: "b1" }, { id: "b2" }] as unknown as Book[] });
    await useLibraryStore.getState().removeBook("b1");
    expect(api.remove).toHaveBeenCalledWith("b1");
    expect(deleteCachedBook).toHaveBeenCalledWith("b1");
    expect(useLibraryStore.getState().books).toEqual([{ id: "b2" }]);
  });
});

describe("applyProgress", () => {
  it("merges progress fields into the matching book only", () => {
    useLibraryStore.setState({ books: [{ id: "b1", progress: 0 }, { id: "b2", progress: 0 }] as unknown as Book[] });
    useLibraryStore.getState().applyProgress("b1", { progress: 0.5, exploredCharCount: 100 });
    const books = useLibraryStore.getState().books;
    expect(books[0]).toMatchObject({ id: "b1", progress: 0.5, exploredCharCount: 100 });
    expect(books[1]).toEqual({ id: "b2", progress: 0 });
  });
});
