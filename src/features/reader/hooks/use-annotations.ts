import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Annotation, Book } from "@/lib/types";
import type { PaginatedController } from "@/lib/reader/paginated";
import { paintAnnotations, clearAnnotationHighlights, rangeToCharSpan, charOffsetAt, annotationAtOffset } from "@/lib/reader/annotations";
import { caretRangeFromPoint } from "@/lib/reader/lookup-text";

const api = () => window.electronAPI.library;

type ReaderMode = "continuous" | "paginated" | "fixed";

/** Highlight editor state: anchored to a fresh selection (id null, awaiting a
 *  colour pick) or an existing highlight (id set, editable). */
export interface AnnoPopoverState {
  anchor: DOMRect;
  id: string | null;
  color: string;
  note: string;
  startChar: number;
  endChar: number;
  text: string;
}

/** Pending selection awaiting the highlight button: the trigger anchors to `point`
 *  (mouse-release), picking it opens the editor against `rect` (selection box). No
 *  highlight exists until then. */
export interface AnnoTriggerState {
  point: { x: number; y: number };
  rect: DOMRect;
  startChar: number;
  endChar: number;
  text: string;
}

interface Params {
  book: Book | null;
  parseToken: number;
  readingMode: string;
  hostRef: RefObject<HTMLDivElement | null>;
  modeRef: RefObject<ReaderMode>;
  controllerRef: RefObject<PaginatedController | null>;
  readyRef: RefObject<boolean>;
  totalRef: RefObject<number>;
  clearLookup: () => void;
  clearFootnote: () => void;
}

/**
 * Text highlights + notes for the current book: the list, the pending-selection
 * trigger, and the colour/note editor popover. Painting is char-offset anchored
 * (CSS Custom Highlight), so ranges survive scroll/reflow; the caller repaints on
 * content rebuild and paginated section swaps via the returned `repaintAnnotations`.
 */
