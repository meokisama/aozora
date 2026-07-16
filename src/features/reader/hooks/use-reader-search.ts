import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Book } from "@/lib/types";
import type { Section } from "@/lib/epub/generate-html";
import type { ParsedBook } from "@/lib/epub/parse-book";
import type { PaginatedController } from "@/lib/reader/paginated";
import { buildSearchIndex, searchIndex, type SearchResult, type SearchIndexEntry } from "@/lib/reader/search";
import { clearSearchHighlight, highlightSearchResult } from "@/lib/reader/highlight";
import { chapterIndexAt } from "@/lib/reader/chapters";

type ReaderMode = "continuous" | "paginated" | "fixed";

interface Params {
  book: Book | null;
  chapters: Section[];
  total: number;
  hostRef: RefObject<HTMLDivElement | null>;
  modeRef: RefObject<ReaderMode>;
  charRef: RefObject<number>;
  parsedRef: RefObject<ParsedBook | null>;
  controllerRef: RefObject<PaginatedController | null>;
  jumpToChar: (char: number) => void;
}

/**
 * In-book search: the sheet's open state, query, and results, backed by an index
 * built lazily from the parsed HTML on first search and reused. Jumping to a hit
 * navigates in whichever mode is active and highlights the run once it's on screen.
 */
export function useReaderSearch({ book, chapters, total, hostRef, modeRef, charRef, parsedRef, controllerRef, jumpToChar }: Params) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ results: SearchResult[]; total: number; capped: boolean }>({
    results: [],
    total: 0,
    capped: false,
  });
  const searchIndexRef = useRef<SearchIndexEntry[] | null>(null); // lazily built on first search

  // Reset on book change: the index and any highlight belong to the old book.
  useEffect(() => {
    searchIndexRef.current = null;
    clearSearchHighlight();
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults({ results: [], total: 0, capped: false });
  }, [book]);

  // Queries the in-book index, built lazily from the parsed HTML once and reused.
  const runSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (!query.trim()) {
        setSearchResults({ results: [], total: 0, capped: false });
        return;
      }
      if (!searchIndexRef.current && parsedRef.current) {
        searchIndexRef.current = buildSearchIndex(parsedRef.current.elementHtml);
      }
      setSearchResults(searchIndex(searchIndexRef.current || [], query));
    },
    [parsedRef],
  );

  // Jumps to a search hit and highlights it. The highlight waits until the target
  // is on screen (the paginated controller renders its section asynchronously).
  const jumpToSearchResult = useCallback(
    async (result: SearchResult) => {
      setSearchOpen(false);
      clearSearchHighlight();
      const query = searchQuery;
      const root = () => hostRef.current?.shadowRoot;
      if (modeRef.current === "paginated") {
        const ctrl = controllerRef.current;
        if (!ctrl) return;
        charRef.current = result.charOffset;
        await ctrl.restoreToChar(result.charOffset); // emits onChange → state + save
        requestAnimationFrame(() => {
          highlightSearchResult(root()?.querySelector(".aoz-page-content") ?? null, result.charOffset, query, ctrl.sectionStart);
        });
        return;
      }
      jumpToChar(result.charOffset);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          highlightSearchResult(root()?.querySelector(".aozora-content") ?? null, result.charOffset, query, 0);
        }),
      );
    },
    [jumpToChar, searchQuery, hostRef, modeRef, charRef, controllerRef],
  );

  // Attach chapter label + progress to each hit for display (mirrors the
  // active-chapter / bookmark-name logic).
  const searchDisplay = useMemo(() => {
    return searchResults.results.map((r) => {
      const i = chapterIndexAt(chapters, r.charOffset);
      const label = i >= 0 ? chapters[i].label || "" : "";
      const progress = total ? Math.round((r.charOffset / total) * 100) : 0;
      return { ...r, label, progress };
    });
  }, [searchResults, chapters, total]);

  return { searchOpen, setSearchOpen, searchQuery, runSearch, searchResults, searchDisplay, jumpToSearchResult };
}
