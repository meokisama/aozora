import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAnkiStore } from "@/stores/anki-store";
import { FIELD_MARKERS } from "@/lib/dictionary/anki-note";
import type { AnkiDuplicateBehavior } from "@/lib/types";

// Human labels for the field markers offered per Anki field.
const MARKER_LABELS: Record<string, string> = {
  expression: "Word",
  reading: "Reading",
  furigana: "Furigana (ruby)",
  "furigana-plain": "Furigana (plain)",
  glossary: "Definition (HTML)",
  "glossary-plain": "Definition (text)",
  sentence: "Sentence",
  "pitch-accents": "Pitch accent",
  frequencies: "Frequency",
  "document-title": "Book title",
  "document-author": "Book author",
  screenshot: "Screenshot",
};

/** Guesses a sensible marker for an Anki field from its name (à la Yomitan). */
function guessMarker(fieldName: string, isFirst: boolean): string {
  const n = fieldName.toLowerCase();
  if (/sentence|example|context/.test(n)) return "sentence";
  if (/reading|kana|yomi|pronunciation/.test(n)) return "reading";
  if (/furigana/.test(n)) return "furigana";
  if (/pitch|accent/.test(n)) return "pitch-accents";
  if (/freq/.test(n)) return "frequencies";
  if (/image|picture|screenshot/.test(n)) return "screenshot";
  if (/meaning|definition|gloss|back|english|translation/.test(n)) return "glossary";
  if (/word|expression|term|vocab|kanji|front|target/.test(n)) return "expression";
  return isFirst ? "expression" : "";
}

/** A titled group matching the settings page's section styling. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">{title}</p>
      {children}
    </div>
  );
}

/**
 * Anki mining configuration: connection, target deck/note-type, and the mapping
 * from Anki fields to Aozora's card markers. The main process is a stateless
 * AnkiConnect client, so we fetch deck/model/field lists on demand.
 */
