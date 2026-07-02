import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Volume2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTtsStore } from "@/stores/tts-store";
import { speakVoicevox } from "@/lib/reader/voicevox";
import type { VoicevoxSpeaker } from "@/lib/types";

const TEST_TEXT = "青空の下で、物語が始まる。";
const VOICEVOX_DOWNLOAD_URL = "https://voicevox.hiroshiba.jp/";

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
 * Read-aloud (text-to-speech) settings. Backed solely by a local VOICEVOX
 * engine (high-quality JP voices, reached over HTTP like AnkiConnect). VOICEVOX
 * must be downloaded and running for the feature to work.
 */
export function TtsSettings() {
  const enabled = useTtsStore((s) => s.enabled);
  const rate = useTtsStore((s) => s.rate);
  const voicevoxServer = useTtsStore((s) => s.voicevoxServer);
  const voicevoxSpeaker = useTtsStore((s) => s.voicevoxSpeaker);

  const setEnabled = useTtsStore((s) => s.setEnabled);
  const setRate = useTtsStore((s) => s.setRate);
  const setVoicevoxServer = useTtsStore((s) => s.setVoicevoxServer);
  const setVoicevoxSpeaker = useTtsStore((s) => s.setVoicevoxSpeaker);

  const [speakers, setSpeakers] = useState<VoicevoxSpeaker[]>([]);
  const [testing, setTesting] = useState(false);

  const loadSpeakers = useCallback(async () => {
    try {
      setSpeakers(await window.electronAPI.voicevox.speakers(voicevoxServer));
      return true;
    } catch {
      setSpeakers([]);
      return false;
    }
  }, [voicevoxServer]);

  // Populate the VOICEVOX voice list when the feature is enabled.
  useEffect(() => {
    if (enabled) void loadSpeakers();
  }, [enabled, loadSpeakers]);

  const onVoicevoxTest = useCallback(async () => {
    setTesting(true);
    const res = await window.electronAPI.voicevox.test(voicevoxServer);
    setTesting(false);
    if (res.ok) {
      toast.success(`Connected to VOICEVOX (v${res.version}).`);
      void loadSpeakers();
    } else {
      toast.error(res.error);
    }
  }, [voicevoxServer, loadSpeakers]);

  const previewVoicevox = () =>
    void speakVoicevox(TEST_TEXT, { server: voicevoxServer, styleId: voicevoxSpeaker, rate }).then((err) => {
      if (err) toast.error(err);
    });

  // Show the stored VOICEVOX voice even before the live list loads.
  const speakerOptions =
    speakers.some((s) => s.styleId === voicevoxSpeaker) || speakers.length === 0
      ? speakers
      : [{ name: `Voice #${voicevoxSpeaker}`, styleId: voicevoxSpeaker }, ...speakers];

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-xs font-medium">Read aloud</p>
          <p className="text-[11px] text-muted-foreground">
            Show speaker buttons in the dictionary popup to read the word or its sentence aloud, powered by{" "}
            <span className="font-bold">VOICEVOX</span>.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable read aloud" />
      </div>

      {enabled && (
        <>
          <Group title="VOICEVOX">
            <p className="text-[11px] text-muted-foreground">
              Read aloud requires{" "}
              <button
                type="button"
                className="text-foreground underline underline-offset-2 hover:text-primary font-bold cursor-pointer"
                onClick={() => window.electronAPI?.window?.openExternal(VOICEVOX_DOWNLOAD_URL)}
              >
                VOICEVOX
              </button>
              , a free local Japanese speech engine. Download and run it, then Test the connection below to load its voices.
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={voicevoxServer}
                onChange={(e) => setVoicevoxServer(e.target.value)}
                placeholder="http://127.0.0.1:50021"
                className="flex-1"
                aria-label="VOICEVOX server URL"
              />
              <Button size="sm" variant="outline" onClick={onVoicevoxTest} disabled={testing}>
                {testing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Test
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Select value={String(voicevoxSpeaker)} onValueChange={(v) => setVoicevoxSpeaker(Number(v))}>
                <SelectTrigger size="sm" className="flex-1">
                  <SelectValue placeholder="Voice" />
                </SelectTrigger>
                <SelectContent>
                  {speakerOptions.map((s) => (
                    <SelectItem key={s.styleId} value={String(s.styleId)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={previewVoicevox} aria-label="Test voice">
                <Volume2 /> Test
              </Button>
            </div>
          </Group>

          <div className="flex items-center justify-between gap-4">
            <span className="text-xs">Speed</span>
            <div className="flex w-56 items-center gap-3">
              <Slider value={[rate]} min={0.5} max={1.5} step={0.1} onValueChange={([v]) => setRate(v)} />
              <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{rate.toFixed(1)}x</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
