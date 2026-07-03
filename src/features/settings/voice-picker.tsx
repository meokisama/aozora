import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getVoices, peekVoices } from "./voices-cache";
import type { VoicevoxSpeakerDetail } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: string;
  /** Currently selected styleId. */
  selected: number;
  onSelect: (styleId: number) => void;
}

/**
 * Rich VOICEVOX voice picker: speakers grouped with each style's icon and a
 * preview button (plays a sample clip). Sourced from /speakers + /speaker_info
 * via the `voices` IPC, which returns icons and clips as data URIs. Samples play
 * through their own <audio> element, independent of the reader's playback.
 */
export function VoicePicker({ open, onOpenChange, server, selected, onSelect }: Props) {
  const [speakers, setSpeakers] = useState<VoicevoxSpeakerDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  // Load from the shared cache (hits the engine only on a miss or a forced
  // Refresh, so reopening the picker is instant). `live` guards a late resolve.
  const load = useCallback(
    (force: boolean) => {
      let live = true;
      setError(null);
      if (force || !peekVoices(server)) setSpeakers(null); // spinner only when we must fetch
      getVoices(server, force)
        .then((list) => live && setSpeakers(list))
        .catch(() => live && setError("Could not load voices. Make sure VOICEVOX is running, then Refresh."));
      return () => {
        live = false;
      };
    },
    [server],
  );

  // (Re)load when the dialog opens; stop any preview on close.
  useEffect(() => {
    if (!open) {
      previewRef.current?.pause();
      previewRef.current = null;
      return;
    }
    return load(false);
  }, [open, load]);

  const preview = (sample: string) => {
    previewRef.current?.pause();
    const el = new Audio(sample);
    previewRef.current = el;
    void el.play().catch(() => {});
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl!" aria-describedby={undefined}>
        <DialogHeader className="flex-row items-center justify-between gap-2 pr-8">
          <DialogTitle>Choose a voice</DialogTitle>
          <Button size="sm" variant="outline" onClick={() => load(true)} disabled={!speakers && !error}>
            <RefreshCw /> Refresh
          </Button>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {!speakers && !error && (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading voices…
            </div>
          )}
          {error && <p className="py-10 text-center text-xs text-muted-foreground">{error}</p>}

          {speakers?.map((sp) => (
            <div key={sp.speakerUuid} className="space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">{sp.name}</p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {sp.styles.map((st) => (
                  <div
                    key={st.styleId}
                    className={cn(
                      "flex items-center gap-2 border p-1.5",
                      st.styleId === selected ? "border-primary bg-accent" : "hover:bg-accent/50",
                    )}
                  >
                    <Button
                      variant="ghost"
                      onClick={() => onSelect(st.styleId)}
                      className="h-auto min-w-0 flex-1 justify-start gap-2 px-1 py-0 hover:bg-transparent"
                    >
                      {st.icon ? (
                        <img src={st.icon} alt="" className="size-8 shrink-0 rounded-sm object-cover" />
                      ) : (
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-muted text-xs">{sp.name.slice(0, 1)}</span>
                      )}
                      <span className="truncate text-xs">{st.styleName}</span>
                    </Button>
                    {st.samples.length > 0 && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => preview(st.samples[0])}
                        aria-label={`Preview ${sp.name} ${st.styleName}`}
                        className="shrink-0 text-muted-foreground"
                      >
                        <Play className="size-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
