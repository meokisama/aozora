import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSettingsStore, FONT_SIZE_RANGE, LINE_HEIGHT_RANGE } from "@/stores/settings-store";

/** A labelled row wrapping one control. */
function Field({ label, value, children }) {
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
};

/**
 * Reader display settings drawer: theme, font, writing mode, font size and
 * line height. Changes apply live (the reader subscribes to the store) and
 * persist across sessions.
 */
export function ReaderSettingsPanel({ open, onOpenChange }) {
  const fontSize = useSettingsStore((s) => s.fontSize);
  const lineHeight = useSettingsStore((s) => s.lineHeight);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const theme = useSettingsStore((s) => s.theme);
  const readingMode = useSettingsStore((s) => s.readingMode);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const setLineHeight = useSettingsStore((s) => s.setLineHeight);
  const setFontFamily = useSettingsStore((s) => s.setFontFamily);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setReadingMode = useSettingsStore((s) => s.setReadingMode);
  const reset = useSettingsStore((s) => s.reset);

  // ToggleGroup (single) allows clicking the active item to clear it; keep a
  // value selected by ignoring empty updates.
  const guard = (setter) => (next) => next && setter(next);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-80 gap-0 p-0 sm:max-w-80">
        <SheetHeader className="border-b">
          <SheetTitle>Reader Settings</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <Field label="Reading Mode">
            <ToggleGroup {...segmented} value={readingMode} onValueChange={guard(setReadingMode)}>
              <ToggleGroupItem value="continuous" className="flex-1">
                Continuous
              </ToggleGroupItem>
              <ToggleGroupItem value="paginated" className="flex-1">
                Paginated
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>

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

          <Field label="Font">
            <ToggleGroup {...segmented} value={fontFamily} onValueChange={guard(setFontFamily)}>
              <ToggleGroupItem value="serif" className="flex-1">
                Serif
              </ToggleGroupItem>
              <ToggleGroupItem value="sans" className="flex-1">
                Sans
              </ToggleGroupItem>
            </ToggleGroup>
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
        </div>

        <div className="border-t p-4">
          <Button variant="outline" size="sm" className="w-full" onClick={reset}>
            <RotateCcw className="size-3.5" />
            Reset to defaults
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
