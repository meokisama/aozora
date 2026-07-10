import { getKanaMorae, isMoraPitchHigh, getKanaDiacriticInfo } from "@/lib/dictionary/pitch";

/**
 * OJAD-style pitch-accent graph: morae as high/low dots joined by a line, plus
 * an open circle for the following particle (shows whether pitch drops after the
 * word). Self-contained inline SVG using currentColor so it renders outside the
 * reader's shadow root. High/low pattern from lib/dictionary/pitch.ts.
 *
 * Devoiced (無声化) morae get a dotted red ring; nasalised (鼻濁音) morae have
 * their dakuten stripped (が→か) and get a small red dot — matching how Yomitan's
 * pronunciation view annotates them.
 */

const MARGIN = 11; // px from the edge to the first/last dot
const STEP = 22; // px between morae
const HIGH_Y = 8;
const LOW_Y = 24;
const TEXT_Y = 47;
const GLYPH_CY = 42; // visual centre of a mora glyph (baseline TEXT_Y minus ~half cap height)
const DOT_R = 4;
const HEIGHT = 54;
const ANNOT_COLOR = "#ef4444"; // red-500: distinct from the currentColor graph, legible on light/dark

export function PitchAccent({
  reading,
  position,
  nasal = [],
  devoice = [],
}: {
  reading: string;
  position: number | string;
  /** 1-based mora indices that are nasalised (鼻濁音). */
  nasal?: number[];
  /** 1-based mora indices that are devoiced (無声化). */
  devoice?: number[];
}) {
  const morae = getKanaMorae(reading);
  const ii = morae.length;
  if (ii === 0) return null;

  const nasalSet = new Set(nasal);
  const devoiceSet = new Set(devoice);

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
      {morae.map((m, i) => {
        // nasal/devoice positions are 1-based (Yomitan convention).
        const isNasal = nasalSet.has(i + 1);
        const isDevoiced = devoiceSet.has(i + 1);
        const base = getKanaDiacriticInfo(m[0]);
        const glyph = isNasal && base ? base.character + m.slice(1) : m;
        return (
          <g key={i}>
            {isDevoiced && (
              <circle cx={cx(i)} cy={GLYPH_CY} r={9.5} fill="none" stroke={ANNOT_COLOR} strokeWidth={1} strokeDasharray="1.5 1.5" />
            )}
            <text x={cx(i)} y={TEXT_Y} textAnchor="middle" fontSize={15} fill="currentColor">
              {glyph}
            </text>
            {isNasal && <circle cx={cx(i) + 7} cy={34} r={2.4} fill={ANNOT_COLOR} />}
          </g>
        );
      })}
    </svg>
  );
}
