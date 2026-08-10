import { useState } from "react";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { applyPrefs, dumpPrefs } from "@/lib/backup-prefs";

/** One setting: label + description on the left, its control on the right. */
function Row({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="space-y-0.5">
        <p className="text-xs font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`;
}

/**
 * Export / restore of the data that can't be re-derived. The archive is built in
 * the main process; this hands it the renderer-owned prefs, writes them back
 * after a restore, then relaunches so every store re-reads its state.
 */
export function BackupSettings() {
  const [includeBooks, setIncludeBooks] = useState(true);
  const [busy, setBusy] = useState<"export" | "restore" | null>(null);

  const exportBackup = async () => {
    setBusy("export");
    try {
      const result = await window.electronAPI.system.exportBackup(includeBooks, dumpPrefs());
      if ("canceled" in result) return;
      if (result.ok) {
        toast.success(`Backup saved (${formatBytes(result.bytes)})`, { description: result.path });
      } else {
        toast.error(`Backup failed: ${result.error}`);
      }
    } finally {
      setBusy(null);
    }
  };

  const restoreBackup = async () => {
    setBusy("restore");
    try {
      const result = await window.electronAPI.system.importBackup();
      if ("canceled" in result) return;
      if (!result.ok) {
        toast.error(`Restore failed: ${result.error}`);
        return;
      }
      applyPrefs(result.prefs);
      if (result.missingBooks) {
        // Rows are kept: they carry progress and highlights worth more than the tidiness.
        toast.warning(`${result.missingBooks} book file(s) were not in the backup`, {
          description: "Their progress and highlights are restored — re-import the files to open them.",
        });
      }
      // Give the toast a beat to be seen before the window goes away.
      setTimeout(() => void window.electronAPI.system.relaunch(), 1200);
    } catch (err) {
      toast.error(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Row
        label="Include book files"
        description="Pack the imported .epub files into the backup. Off keeps it small (covers, progress, highlights and stats only)."
      >
        <Switch checked={includeBooks} onCheckedChange={setIncludeBooks} aria-label="Include book files" />
      </Row>
      <Row
        label="Export backup"
        description="Save your library, reading progress, bookmarks, highlights, statistics and settings to a .zip. Dictionaries and imported fonts are not included."
      >
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void exportBackup()}>
          <Download />
          {busy === "export" ? "Exporting…" : "Export"}
        </Button>
      </Row>
      <Row label="Restore backup" description="Load a backup file. This replaces your current library and settings, then restarts the app.">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={busy !== null}>
              <Upload />
              {busy === "restore" ? "Restoring…" : "Restore"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Restore from a backup?</AlertDialogTitle>
              <AlertDialogDescription>
                Your current library, reading progress, bookmarks, highlights, statistics and settings are replaced by the ones in the backup. Book files
                already imported are kept. The app restarts afterward.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void restoreBackup()}>Choose a backup</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Row>
    </>
  );
}
