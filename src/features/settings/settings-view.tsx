import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LibrarySidebar } from "@/features/library/library-sidebar";
import { useSettingsStore, THEMES } from "@/stores/settings-store";
import { useLibraryPrefs, CARD_SIZE_OPTIONS, type CardSize } from "@/stores/library-prefs-store";

/** A titled group of related settings, drawn as a bordered, divided list. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">{title}</h2>
      <div className="divide-y border">{children}</div>
    </section>
  );
}

/** One setting: label + optional description on the left, its control on the right. */
function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="space-y-0.5">
        <p className="text-xs font-medium">{label}</p>
        {description && <p className="text-[11px] text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * App-wide preferences (beside the shared sidebar), grouped into sections so the
 * page scales as more settings land. Each control reads/writes the same store
 * that owns the pref, so changes stay in sync with the rest of the app (e.g. the
 * theme toggle mirrors the title bar).
 */
export function SettingsView() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const isDark = (THEMES[theme] || THEMES.sepia).dark;

  const cardSize = useLibraryPrefs((s) => s.cardSize);
  const setCardSize = useLibraryPrefs((s) => s.setCardSize);
  const showCardMetadata = useLibraryPrefs((s) => s.showCardMetadata);
  const setShowCardMetadata = useLibraryPrefs((s) => s.setShowCardMetadata);

  return (
    <div className="flex h-full">
      <LibrarySidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <div className="mx-auto w-full max-w-3xl space-y-8 p-6">
          <header className="space-y-1">
            <h1 className="text-lg font-medium tracking-tight">Settings</h1>
            <p className="text-xs text-muted-foreground">Customize how Aozora looks and behaves.</p>
          </header>

          <Section title="Appearance">
            <SettingRow label="Dark mode" description="Switch between the light and dark theme. Synced with the title bar.">
              <Switch checked={isDark} onCheckedChange={(v) => setTheme(v ? "dark" : "sepia")} aria-label="Dark mode" />
            </SettingRow>
          </Section>

          <Section title="Library">
            <SettingRow label="Cover size" description="How large the book covers appear in the library grid.">
              <Select value={cardSize} onValueChange={(v) => setCardSize(v as CardSize)}>
                <SelectTrigger size="sm" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CARD_SIZE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow label="Show book details" description="Display the title, author, and reading progress beneath each cover.">
              <Switch checked={showCardMetadata} onCheckedChange={setShowCardMetadata} aria-label="Show book details" />
            </SettingRow>
          </Section>
        </div>
      </div>
    </div>
  );
}
