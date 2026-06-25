import { useCallback, useEffect, useState } from "react";
import { BookA, ChevronDown, ChevronUp, Download, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { LibrarySidebar } from "@/features/library/library-sidebar";
import { useDictionaryStore, LOOKUP_MODIFIERS, type LookupModifier } from "@/stores/dictionary-store";
import type { DictionaryInfo } from "@/lib/types";

const api = () => window.electronAPI.dictionary;

/**
 * Dictionary management page. Renders beside the shared sidebar (like the
 * library / stats pages) and is the single home for everything dictionary-
 * related: the hover-lookup behaviour (enable + which modifier triggers it,
 * persisted in `useDictionaryStore`) and the imported Yomitan dictionaries
 * (import, enable per dictionary, reorder consult priority, remove). The
 * dictionaries and the lookup engine live in the main process; this view drives
 * them over IPC and mirrors the returned list locally.
 */
export function DictionariesView() {
  const enabled = useDictionaryStore((s) => s.enabled);
  const modifier = useDictionaryStore((s) => s.modifier);
  const setEnabled = useDictionaryStore((s) => s.setEnabled);
  const setModifier = useDictionaryStore((s) => s.setModifier);

  const [dicts, setDicts] = useState<DictionaryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(""); // import status line (large dictionaries take a while)

  const refresh = useCallback(async () => {
    try {
      setDicts(await api().list());
    } catch {
      /* leave the current list */
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Mirror import progress streamed from the main process into a status line.
  useEffect(() => {
    return api().onImportProgress((p) => {
      if (p.phase === "reading") setProgress("Reading…");
      else if (p.phase === "inserting") setProgress(`Importing ${p.title ?? ""}…`);
      else setProgress("");
    });
  }, []);

  const handleImport = useCallback(async () => {
    setImporting(true);
    try {
      const info = await api().pickAndImport();
      if (info) {
        toast.success(`Imported “${info.title}” (${info.termCount.toLocaleString()} terms)`);
        await refresh();
      }
    } catch (err) {
      toast.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  }, [refresh]);

  const toggleDict = useCallback(async (id: string, next: boolean) => {
    setDicts((prev) => prev.map((d) => (d.id === id ? { ...d, enabled: next } : d))); // optimistic
    try {
      await api().setEnabled(id, next);
    } catch {
      await refresh(); // revert to the source of truth on failure
    }
  }, [refresh]);

  const removeDict = useCallback(async (id: string) => {
    setDicts((prev) => prev.filter((d) => d.id !== id)); // optimistic
    try {
      await api().remove(id);
    } finally {
      await refresh();
    }
  }, [refresh]);

  // Move a dictionary up/down the consult order. Priorities are reassigned from
  // the new array order (0..n) so the list stays contiguous regardless of any
  // gaps left by removals.
  const move = useCallback(
    async (index: number, delta: -1 | 1) => {
      const target = index + delta;
      if (target < 0 || target >= dicts.length) return;
      const next = [...dicts];
      [next[index], next[target]] = [next[target], next[index]];
      setDicts(next.map((d, i) => ({ ...d, priority: i }))); // optimistic
      try {
        await Promise.all(next.map((d, i) => (d.priority === i ? null : api().setPriority(d.id, i))));
      } finally {
        await refresh();
      }
    },
    [dicts, refresh],
  );

  return (
    <div className="flex h-full">
      <LibrarySidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <div className="mx-auto w-full max-w-3xl space-y-8 p-6">
          <header className="space-y-1">
            <h1 className="text-lg font-medium tracking-tight">Dictionaries</h1>
            <p className="text-xs text-muted-foreground">
              Look up Japanese words by hovering text in the reader. Import Yomitan dictionaries (format 3) and choose how
              lookups are triggered.
            </p>
          </header>

          {/* Hover-lookup behaviour. */}
          <section className="space-y-4 border p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-xs font-medium">Hover lookup</p>
                <p className="text-[11px] text-muted-foreground">Show a definition popup for the word under the cursor.</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable hover lookup" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-xs font-medium">Trigger</p>
                <p className="text-[11px] text-muted-foreground">Hold this key while hovering to look a word up.</p>
              </div>
              <Select value={modifier} onValueChange={(v) => setModifier(v as LookupModifier)} disabled={!enabled}>
                <SelectTrigger size="sm" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOOKUP_MODIFIERS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          {/* Imported dictionaries. */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                Imported{dicts.length > 0 ? ` (${dicts.length})` : ""}
              </h2>
              <div className="flex items-center gap-2">
                {importing && progress && <span className="text-[11px] text-muted-foreground">{progress}</span>}
                <Button size="sm" variant="outline" onClick={handleImport} disabled={importing}>
                  {importing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                  Import dictionary
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : dicts.length === 0 ? (
              <div className="flex flex-col items-center gap-3 border-2 border-dashed border-border px-8 py-12 text-center">
                <BookA className="size-10 text-muted-foreground" strokeWidth={1.5} />
                <div className="space-y-1">
                  <p className="text-sm font-medium">No dictionaries yet</p>
                  <p className="text-xs text-muted-foreground">Import a Yomitan dictionary ZIP to start looking up words.</p>
                </div>
              </div>
            ) : (
              <ul className="divide-y border">
                {dicts.map((d, i) => (
                  <li key={d.id} className="flex items-center gap-3 p-3">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-0.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-5"
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                          aria-label="Move up"
                        >
                          <ChevronUp className="size-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-5"
                          disabled={i === dicts.length - 1}
                          onClick={() => move(i, 1)}
                          aria-label="Move down"
                        >
                          <ChevronDown className="size-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{d.title}</span>
                        {d.revision && <Badge variant="outline">{d.revision}</Badge>}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{d.termCount.toLocaleString()} terms</p>
                    </div>

                    <Switch
                      size="sm"
                      checked={d.enabled}
                      onCheckedChange={(v) => toggleDict(d.id, v)}
                      aria-label={`Enable ${d.title}`}
                    />

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" aria-label={`Remove ${d.title}`}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove “{d.title}”?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This deletes the dictionary and all {d.termCount.toLocaleString()} of its terms. You can re-import it
                            later.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => removeDict(d.id)}>Remove</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </li>
                ))}
              </ul>
            )}
            {dicts.length > 1 && (
              <p className="text-[11px] text-muted-foreground/70">Dictionaries higher in the list are consulted first.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
