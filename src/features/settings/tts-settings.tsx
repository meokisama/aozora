import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Volume2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTtsStore, ttsParams, SENTENCE_HOTKEYS, type SentenceHotkey } from "@/stores/tts-store";
import { VoicePicker } from "./voice-picker";
import { getVoices, peekVoices, findVoice } from "./voices-cache";
import { speakVoicevox } from "@/lib/reader/voicevox";
import type { VoicevoxSpeakerDetail } from "@/lib/types";

/** A labelled slider row for a synthesis parameter. */
function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs">{label}</span>
      <div className="flex w-56 items-center gap-3">
        <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
        <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{format(value)}</span>
      </div>
    </div>
  );
}

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
  const pitch = useTtsStore((s) => s.pitch);
  const intonation = useTtsStore((s) => s.intonation);
  const volume = useTtsStore((s) => s.volume);
  const pauseLength = useTtsStore((s) => s.pauseLength);
  const furiganaReadings = useTtsStore((s) => s.furiganaReadings);
  const voicevoxServer = useTtsStore((s) => s.voicevoxServer);
  const voicevoxSpeaker = useTtsStore((s) => s.voicevoxSpeaker);

  const setEnabled = useTtsStore((s) => s.setEnabled);
  const setRate = useTtsStore((s) => s.setRate);
  const setPitch = useTtsStore((s) => s.setPitch);
  const setIntonation = useTtsStore((s) => s.setIntonation);
  const setVolume = useTtsStore((s) => s.setVolume);
  const setPauseLength = useTtsStore((s) => s.setPauseLength);
  const setFuriganaReadings = useTtsStore((s) => s.setFuriganaReadings);
  const sentenceHotkey = useTtsStore((s) => s.sentenceHotkey);
  const setVoicevoxServer = useTtsStore((s) => s.setVoicevoxServer);
  const setSentenceHotkey = useTtsStore((s) => s.setSentenceHotkey);

  // Selecting a voice also warms it up so its first read isn't slow.
  const setVoicevoxSpeaker = useCallback((id: number) => {
    useTtsStore.getState().setVoicevoxSpeaker(id);
    void window.electronAPI.voicevox.initialize(useTtsStore.getState().voicevoxServer, id);
  }, []);

  const [voices, setVoices] = useState<VoicevoxSpeakerDetail[] | null>(() => peekVoices(voicevoxServer));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [testing, setTesting] = useState(false);

  // Load the voice catalogue (cached) so the current-voice card shows an icon.
  // Re-runs when the picker closes to reflect a Refresh done inside it.
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    getVoices(voicevoxServer)
      .then((list) => live && setVoices(list))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, voicevoxServer, pickerOpen]);

  const onVoicevoxTest = useCallback(async () => {
    setTesting(true);
    const res = await window.electronAPI.voicevox.test(voicevoxServer);
    setTesting(false);
    if (res.ok) {
      toast.success(`Connected to VOICEVOX (v${res.version}).`);
      getVoices(voicevoxServer, true)
        .then(setVoices)
        .catch(() => {});
    } else {
      toast.error(res.error);
    }
  }, [voicevoxServer]);

  const previewVoicevox = () =>
    void speakVoicevox(TEST_TEXT, {
      server: voicevoxServer,
      styleId: voicevoxSpeaker,
      params: ttsParams(useTtsStore.getState()),
    }).then((err) => {
      if (err) toast.error(err);
    });

  const current = findVoice(voices, voicevoxSpeaker);

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
              <Button
                variant="link"
                className="h-auto p-0 align-baseline font-bold text-foreground underline underline-offset-2 hover:text-primary"
                onClick={() => window.electronAPI?.window?.openExternal(VOICEVOX_DOWNLOAD_URL)}
              >
                VOICEVOX
              </Button>
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
            <div className="flex items-center gap-2 border p-2">
              {current?.icon ? (
                <img src={current.icon} alt="" className="size-9 shrink-0 rounded-sm object-cover" />
              ) : (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-muted text-xs">
                  {current ? current.speaker.slice(0, 1) : "?"}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{current ? current.speaker : `Voice #${voicevoxSpeaker}`}</p>
                <p className="truncate text-[11px] text-muted-foreground">{current ? current.style : "Browse to pick a voice"}</p>
              </div>
              <Button size="sm" variant="outline" onClick={previewVoicevox} aria-label="Test voice">
                <Volume2 /> Sample
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
                Browse
              </Button>
            </div>
          </Group>

          <Group title="Voice">
            <ParamSlider label="Speed" value={rate} min={0.5} max={2} step={0.1} onChange={setRate} format={(v) => `${v.toFixed(1)}x`} />
            <ParamSlider label="Pitch" value={pitch} min={-0.15} max={0.15} step={0.01} onChange={setPitch} format={(v) => v.toFixed(2)} />
            <ParamSlider label="Intonation" value={intonation} min={0} max={2} step={0.1} onChange={setIntonation} format={(v) => v.toFixed(1)} />
            <ParamSlider label="Volume" value={volume} min={0} max={2} step={0.1} onChange={setVolume} format={(v) => v.toFixed(1)} />
            <ParamSlider
              label="Pauses"
              value={pauseLength}
              min={0.5}
              max={2}
              step={0.1}
              onChange={setPauseLength}
              format={(v) => `${v.toFixed(1)}x`}
            />
          </Group>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-xs">Use furigana readings</p>
              <p className="text-[11px] text-muted-foreground">
                Speak the ruby reading over its kanji, so names and rare readings come out as the book intends.
              </p>
            </div>
            <Switch checked={furiganaReadings} onCheckedChange={setFuriganaReadings} aria-label="Use furigana readings" />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-xs">Read sentence</p>
              <p className="text-[11px] text-muted-foreground">
                Hold this key and hover a sentence in the reader to show a button that reads it aloud.
              </p>
            </div>
            <Select value={sentenceHotkey} onValueChange={(v) => setSentenceHotkey(v as SentenceHotkey)}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SENTENCE_HOTKEYS.map((h) => (
                  <SelectItem key={h.value} value={h.value}>
                    {h.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <VoicePicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            server={voicevoxServer}
            selected={voicevoxSpeaker}
            onSelect={(id) => {
              setVoicevoxSpeaker(id);
              setPickerOpen(false);
            }}
          />
        </>
      )}
    </div>
  );
}
