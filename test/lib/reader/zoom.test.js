import { describe, it, expect } from "vitest";
import { clampScale, clampPan, zoomAtPoint, IDENTITY, MIN_SCALE, MAX_SCALE } from "@/lib/reader/zoom";

describe("clampScale", () => {
  it("clamps to [MIN_SCALE, MAX_SCALE]", () => {
    expect(clampScale(0.2)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(2)).toBe(2);
  });
});

describe("clampPan", () => {
  it("pins pan to 0 at scale 1", () => {
    expect(clampPan({ scale: 1, tx: 50, ty: -30 }, 800, 600)).toEqual({ scale: 1, tx: 0, ty: 0 });
  });

  it("allows pan up to half the overflow on each axis", () => {
    // scale 2 over an 800×600 box → overflow 800/600, half = 400/300.
    expect(clampPan({ scale: 2, tx: 999, ty: -999 }, 800, 600)).toEqual({ scale: 2, tx: 400, ty: -300 });
    expect(clampPan({ scale: 2, tx: 100, ty: -50 }, 800, 600)).toEqual({ scale: 2, tx: 100, ty: -50 });
  });
});

describe("zoomAtPoint", () => {
  it("keeps the centre fixed when zooming at the centre", () => {
    const next = zoomAtPoint(IDENTITY, 2, 0, 0, 800, 600);
    expect(next).toEqual({ scale: 2, tx: 0, ty: 0 });
  });

  it("shifts pan so the cursor point stays put when zooming off-centre", () => {
    // At scale 1→2 anchored at px=100: tx = 100·(1 - 2) + 0·2 = -100 (clamped to ±400).
    const next = zoomAtPoint(IDENTITY, 2, 100, 0, 800, 600);
    expect(next.scale).toBe(2);
    expect(next.tx).toBe(-100);
    expect(next.ty).toBe(0);
  });

  it("clamps the resulting scale and pan", () => {
    // Requesting 99× clamps scale to MAX_SCALE and pan into range.
    const next = zoomAtPoint(IDENTITY, 99, 400, 300, 800, 600);
    expect(next.scale).toBe(MAX_SCALE);
    expect(Math.abs(next.tx)).toBeLessThanOrEqual(((MAX_SCALE - 1) * 800) / 2);
    expect(Math.abs(next.ty)).toBeLessThanOrEqual(((MAX_SCALE - 1) * 600) / 2);
  });

  it("round-trips back to identity when zooming out to 1 at the centre", () => {
    const zoomed = zoomAtPoint(IDENTITY, 2, 50, 20, 800, 600);
    const back = zoomAtPoint(zoomed, 1, 0, 0, 800, 600);
    expect(back).toEqual({ scale: 1, tx: 0, ty: 0 });
  });
});