export function AnkiSettings() {
  const enabled = useAnkiStore((s) => s.enabled);
  const server = useAnkiStore((s) => s.server);
  const apiKey = useAnkiStore((s) => s.apiKey);
  const deck = useAnkiStore((s) => s.deck);
  const model = useAnkiStore((s) => s.model);
  const fields = useAnkiStore((s) => s.fields);
  const tags = useAnkiStore((s) => s.tags);
  const duplicateBehavior = useAnkiStore((s) => s.duplicateBehavior);
  const screenshot = useAnkiStore((s) => s.screenshot);
  const screenshotQuality = useAnkiStore((s) => s.screenshotQuality);

  const setEnabled = useAnkiStore((s) => s.setEnabled);
  const setServer = useAnkiStore((s) => s.setServer);
  const setApiKey = useAnkiStore((s) => s.setApiKey);
  const setDeck = useAnkiStore((s) => s.setDeck);
  const setModel = useAnkiStore((s) => s.setModel);
  const setFields = useAnkiStore((s) => s.setFields);
  const setField = useAnkiStore((s) => s.setField);
  const setTags = useAnkiStore((s) => s.setTags);
  const setDuplicateBehavior = useAnkiStore((s) => s.setDuplicateBehavior);
  const setScreenshot = useAnkiStore((s) => s.setScreenshot);
  const setScreenshotQuality = useAnkiStore((s) => s.setScreenshotQuality);

  const [decks, setDecks] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [modelFields, setModelFields] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(false);

  const loadLists = useCallback(async () => {
    const endpoint = { server, apiKey };
    try {
      const [d, m] = await Promise.all([window.electronAPI.anki.decks(endpoint), window.electronAPI.anki.models(endpoint)]);
      setDecks(d);
      setModels(m);
      return true;
    } catch {
      setDecks([]);
      setModels([]);
      return false;
    }
  }, [server, apiKey]);

  const onTest = useCallback(async () => {
    setTesting(true);
    const res = await window.electronAPI.anki.test({ server, apiKey });
    setTesting(false);
    setConnected(res.ok);
    if (res.ok) {
      toast.success(`Connected to Anki (AnkiConnect v${res.version}).`);
      void loadLists();
    } else {
      toast.error(res.error);
    }
  }, [server, apiKey, loadLists]);

  // Auto-connect on open when already enabled, so the dropdowns are populated.
  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      const ok = await loadLists();
      setConnected(ok);
    })();
  }, [enabled, loadLists]);

  // Fetch the chosen model's fields; auto-map them the first time (empty map).
  useEffect(() => {
    if (!enabled || !model) {
      setModelFields([]);
      return;
    }
    let alive = true;
    void window.electronAPI.anki
      .fields({ server, apiKey }, model)
      .then((names) => {
        if (!alive) return;
        setModelFields(names);
        if (Object.keys(useAnkiStore.getState().fields).length === 0 && names.length) {
          const auto: Record<string, string> = {};
          names.forEach((name, i) => {
            const marker = guessMarker(name, i === 0);
            auto[name] = marker ? `{${marker}}` : "";
          });
          setFields(auto);
        }
      })
      .catch(() => {
        if (alive) setModelFields([]);
      });
    return () => {
      alive = false;
    };
  }, [enabled, model, server, apiKey, setFields]);

  // Show the stored value even if the live list hasn't loaded (or is empty).
  const deckOptions = deck && !decks.includes(deck) ? [deck, ...decks] : decks;
  const modelOptions = model && !models.includes(model) ? [model, ...models] : models;
  // Fall back to the saved mapping's fields when the live field list hasn't
  // arrived yet, so returning to this tab still shows the configured mapping.
  const fieldNames = modelFields.length ? modelFields : Object.keys(fields);

  // A field's mapping is edited as an ordered list of marker chips. The template
  // stored is the markers joined by <br>, so multiple markers stack on the card
  // (a single marker has no trailing separator).
  const [activeField, setActiveField] = useState<string | null>(null);

  const markersOf = (template: string | undefined): string[] =>
    template ? [...template.matchAll(/\{([\w-]+)\}/g)].map((m) => m[1]).filter((m) => FIELD_MARKERS.includes(m)) : [];

  const writeMarkers = (name: string, markers: string[]) => setField(name, markers.map((m) => `{${m}}`).join("<br>"));

  const addMarker = (marker: string) => {
    const name = activeField && fieldNames.includes(activeField) ? activeField : fieldNames[0];
    if (!name) return;
    writeMarkers(name, [...markersOf(fields[name]), marker]);
    setActiveField(name);
  };

  const removeMarkerAt = (name: string, index: number) => {
    const next = markersOf(fields[name]);
    next.splice(index, 1);
    writeMarkers(name, next);
  };

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-xs font-medium">Anki integration</p>
          <p className="text-[11px] text-muted-foreground">
            Mine words to Anki from the reader&apos;s dictionary popup via the AnkiConnect add-on. Keep Anki running.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable Anki integration" />
      </div>

      {enabled && (
        <>
          <Group title="Connection">
            <div className="flex items-center gap-2">
              <Input
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="http://127.0.0.1:8765"
                className="flex-1"
                aria-label="AnkiConnect server URL"
              />
              <Button size="sm" variant="outline" onClick={onTest} disabled={testing}>
                {testing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Test
              </Button>
            </div>
            <Input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API key (optional)"
              type="password"
              aria-label="AnkiConnect API key"
            />
          </Group>

          <Group title="Target">
            <div className="grid grid-cols-2 gap-2">
              <Select value={deck || undefined} onValueChange={setDeck}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Deck" />
                </SelectTrigger>
                <SelectContent>
                  {deckOptions.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={model || undefined} onValueChange={setModel}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Note type" />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!connected && decks.length === 0 && (
              <p className="text-[11px] text-muted-foreground">Test the connection to load your decks and note types.</p>
            )}
          </Group>

          {fieldNames.length > 0 && (
            <Group title="Field mapping">
              <div className="divide-y border">
                {fieldNames.map((name) => {
                  const markers = markersOf(fields[name]);
                  const active = activeField === name;
                  return (
                    <div
                      key={name}
                      onClick={() => setActiveField(name)}
                      className={cn("flex cursor-pointer items-start gap-2 px-3 py-2", active && "bg-accent/40")}
                    >
                      <span className="w-24 shrink-0 truncate pt-1 text-xs font-medium" title={name}>
                        {name}
                      </span>
                      <div className={cn("flex min-h-7 flex-1 flex-wrap items-center gap-1 rounded-sm px-1 py-0.5")}>
                        {markers.length === 0 && <span className="text-[11px] text-muted-foreground">empty</span>}
                        {markers.map((m, i) => (
                          <span key={i} className="inline-flex items-center gap-1 rounded-sm border bg-background px-1.5 py-0.5 text-[10px]">
                            {MARKER_LABELS[m] ?? m}
                            <button
                              type="button"
                              aria-label={`Remove ${MARKER_LABELS[m] ?? m}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                removeMarkerAt(name, i);
                              }}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <X className="size-3 cursor-pointer" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-[11px] text-muted-foreground">
                {activeField ? (
                  <>
                    Click a marker to add it to <span className="font-medium text-foreground">{activeField}</span>.
                  </>
                ) : (
                  "Select a field above, then click markers to add them."
                )}
              </p>
              <div className="flex flex-wrap gap-1">
                {FIELD_MARKERS.map((marker) => (
                  <button
                    key={marker}
                    type="button"
                    onClick={() => addMarker(marker)}
                    title={`{${marker}}`}
                    className="rounded-sm border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    {MARKER_LABELS[marker] ?? marker}
                  </button>
                ))}
              </div>
            </Group>
          )}

          <Group title="Options">
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs">Tags</span>
              <Input
                value={tags.join(", ")}
                onChange={(e) =>
                  setTags(
                    e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  )
                }
                placeholder="aozora"
                className="w-56"
                aria-label="Anki note tags"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <span className="text-xs">Duplicates</span>
              <Select value={duplicateBehavior} onValueChange={(v) => setDuplicateBehavior(v as AnkiDuplicateBehavior)}>
                <SelectTrigger size="sm" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prevent">Prevent duplicates</SelectItem>
                  <SelectItem value="allow">Allow duplicates</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-xs">Screenshot</p>
                <p className="text-[11px] text-muted-foreground">Attach an image of the sentence to the card.</p>
              </div>
              <Switch checked={screenshot} onCheckedChange={setScreenshot} aria-label="Attach screenshot" />
            </div>
            {screenshot && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs">Image quality</span>
                <div className="flex w-56 items-center gap-3">
                  <Slider value={[screenshotQuality]} min={30} max={100} step={5} onValueChange={([v]) => setScreenshotQuality(v)} />
                  <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{screenshotQuality}</span>
                </div>
              </div>
            )}
          </Group>
        </>
      )}
    </div>
  );
}
