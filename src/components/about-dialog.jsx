import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import aozoraLogo from "@/assets/aozora-logo.png";
import pkg from "../../package.json";

/** GitHub mark — lucide no longer ships brand icons, so inline the SVG. */
function GithubIcon(props) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/**
 * "About" dialog reached from the title bar's info button: the app logo, name +
 * version, a one-line description, the author, and a link to the GitHub repo
 * (opened in the user's default browser via the window IPC).
 */
export function AboutDialog({ open, onOpenChange }) {
  const openRepo = () => window.electronAPI?.window?.openExternal(pkg.homepage);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <img src={aozoraLogo} alt="Aozora" className="h-28 w-auto object-contain" draggable={false} />

          <div className="space-y-1.5">
            <DialogTitle className="text-sm font-semibold">
              <Badge className="font-normal text-muted tabular-nums">v{pkg.version}</Badge>
            </DialogTitle>
            <DialogDescription className="text-xs/relaxed">{pkg.description}</DialogDescription>
          </div>

          <p className="text-xs text-muted-foreground">
            Made by <span className="font-medium text-foreground">{pkg.author.name}</span>
          </p>

          <Button variant="outline" size="sm" onClick={openRepo}>
            <GithubIcon className="size-3.5" />
            View on GitHub
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
