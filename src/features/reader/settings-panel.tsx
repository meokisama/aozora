import { useEffect, useRef, useState } from "react";
import { RotateCcw, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useSettingsStore,
  FONT_SIZE_RANGE,
  LINE_HEIGHT_RANGE,
  FONT_FAMILIES,
  FURIGANA_MODES,
  MANGA_SPREAD_MODES,
  MANGA_READING_MODES,
  MANGA_SCROLL_DIRECTIONS,
  WRITING_MODES,
  PAGE_COLUMNS_OPTIONS,
  SIDE_MARGIN_RANGE,
  MANGA_STRIP_WIDTH_RANGE,
  MANGA_STRIP_GAP_RANGE,
} from "@/stores/settings-store";
import { useFontsStore } from "@/stores/fonts-store";

interface FieldProps {
  label: string;
  value?: React.ReactNode;
  children: React.ReactNode;
}

/** A labelled row wrapping one control. */
function Field({ label, value, children }: FieldProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium">{label}</span>
        {value != null && <span className="text-xs tabular-nums text-muted-foreground">{value}</span>}
      </div>
      {children}
    </div>
  );
}

interface SmoothSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
  /** Formats the live value shown beside the label (defaults to the raw number). */
  format?: (value: number) => React.ReactNode;
}

/** A slider that drags smoothly against local state and commits to the store only
 *  when the drag ends — so live re-layout/re-flow fires once on release instead of
 *  on every pixel. The value readout tracks the drag live. */
function SmoothSlider({ label, value, min, max, step, onCommit, format }: SmoothSliderProps) {
  const [local, setLocal] = useState(value);

  // Follow external changes (e.g. reset to defaults); during a drag the store isn't
  // touched, so `value` is stable and this won't fight the local value.
  useEffect(() => setLocal(value), [value]);

  return (
    <Field label={label} value={format ? format(local) : local}>
      <Slider
        value={[local]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => setLocal(v)}
        onValueCommit={([v]) => onCommit(v)}
      />
    </Field>
  );
}

const segmented = {
  type: "single",
  variant: "outline",
  size: "sm",
  spacing: 0,
  className: "w-full",
} as const;

// ToggleGroup lets you click the active item to clear it; ignore empty updates
// so a value stays selected.
const guard =
  <T extends string>(setter: (next: T) => void) =>
  (next: T) =>
    next && setter(next);

/** Reader settings drawer. Changes apply live (the reader subscribes to the
 *  store) and persist across sessions. */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fixedLayout?: boolean;
  /** Effective writing direction; gates the horizontal-only layout controls and
   *  drives which Text Direction chip is highlighted while the setting is auto. */
  vertical?: boolean;
}

