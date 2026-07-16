import { useRef } from "react";
import { useAnchoredPosition } from "./hooks/use-anchored-position";
import { useDismiss } from "./hooks/use-dismiss";

interface Props {
  /** Note body inner HTML (object URLs already live), or null when closed. */
  html: string | null;
  /** Bounding box of the clicked noteref marker, in viewport coordinates. */
  anchor: DOMRect | null;
  onClose: () => void;
}

// Defaults for note content rendered outside the reader's shadow root, so the
// book's own CSS no longer applies (ruby/lists/images still render natively).
// Links are inert: a note's back-link must not yank the reader's position.
const NOTE_CLASS =
  "text-sm leading-relaxed [&_p]:my-1 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal " +
  "[&_li]:my-0.5 [&_img]:my-1 [&_img]:max-w-full [&_img]:h-auto [&_rt]:text-[0.6em] " +
  "[&_a]:underline [&_a]:pointer-events-none";

/**
 * Floating footnote popup, anchored below the clicked noteref (flipping above /
 * clamping to the viewport on overflow), mirroring the dictionary popup's
 * placement. Click-triggered and dismissible (Escape or a click outside);
 * renders null when closed so the reader can keep it mounted and feed it state.
 */
export function FootnotePopup({ html, anchor, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPosition(ref, anchor, html);

  useDismiss(!!html, ref, onClose);

  if (!html || !anchor) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Footnote"
      style={{
        position: "fixed",
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
      className="z-50 max-h-80 w-80 overflow-y-auto border bg-popover p-3 text-popover-foreground shadow-md"
    >
      <div className={NOTE_CLASS} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
