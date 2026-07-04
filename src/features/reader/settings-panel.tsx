import { useRef } from "react";
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
  WRITING_MODES,
  PAGE_COLUMNS_OPTIONS,
  SIDE_MARGIN_RANGE,
  type FontFamily,
  type ReadingMode,
  type FuriganaMode,
  type WritingMode,
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

const segmented = {
  type: "single",
  variant: "outline",
  size: "sm",
  spacing: 0,
  className: "w-full",
} as const;

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
  const fontSize = useSettingsStore((s) => s.fontSize);
  const lineHeight = useSettingsStore((s) => s.lineHeight);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const theme = useSettingsStore((s) => s.theme);
  const readingMode = useSettingsStore((s) => s.readingMode);
  const writingMode = useSettingsStore((s) => s.writingMode);
  const furiganaMode = useSettingsStore((s) => s.furiganaMode);
  const mangaSpread = useSettingsStore((s) => s.mangaSpread);
  const pageColumns = useSettingsStore((s) => s.pageColumns);
  const sideMargin = useSettingsStore((s) => s.sideMargin);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const setLineHeight = useSettingsStore((s) => s.setLineHeight);
  const setFontFamily = useSettingsStore((s) => s.setFontFamily);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setReadingMode = useSettingsStore((s) => s.setReadingMode);
  const setFuriganaMode = useSettingsStore((s) => s.setFuriganaMode);
  const setMangaSpread = useSettingsStore((s) => s.setMangaSpread);
  const setWritingMode = useSettingsStore((s) => s.setWritingMode);
  const setPageColumns = useSettingsStore((s) => s.setPageColumns);
  const setSideMargin = useSettingsStore((s) => s.setSideMargin);
  const reset = useSettingsStore((s) => s.reset);

  // ToggleGroup lets you click the active item to clear it; ignore empty updates
  // so a value stays selected.
  const guard =
    <T extends string>(setter: (next: T) => void) =>
    (next: T) =>
      next && setter(next);

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

          {/* Fixed-layout (manga) books only expose the page-spread layout;
              font/furigana/flow settings don't apply to image pages. */}
          {fixedLayout ? (
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
            <ReflowableFields
              {...{
                vertical,
                readingMode,
                setReadingMode,
                writingMode,
                setWritingMode,
                pageColumns,
                setPageColumns,
                sideMargin,
                setSideMargin,
                fontFamily,
                setFontFamily,
                furiganaMode,
                setFuriganaMode,
                fontSize,
                setFontSize,
                lineHeight,
                setLineHeight,
                guard,
              }}
            />
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

interface ReflowableFieldsProps {
  vertical: boolean;
  readingMode: ReadingMode;
  setReadingMode: (mode: ReadingMode) => void;
  writingMode: WritingMode;
  setWritingMode: (mode: WritingMode) => void;
  pageColumns: number;
  setPageColumns: (columns: number) => void;
  sideMargin: number;
  setSideMargin: (margin: number) => void;
  fontFamily: FontFamily;
  setFontFamily: (family: FontFamily) => void;
  furiganaMode: FuriganaMode;
  setFuriganaMode: (mode: FuriganaMode) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
  lineHeight: number;
  setLineHeight: (height: number) => void;
  guard: <T extends string>(setter: (next: T) => void) => (next: T) => void;
}

/** The settings only meaningful for reflowable (text) books. */
function ReflowableFields({
  vertical,
  readingMode,
  setReadingMode,
  writingMode,
  setWritingMode,
  pageColumns,
  setPageColumns,
  sideMargin,
  setSideMargin,
  fontFamily,
  setFontFamily,
  furiganaMode,
  setFuriganaMode,
  fontSize,
  setFontSize,
  lineHeight,
  setLineHeight,
  guard,
}: ReflowableFieldsProps) {
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
        <Field label="Side Margin" value={`${sideMargin}%`}>
          <Slider
            value={[sideMargin]}
            min={SIDE_MARGIN_RANGE.min}
            max={SIDE_MARGIN_RANGE.max}
            step={SIDE_MARGIN_RANGE.step}
            onValueChange={([v]) => setSideMargin(v)}
          />
        </Field>
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

      <Field label="Font Size" value={`${fontSize}px`}>
        <Slider
          value={[fontSize]}
          min={FONT_SIZE_RANGE.min}
          max={FONT_SIZE_RANGE.max}
          step={FONT_SIZE_RANGE.step}
          onValueChange={([v]) => setFontSize(v)}
        />
      </Field>

      <Field label="Line Height" value={lineHeight.toFixed(1)}>
        <Slider
          value={[lineHeight]}
          min={LINE_HEIGHT_RANGE.min}
          max={LINE_HEIGHT_RANGE.max}
          step={LINE_HEIGHT_RANGE.step}
          onValueChange={([v]) => setLineHeight(Math.round(v * 10) / 10)}
        />
      </Field>
    </>
  );
}
