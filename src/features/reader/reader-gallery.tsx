import React, { useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ChevronLeft, ChevronRight, X, BookOpen, Download, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Illustration } from "@/lib/reader/illustrations";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  illustrations: Illustration[];
  total: number;
  /** Jumps the reader to the illustration's character offset. */
  onSelect: (charOffset: number) => void;
}

const MAX_ZOOM = 4;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/**
 * Full-screen illustration viewer: a large centred image with prev/next navigation,
 * a thumbnail filmstrip, wheel-to-zoom + drag-to-pan, download, and keyboard
 * controls. "Read from here" jumps the reader to where the image sits in the text.
 */
export function ReaderGallery({ open, onOpenChange, illustrations, total, onSelect }: Props) {
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; bx: number; by: number } | null>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const last = illustrations.length - 1;
  const current = illustrations[index];

  // Reset to the first image each time the viewer opens.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Reset zoom/pan whenever the shown image changes.
  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [index]);

  // Arrow-key navigation while open (Escape is handled by the dialog itself).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, last));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, last]);

  // Keep the active thumbnail in view as the selection moves.
  useEffect(() => {
    thumbRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [index]);

  if (!current) return null;
  const pct = total ? Math.round((current.charOffset / total) * 100) : 0;
  const zoomed = scale > 1;

  const zoomBy = (factor: number) => {
    const next = clamp(scale * factor, 1, MAX_ZOOM);
    setScale(next);
    if (next === 1) setOffset({ x: 0, y: 0 });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const stage = stageRef.current;
    // Clamp the pan so the scaled image can't be dragged entirely out of view.
    const maxX = stage ? (stage.clientWidth * (scale - 1)) / 2 : Infinity;
    const maxY = stage ? (stage.clientHeight * (scale - 1)) / 2 : Infinity;
    setOffset({
      x: clamp(d.bx + (e.clientX - d.sx), -maxX, maxX),
      y: clamp(d.by + (e.clientY - d.sy), -maxY, maxY),
    });
  };

  const download = () => {
    const a = document.createElement("a");
    a.href = current.url;
    a.download = current.key.split("/").pop() || "illustration";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/95 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col text-white outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          // The custom title bar's drag region (top strip) would otherwise eat
          // clicks on the toolbar; no-drag cuts the whole viewer out of it.
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">Illustrations</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Browse every illustration in the book and jump to where each one appears.
          </DialogPrimitive.Description>

          {/* Top bar: counter + actions. z-20 keeps it above the stage's nav arrows. */}
          <div className="relative z-20 flex shrink-0 items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-xs tabular-nums text-white/70">
              {index + 1} <span className="text-white/40">/ {illustrations.length}</span>
              <span className="ml-2 text-white/40">{pct}%</span>
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => (zoomed ? zoomBy(0) : zoomBy(2))}
                aria-label={zoomed ? "Reset zoom" : "Zoom in"}
                className="text-white/70 hover:bg-white/10 hover:text-white"
              >
                {zoomed ? <ZoomOut className="size-4" /> : <ZoomIn className="size-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={download}
                aria-label="Download image"
                className="text-white/70 hover:bg-white/10 hover:text-white"
              >
                <Download className="size-4" />
              </Button>
              <Button variant="ghost" onClick={() => onSelect(current.charOffset)} className="text-white/80 hover:bg-white/10 hover:text-white">
                <BookOpen className="size-3.5" />
                Read from here
              </Button>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close" className="text-white/70 hover:bg-white/10 hover:text-white">
                  <X className="size-4" />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Stage: current image, flanked by prev/next. Wheel zooms; drag pans. */}
          <div
            ref={stageRef}
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-14"
            onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2)}
            onMouseMove={onMouseMove}
            onMouseDown={(e) => {
              if (!zoomed) return;
              dragRef.current = { sx: e.clientX, sy: e.clientY, bx: offset.x, by: offset.y };
            }}
            onMouseUp={() => (dragRef.current = null)}
            onMouseLeave={() => (dragRef.current = null)}
          >
            {index > 0 && (
              <Button
                variant="ghost"
                onClick={() => setIndex(index - 1)}
                aria-label="Previous illustration"
                className="absolute top-1/2 left-2 z-10 size-11 -translate-y-1/2 bg-white/5 text-white/80 hover:bg-white/15 hover:text-white"
              >
                <ChevronLeft className="size-6" />
              </Button>
            )}

            <img
              src={current.url}
              alt={current.alt}
              draggable={false}
              style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
              className={cn(
                "max-h-full max-w-full object-contain select-none",
                zoomed ? "cursor-grab active:cursor-grabbing" : "transition-transform duration-200",
              )}
            />

            {index < last && (
              <Button
                variant="ghost"
                onClick={() => setIndex(index + 1)}
                aria-label="Next illustration"
                className="absolute top-1/2 right-2 z-10 size-11 -translate-y-1/2 bg-white/5 text-white/80 hover:bg-white/15 hover:text-white"
              >
                <ChevronRight className="size-6" />
              </Button>
            )}
          </div>

          {/* Filmstrip: uniform height, natural width so portrait + landscape both show fully. */}
          <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-4 py-3">
            {illustrations.map((ill, i) => (
              <button
                key={`${ill.key}-${i}`}
                ref={(el) => {
                  thumbRefs.current[i] = el;
                }}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Illustration ${i + 1}`}
                aria-current={i === index}
                className={cn(
                  "h-16 shrink-0 overflow-hidden border transition-opacity",
                  i === index ? "border-white opacity-100" : "border-transparent opacity-50 hover:opacity-80",
                )}
              >
                <img src={ill.url} alt={ill.alt} loading="lazy" draggable={false} className="h-full w-auto object-contain" />
              </button>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
