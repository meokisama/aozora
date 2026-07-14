/**
 * Prevents the browser's swipe-back gesture when the touch starts inside `el`.
 */
export function preventReaderBackGesture(el: Element) {
  const handler = (e: TouchEvent) => {
    if (el && e.composedPath().includes(el)) e.preventDefault();
  };
  window.addEventListener("touchstart", handler, { passive: false });
  return () => window.removeEventListener("touchstart", handler);
}

/**
 * Sets up click-to-flip-by-thirds and touch-swipe gestures on `el`.
 * `direction` ("ltr"|"rtl") determines which side means "next".
 * `onFlip(1)` advances, `onFlip(-1)` retreats.
 */
export function setupPaginatedGestures(el: Element, direction: string, onFlip: (dir: number) => void) {
  (el as HTMLElement).style.touchAction = "manipulation";

  const zoneFlip = () => (direction === "rtl" ? 1 : -1);

  const onClick = (e: MouseEvent) => {
    if ((e.target as Element)?.closest("a")) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const third = rect.width / 3;
    const zf = zoneFlip();
    if (x < third) onFlip(zf);
    else if (x > rect.width - third) onFlip(-zf);
  };

  let touchStartX = 0;
  let touchStartY = 0;
  let touchActive = false;

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchActive = true;
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (!touchActive) return;
    touchActive = false;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const zf = zoneFlip();
    if (absDx < 10 && absDy < 10) {
      if ((e.target as Element)?.closest("a")) return;
      const rect = el.getBoundingClientRect();
      const x = e.changedTouches[0].clientX - rect.left;
      const third = rect.width / 3;
      if (x < third) onFlip(zf);
      else if (x > rect.width - third) onFlip(-zf);
    } else if (absDx > absDy && absDx > 30) {
      if (dx > 0) onFlip(zf);
      else onFlip(-zf);
    }
  };

  const cleanupBack = preventReaderBackGesture(el);

  const htmlEl = el as HTMLElement;
  htmlEl.addEventListener("click", onClick as EventListener);
  htmlEl.addEventListener("touchstart", onTouchStart as EventListener, { passive: true });
  htmlEl.addEventListener("touchend", onTouchEnd as EventListener, { passive: true });

  return () => {
    htmlEl.removeEventListener("click", onClick as EventListener);
    htmlEl.removeEventListener("touchstart", onTouchStart as EventListener);
    htmlEl.removeEventListener("touchend", onTouchEnd as EventListener);
    cleanupBack();
  };
}
