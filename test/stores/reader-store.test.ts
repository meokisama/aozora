import { describe, it, expect, beforeEach } from "vitest";
import { useReaderStore } from "@/stores/reader-store";
import type { Book } from "@/lib/types";

beforeEach(() => {
  useReaderStore.setState({ currentBook: null });
});

describe("reader-store", () => {
  it("starts with no open book", () => {
    expect(useReaderStore.getState().currentBook).toBeNull();
  });

  it("open() sets the current book", () => {
    const book = { id: "b1", title: "T" } as Book;
    useReaderStore.getState().open(book);
    expect(useReaderStore.getState().currentBook).toBe(book);
  });

  it("close() clears the current book", () => {
    useReaderStore.getState().open({ id: "b1" } as Book);
    useReaderStore.getState().close();
    expect(useReaderStore.getState().currentBook).toBeNull();
  });
});
