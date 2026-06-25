import { getKanaMorae, isMoraPitchHigh } from "@/lib/dictionary/pitch";

/**
 * OJAD-style pitch-accent graph: the reading's morae as dots (high/low) joined by
 * a line, with an open circle for the following particle so the listener can see
 * whether the pitch stays up or drops after the word. Self-contained inline SVG
 * (uses currentColor) so it renders correctly in the popup, outside the reader's
 * shadow root. Derives the morae and high/low pattern with the ported helpers in
 * lib/dictionary/pitch.ts (Yomitan's getKanaMorae / isMoraPitchHigh).
 */

const MARGIN = 11; // px from the edge to the first/last dot
const STEP = 22; // px between morae
const HIGH_Y = 8;
const LOW_Y = 24;
const TEXT_Y = 47;
const DOT_R = 4;
const HEIGHT = 54;

export function PitchAccent({ reading, position }: { reading: string; position: number | string }) {
  const morae = getKanaMorae(reading);
  const ii = morae.length;
  if (ii === 0) return null;

  const cx = (i: number) => MARGIN + i * STEP;
  const cy = (i: number) => (isMoraPitchHigh(i, position) ? HIGH_Y : LOW_Y);

  // One point per mora (0..ii-1) plus a trailing point for the following particle.
  const pts = Array.from({ length: ii + 1 }, (_, i) => ({ x: cx(i), y: cy(i) }));
  const linePath = "M" + pts.map((p) => `${p.x} ${p.y}`).join(" L");
  const width = MARGIN * 2 + ii * STEP;

  return (
    <svg
      width={width}
      height={HEIGHT}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      className="shrink-0 text-foreground"
      role="img"
      aria-label={`pitch accent for ${reading}`}
    >
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth={1.25} opacity={0.7} />
      {pts.map((p, i) =>
        i < ii ? (
          <circle key={i} cx={p.x} cy={p.y} r={DOT_R} fill="currentColor" />
        ) : (
          <circle key={i} cx={p.x} cy={p.y} r={DOT_R} fill="none" stroke="currentColor" strokeWidth={1.25} />
        ),
      )}
      {morae.map((m, i) => (
        <text key={i} x={cx(i)} y={TEXT_Y} textAnchor="middle" fontSize={15} fill="currentColor">
          {m}
        </text>
      ))}
    </svg>
  );
}
