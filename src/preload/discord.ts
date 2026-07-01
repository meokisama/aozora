import { ipcRenderer } from "electron";

export interface DiscordPresence {
  bookTitle: string;
  author?: string | null;
  chapterName?: string | null; // full title — shown in the cover's hover tooltip
  chapterIndex?: number; // 1-based position in the TOC
  chapterTotal?: number;
  progress?: number; // 0-100
}

/**
 * Discord Rich Presence control. Fire-and-forget: the main process owns the
 * connection and reconciles state, so the renderer just reports intent.
 */
export const discordApi = {
  /** Turn the integration on/off (connects to / disconnects from Discord). */
  setEnabled: (enabled: boolean) => ipcRenderer.send("discord:set-enabled", enabled),
  /** Report what the user is currently reading. */
  update: (presence: DiscordPresence) => ipcRenderer.send("discord:update", presence),
  /** Clear the presence (no book open) while staying connected. */
  clear: () => ipcRenderer.send("discord:clear"),
};
