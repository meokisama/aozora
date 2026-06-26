import { useCallback, useEffect, useState } from "react";
import { BookA, Download, ExternalLink, GripVertical, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import { cn } from "@/lib/utils";
import type { DictionaryInfo } from "@/lib/types";

const api = () => window.electronAPI.dictionary;

// Pre-built Yomitan dictionaries (JMdict/JMnedict/KANJIDIC). The app can't bundle
// them (licensing + size), so we point users here to download a ZIP themselves
// and import it below.
const JMDICT_URL = "https://github.com/yomidevs/jmdict-yomitan";
const openJmdict = () => window.electronAPI?.window?.openExternal(JMDICT_URL);

/**
 * Human label for what a dictionary contributes. A term dictionary has glosses
 * ("terms"); a frequency dictionary (e.g. JPDB) has only frequency ratings and
 * legitimately reports 0 terms, so surface its frequency count instead.
 */
function countLabel(d: Pick<DictionaryInfo, "termCount" | "freqCount" | "pitchCount" | "kanjiCount">): string {
  const parts: string[] = [];
  if (d.termCount) parts.push(`${d.termCount.toLocaleString()} terms`);
  if (d.freqCount) parts.push(`${d.freqCount.toLocaleString()} frequencies`);
  if (d.pitchCount) parts.push(`${d.pitchCount.toLocaleString()} pitch accents`);
  if (d.kanjiCount) parts.push(`${d.kanjiCount.toLocaleString()} kanji`);
  return parts.join(" · ") || "no entries";
}

/**
 * One draggable row in the consult-order list. The grip is the only drag source,
 * so the switch and remove button stay clickable; parent persists the new order.
 */
function SortableDictRow({
  dict,
  onToggle,
  onRemove,
}: {
  dict: DictionaryInfo;
  onToggle: (id: string, next: boolean) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dict.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li ref={setNodeRef} style={style} className={cn("flex items-center gap-3 bg-background p-3", isDragging && "relative z-10 shadow-md")}>
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
        aria-label={`Reorder ${dict.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{dict.title}</span>
          {dict.revision && <Badge variant="outline">{dict.revision}</Badge>}
        </div>
        <p className="text-[11px] text-muted-foreground">{countLabel(dict)}</p>
      </div>

      <Switch checked={dict.enabled} onCheckedChange={(v) => onToggle(dict.id, v)} aria-label={`Enable ${dict.title}`} />

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" aria-label={`Remove ${dict.title}`}>
            <Trash2 className="size-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{dict.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the dictionary and all its entries ({countLabel(dict)}). You can re-import it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => onRemove(dict.id)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/**
 * Dictionary management page (beside the shared sidebar): hover-lookup behaviour
 * (persisted in useDictionaryStore) and the imported Yomitan dictionaries
 * (import, enable, reorder consult priority, remove). The dictionaries and lookup
 * engine live in the main process; this view drives them over IPC and mirrors the list.
 */
export function DictionariesView() {
  const enabled = useDictionaryStore((s) => s.enabled);
  const modifier = useDictionaryStore((s) => s.modifier);
  const setEnabled = useDictionaryStore((s) => s.setEnabled);
  const setModifier = useDictionaryStore((s) => s.setModifier);

  const [dicts, setDicts] = useState<DictionaryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(""); // import status line (large imports take a while)

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
        toast.success(`Imported “${info.title}” (${countLabel(info)})`);
        await refresh();
      }
    } catch (err) {
      toast.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  }, [refresh]);

  const toggleDict = useCallback(
    async (id: string, next: boolean) => {
      setDicts((prev) => prev.map((d) => (d.id === id ? { ...d, enabled: next } : d))); // optimistic
      try {
        await api().setEnabled(id, next);
      } catch {
        await refresh(); // revert to the source of truth on failure
      }
    },
    [refresh],
  );

  const removeDict = useCallback(
    async (id: string) => {
      setDicts((prev) => prev.filter((d) => d.id !== id)); // optimistic
      try {
        await api().remove(id);
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  // A small drag distance keeps clicks on the grip from being read as drags;
  // keyboard sensor makes the list reorderable without a mouse.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Drag-to-reorder the consult order. Priorities are reassigned from the new
  // array order (0..n) so the list stays contiguous regardless of any gaps left
  // by removals; only the rows whose priority actually changed are persisted.
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const from = dicts.findIndex((d) => d.id === active.id);
      const to = dicts.findIndex((d) => d.id === over.id);
      if (from < 0 || to < 0) return;
      const next = arrayMove(dicts, from, to);
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
              Look up Japanese words by hovering text in the reader. Import Yomitan dictionaries (format 3) and choose how lookups are triggered.
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
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={dicts.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                  <ul className="divide-y border">
                    {dicts.map((d) => (
                      <SortableDictRow key={d.id} dict={d} onToggle={toggleDict} onRemove={removeDict} />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
            {dicts.length > 1 && (
              <p className="text-[11px] text-muted-foreground/70">Drag to reorder — dictionaries higher in the list are consulted first.</p>
            )}

            <div className="flex items-start gap-2.5 border bg-muted/30 p-3">
              <ExternalLink className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-[11px]/relaxed text-muted-foreground">
                You can download free Yomitan dictionaries (JMdict, JMnedict, KANJIDIC) as ZIP files and import them here. Get them from:{" "}
                <button
                  type="button"
                  onClick={openJmdict}
                  className="break-all font-medium text-foreground underline underline-offset-2 hover:text-foreground/80"
                >
                  {JMDICT_URL}
                </button>
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
