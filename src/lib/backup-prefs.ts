import type { BackupPrefs } from "@/lib/types";

/**
 * Reader settings, library/stats prefs, Anki and TTS config live in localStorage
 * (Zustand persist), which only the renderer can reach — so the backup IPC is
 * handed the data rather than reading it itself.
 */

/** Every persisted store is namespaced with this, so the prefix defines the set. */
const PREFIX = "aozora-";

export function dumpPrefs(): BackupPrefs {
  const prefs: BackupPrefs = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) prefs[key] = value;
  }
  return prefs;
}

/**
 * Replaces the persisted prefs with a backup's — existing keys are dropped first
 * so nothing outside the backup survives. The stores have already read
 * localStorage by now, hence the caller's relaunch.
 */
export function applyPrefs(prefs: BackupPrefs): void {
  for (const key of Object.keys(localStorage).filter((k) => k.startsWith(PREFIX))) {
    localStorage.removeItem(key);
  }
  for (const [key, value] of Object.entries(prefs)) {
    if (key.startsWith(PREFIX)) localStorage.setItem(key, value);
  }
}
