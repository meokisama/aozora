import { useRef } from "react";
import { Highlighter } from "lucide-react";
import { useDismiss } from "./hooks/use-dismiss";

interface Props {
  /** Viewport point (the mouse-release position) the button anchors to; null closed. */
  point: { x: number; y: number } | null;
  /** Promote to the full colour/note editor. */
  onPick: () => void;
  /** Dismiss without highlighting (click-away / Escape). */
  onClose: () => void;
}

const SIZE = 30; // button box (px)
const GAP = 8; // offset from the cursor
const MARGIN = 8; // min gap from the viewport edge

/**
 * The unobtrusive first step of highlighting: a button that surfaces at the end of
 * a fresh selection. Clicking it opens the colour/note editor; ignoring it (reading
 * on, clicking away, Escape) leaves the text untouched — so highlighting stays
 * always-on without a full popup covering what you read.
 */
export function AnnotationTrigger({ point, onPick, onClose }: Props) {
  const ref = useRef<HTMLButtonElement>(null);

  useDismiss(!!point, ref, onClose);

  if (!point) return null;

  const left = Math.min(point.x + GAP, window.innerWidth - SIZE - MARGIN);
  const top = Math.min(point.y + GAP, window.innerHeight - SIZE - MARGIN);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onPick}
      aria-label="Highlight selection"
      title="Highlight"
      style={{ position: "fixed", left, top, width: SIZE, height: SIZE }}
      className="z-50 cursor-pointer inline-flex items-center justify-center rounded-full border bg-popover text-popover-foreground shadow-md transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <Highlighter className="size-4" />
    </button>
  );
}