export function useAnnotations({
  book,
  parseToken,
  readingMode,
  hostRef,
  modeRef,
  controllerRef,
  readyRef,
  totalRef,
  clearLookup,
  clearFootnote,
}: Params) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annoPopover, setAnnoPopover] = useState<AnnoPopoverState | null>(null);
  const [annoTrigger, setAnnoTrigger] = useState<AnnoTriggerState | null>(null);

  // Ref mirrors so ref-only callers (the paginated onChange, scroll/flip handlers)
  // can read current values without a dep.
  const annotationsRef = useRef<Annotation[]>([]);
  const annoPopoverRef = useRef<AnnoPopoverState | null>(null);
  annotationsRef.current = annotations;
  annoPopoverRef.current = annoPopover;

  // Load this book's highlights (repainted onto the content by the caller). The
  // old book's list + washes clear immediately so nothing bleeds across a swap.
  useEffect(() => {
    clearAnnotationHighlights();
    setAnnotations([]);
    setAnnoPopover(null);
    if (!book) return;
    let cancelled = false;
    api()
      .listAnnotations(book.id)
      .then((list) => {
        if (!cancelled) setAnnotations(list || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [book]);

  /** Repaints the highlight washes for whatever region is currently rendered
   *  (the whole book in continuous mode, the current section in paginated). Reads
   *  refs only, so it's stable and safe to call from the controller's onChange. */
  const repaintAnnotations = useCallback(() => {
    if (!readyRef.current) return;
    const shadow = hostRef.current?.shadowRoot;
    if (!shadow) return;
    if (modeRef.current === "paginated") {
      paintAnnotations(shadow.querySelector(".aoz-page-content"), annotationsRef.current, controllerRef.current?.sectionStart ?? 0);
    } else if (modeRef.current === "continuous") {
      paintAnnotations(shadow.querySelector(".aozora-content"), annotationsRef.current, 0);
    }
  }, [readyRef, hostRef, modeRef, controllerRef]);

  // Repaint whenever the highlight set changes (add / recolour / delete), the
  // content is rebuilt, or the feature is toggled. Continuous ranges persist
  // across scroll/reflow, so this need not run on scroll; paginated section swaps
  // repaint via the caller's onChange.
  useEffect(() => {
    repaintAnnotations();
  }, [annotations, parseToken, repaintAnnotations]);

  // A content rebuild or mode switch invalidates the open editor / trigger anchor.
  useEffect(() => {
    setAnnoPopover(null);
    setAnnoTrigger(null);
  }, [parseToken, readingMode]);

  // Closes the highlight editor, persisting a changed note for an existing one.
  // Stable (reads refs only) so scroll/flip handlers can dismiss it.
  const closeAnnoPopover = useCallback(() => {
    const p = annoPopoverRef.current;
    if (!p) return;
    if (p.id) {
      const current = annotationsRef.current.find((a) => a.id === p.id);
      const note = p.note.trim();
      if (current && (current.note ?? "") !== note) {
        setAnnotations((prev) => prev.map((a) => (a.id === p.id ? { ...a, note: note || null } : a)));
        api()
          .updateAnnotation({ id: p.id, note: note || null })
          .catch(() => {});
      }
    }
    setAnnoPopover(null);
  }, []);

  const clearAnnoTrigger = useCallback(() => setAnnoTrigger(null), []);
  const setPopoverNote = useCallback((note: string) => setAnnoPopover((p) => (p ? { ...p, note } : p)), []);

  // Picks a colour in the editor: creates the highlight (from a fresh selection)
  // or recolours the existing one. The highlight only lands in the DB on this
  // first colour pick, so merely selecting text to copy never persists anything.
  const handleAnnoColor = useCallback(
    async (color: string) => {
      const p = annoPopoverRef.current;
      if (!p || !book) return;
      if (p.id) {
        setAnnotations((prev) => prev.map((a) => (a.id === p.id ? { ...a, color } : a)));
        setAnnoPopover({ ...p, color });
        api()
          .updateAnnotation({ id: p.id, color })
          .catch(() => {});
        return;
      }
      const totalChars = totalRef.current || 0;
      const progress = totalChars ? Math.min(1, Math.max(0, p.startChar / totalChars)) : 0;
      try {
        const rec = await api().addAnnotation({
          bookId: book.id,
          startChar: p.startChar,
          endChar: p.endChar,
          color,
          snippet: p.text.slice(0, 160) || undefined,
          progress,
        });
        if (rec) {
          setAnnotations((prev) => [...prev, rec].sort((a, b) => a.startChar - b.startChar || a.createdAt - b.createdAt));
          setAnnoPopover({ ...p, id: rec.id, color });
          // Drop the text selection so it doesn't sit highlighted under the wash.
          (hostRef.current?.shadowRoot as ShadowRoot & { getSelection?: () => Selection | null })?.getSelection?.()?.removeAllRanges?.();
        }
      } catch (err) {
        console.error("Failed to add highlight", err);
      }
    },
    [book, hostRef, totalRef],
  );

  const handleRemoveAnnotation = useCallback(async (id: string) => {
    if (annoPopoverRef.current?.id === id) setAnnoPopover(null);
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    try {
      await api().removeAnnotation(id);
    } catch (err) {
      console.error("Failed to remove highlight", err);
    }
  }, []);

  // Trigger → editor: promote the pending selection into the colour/note editor,
  // anchored to the selection box. No colour pre-selected, so picking one is what
  // creates the highlight.
  const openAnnoEditor = useCallback(() => {
    setAnnoTrigger((t) => {
      if (t) setAnnoPopover({ anchor: t.rect, id: null, color: "", note: "", startChar: t.startChar, endChar: t.endChar, text: t.text });
      return null;
    });
  }, []);

  /** The content root + section base char for the currently-rendered region. */
  const currentContentRoot = useCallback((): { root: Element | null; base: number } => {
    const shadow = hostRef.current?.shadowRoot;
    if (!shadow) return { root: null, base: 0 };
    if (modeRef.current === "paginated") {
      return { root: shadow.querySelector(".aoz-page-content"), base: controllerRef.current?.sectionStart ?? 0 };
    }
    return { root: shadow.querySelector(".aozora-content"), base: 0 };
  }, [hostRef, modeRef, controllerRef]);

  // Finishing a selection surfaces the highlight trigger at the mouse-release point
  // (not the full editor, which would cover what you read). Picking it opens the
  // editor; ignoring it leaves the selection. Fixed-layout has no selectable text.
  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (modeRef.current === "fixed") return;
      const shadow = hostRef.current?.shadowRoot as (ShadowRoot & { getSelection?: () => Selection | null }) | undefined;
      const sel = shadow?.getSelection?.() ?? window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const { root, base } = currentContentRoot();
      if (!root || !root.contains(range.commonAncestorContainer)) return;
      const span = rangeToCharSpan(root, range, base);
      if (!span) return;
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      clearLookup();
      clearFootnote();
      setAnnoPopover(null);
      setAnnoTrigger({ point: { x: e.clientX, y: e.clientY }, rect, startChar: span.startChar, endChar: span.endChar, text: span.text });
    },
    [currentContentRoot, clearLookup, clearFootnote, hostRef, modeRef],
  );

  // Called from the reader's content-click after link/footnote handling: a click
  // landing on an existing highlight (no active selection) opens its editor.
  const openHighlightAtPoint = useCallback(
    (e: React.MouseEvent) => {
      if (modeRef.current === "fixed") return;
      const shadow = hostRef.current?.shadowRoot as (ShadowRoot & { getSelection?: () => Selection | null }) | undefined;
      const sel = shadow?.getSelection?.() ?? window.getSelection();
      if (sel && !sel.isCollapsed) return; // fresh highlight — handleMouseUp owns it
      const { root, base } = currentContentRoot();
      if (!root) return;
      const caret = caretRangeFromPoint(e.clientX, e.clientY, root);
      if (!caret) return;
      const offset = charOffsetAt(root, caret.startContainer, caret.startOffset, base);
      const hit = annotationAtOffset(annotationsRef.current, offset);
      if (!hit) return;
      clearLookup();
      clearFootnote();
      setAnnoPopover({
        anchor: new DOMRect(e.clientX, e.clientY, 0, 0),
        id: hit.id,
        color: hit.color,
        note: hit.note ?? "",
        startChar: hit.startChar,
        endChar: hit.endChar,
        text: hit.snippet ?? "",
      });
    },
    [currentContentRoot, clearLookup, clearFootnote, hostRef, modeRef],
  );

  return {
    annotations,
    annoPopover,
    annoTrigger,
    repaintAnnotations,
    closeAnnoPopover,
    clearAnnoTrigger,
    setPopoverNote,
    handleAnnoColor,
    handleRemoveAnnotation,
    openAnnoEditor,
    handleMouseUp,
    openHighlightAtPoint,
  };
}