export function ReaderSettingsPanel({ open, onOpenChange, fixedLayout = false, vertical = true }: Props) {
  // The parent owns only the settings shown for every book (theme, manga spread,
  // reset); the reflowable-only fields live in ReflowableFields, which reads them
  // from the store itself so they aren't threaded through as props.
  const theme = useSettingsStore((s) => s.theme);
  const mangaSpread = useSettingsStore((s) => s.mangaSpread);
  const mangaReadingMode = useSettingsStore((s) => s.mangaReadingMode);
  const mangaScrollDirection = useSettingsStore((s) => s.mangaScrollDirection);
  const mangaStripWidth = useSettingsStore((s) => s.mangaStripWidth);
  const mangaStripGap = useSettingsStore((s) => s.mangaStripGap);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setMangaSpread = useSettingsStore((s) => s.setMangaSpread);
  const setMangaReadingMode = useSettingsStore((s) => s.setMangaReadingMode);
  const setMangaScrollDirection = useSettingsStore((s) => s.setMangaScrollDirection);
  const setMangaStripWidth = useSettingsStore((s) => s.setMangaStripWidth);
  const setMangaStripGap = useSettingsStore((s) => s.setMangaStripGap);
  const reset = useSettingsStore((s) => s.reset);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-80 gap-0 p-0 sm:max-w-80">
        <SheetHeader className="border-b">
          <SheetTitle>Reader Settings</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <Field label="Theme">
            <ToggleGroup {...segmented} value={theme} onValueChange={guard(setTheme)}>
              <ToggleGroupItem value="sepia" className="flex-1">
                Sepia
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" className="flex-1">
                Dark
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>

          {/* Fixed-layout (manga) books only expose reading mode + page spread;
              font/furigana/flow settings don't apply to image pages. */}
          {fixedLayout ? (
            <>
              <Field label="Reading Mode">
                <ToggleGroup {...segmented} value={mangaReadingMode} onValueChange={guard(setMangaReadingMode)}>
                  {MANGA_READING_MODES.map((m) => (
                    <ToggleGroupItem key={m.value} value={m.value} className="flex-1">
                      {m.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>

              {/* Paginated flips spreads; continuous scrolls a single strip whose
                  axis and page size are adjustable. */}
              {mangaReadingMode === "paginated" ? (
                <Field label="Page Layout">
                  <ToggleGroup {...segmented} value={mangaSpread} onValueChange={guard(setMangaSpread)}>
                    {MANGA_SPREAD_MODES.map((m) => (
                      <ToggleGroupItem key={m.value} value={m.value} className="flex-1">
                        {m.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
              ) : (
                <>
                  <Field label="Scroll Direction">
                    <ToggleGroup {...segmented} value={mangaScrollDirection} onValueChange={guard(setMangaScrollDirection)}>
                      {MANGA_SCROLL_DIRECTIONS.map((m) => (
                        <ToggleGroupItem key={m.value} value={m.value} className="flex-1">
                          {m.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </Field>

                  <SmoothSlider
                    label={mangaScrollDirection === "horizontal" ? "Page Height" : "Page Width"}
                    value={mangaStripWidth}
                    min={MANGA_STRIP_WIDTH_RANGE.min}
                    max={MANGA_STRIP_WIDTH_RANGE.max}
                    step={MANGA_STRIP_WIDTH_RANGE.step}
                    format={(v) => `${v}%`}
                    onCommit={setMangaStripWidth}
                  />

                  <SmoothSlider
                    label="Page Gap"
                    value={mangaStripGap}
                    min={MANGA_STRIP_GAP_RANGE.min}
                    max={MANGA_STRIP_GAP_RANGE.max}
                    step={MANGA_STRIP_GAP_RANGE.step}
                    format={(v) => `${v}px`}
                    onCommit={setMangaStripGap}
                  />
                </>
              )}
            </>
          ) : (
            <ReflowableFields vertical={vertical} />
          )}
        </div>

        <div className="p-4">
          <Button variant="outline" className="w-full" onClick={reset}>
            <RotateCcw className="size-3.5" />
            Reset to defaults
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The settings only meaningful for reflowable (text) books. Reads its own store
 *  slice; `vertical` (the effective direction) gates the horizontal-only rows. */
function ReflowableFields({ vertical }: { vertical: boolean }) {
  const fontSize = useSettingsStore((s) => s.fontSize);
  const lineHeight = useSettingsStore((s) => s.lineHeight);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const readingMode = useSettingsStore((s) => s.readingMode);
  const writingMode = useSettingsStore((s) => s.writingMode);
  const furiganaMode = useSettingsStore((s) => s.furiganaMode);
  const pageColumns = useSettingsStore((s) => s.pageColumns);
  const sideMargin = useSettingsStore((s) => s.sideMargin);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const setLineHeight = useSettingsStore((s) => s.setLineHeight);
  const setFontFamily = useSettingsStore((s) => s.setFontFamily);
  const setReadingMode = useSettingsStore((s) => s.setReadingMode);
  const setFuriganaMode = useSettingsStore((s) => s.setFuriganaMode);
  const setWritingMode = useSettingsStore((s) => s.setWritingMode);
  const setPageColumns = useSettingsStore((s) => s.setPageColumns);
  const setSideMargin = useSettingsStore((s) => s.setSideMargin);

  const customFonts = useFontsStore((s) => s.customFonts);
  const importFont = useFontsStore((s) => s.importFromFile);
  const removeFont = useFontsStore((s) => s.remove);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickFont = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;
    try {
      await importFont(file);
    } catch {
      toast.error("Couldn't load that font. Use a .ttf, .otf, .woff or .woff2 file.");
    }
  };

  return (
    <>
      <Field label="Writing Mode">
        <ToggleGroup {...segmented} value={writingMode} onValueChange={guard(setWritingMode)}>
          {WRITING_MODES.map((m) => (
            <ToggleGroupItem key={m.value} value={m.value} className="flex-1">
              {m.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <Field label="Reading Mode">
        <ToggleGroup {...segmented} value={readingMode} onValueChange={guard(setReadingMode)}>
          <ToggleGroupItem value="paginated" className="flex-1">
            Paginated
          </ToggleGroupItem>
          <ToggleGroupItem value="continuous" className="flex-1">
            Continuous
          </ToggleGroupItem>
        </ToggleGroup>
      </Field>

      {!vertical && readingMode === "paginated" && (
        <Field label="Columns per Page">
          <ToggleGroup {...segmented} value={String(pageColumns)} onValueChange={(v: string) => v && setPageColumns(Number(v))}>
            {PAGE_COLUMNS_OPTIONS.map((o) => (
              <ToggleGroupItem key={o.value} value={String(o.value)} className="flex-1">
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
      )}

      {!vertical && readingMode === "continuous" && (
        <SmoothSlider
          label="Side Margin"
          value={sideMargin}
          min={SIDE_MARGIN_RANGE.min}
          max={SIDE_MARGIN_RANGE.max}
          step={SIDE_MARGIN_RANGE.step}
          format={(v) => `${v}%`}
          onCommit={setSideMargin}
        />
      )}

      <Field label="Furigana">
        <Select value={furiganaMode} onValueChange={guard(setFuriganaMode)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FURIGANA_MODES.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Font">
        <div className="flex items-center gap-2">
          <Select value={fontFamily} onValueChange={guard(setFontFamily)}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_FAMILIES.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
              {customFonts.length > 0 && (
                <SelectGroup>
                  {customFonts.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
          <input ref={fileRef} type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={onPickFont} />
          <Button variant="outline" size="icon" className="shrink-0" onClick={() => fileRef.current?.click()} aria-label="Import font">
            <Upload className="size-3.5" />
          </Button>
        </div>

        {customFonts.length > 0 && (
          <div className="mt-2 divide-y border">
            {customFonts.map((f) => (
              <div key={f.id} className="flex items-center gap-2 py-1.5 pr-1.5 pl-2.5">
                <span className="min-w-0 flex-1 truncate text-xs leading-tight" title={f.label}>
                  {f.label}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeFont(f.id)}
                  aria-label={`Remove ${f.label}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Field>

      <SmoothSlider
        label="Font Size"
        value={fontSize}
        min={FONT_SIZE_RANGE.min}
        max={FONT_SIZE_RANGE.max}
        step={FONT_SIZE_RANGE.step}
        format={(v) => `${v}px`}
        onCommit={setFontSize}
      />

      <SmoothSlider
        label="Line Height"
        value={lineHeight}
        min={LINE_HEIGHT_RANGE.min}
        max={LINE_HEIGHT_RANGE.max}
        step={LINE_HEIGHT_RANGE.step}
        format={(v) => v.toFixed(2)}
        onCommit={(v) => setLineHeight(Math.round(v * 20) / 20)}
      />
    </>
  );
}
