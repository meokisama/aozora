import { useEffect, useState } from "react";
import { MinusIcon, SquareIcon, CopyIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const win = () => window.electronAPI?.window;

function ControlButton({ className, ...props }) {
  return (
    <button
      type="button"
      // Buttons must opt out of the draggable region so clicks register.
      style={{ WebkitAppRegion: "no-drag" }}
      className={cn(
        "flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none",
        className
      )}
      {...props}
    />
  );
}

export function TitleBar({ title = "GNT Engine" }) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const api = win();
    if (!api) return;
    api.isMaximized().then(setIsMaximized);
    return api.onMaximizedChanged(setIsMaximized);
  }, []);

  return (
    <header
      // The whole bar is draggable; interactive children opt out via no-drag.
      style={{ WebkitAppRegion: "drag" }}
      className="flex h-8 shrink-0 select-none items-center justify-between border-b border-border bg-background"
    >
      <div className="flex items-center gap-2 px-3 text-xs font-medium text-muted-foreground">
        {title}
      </div>

      <div className="flex h-full">
        <ControlButton aria-label="Minimize" onClick={() => win()?.minimize()}>
          <MinusIcon className="size-3.5" />
        </ControlButton>
        <ControlButton
          aria-label={isMaximized ? "Restore" : "Maximize"}
          onClick={() => win()?.toggleMaximize()}
        >
          {isMaximized ? (
            <CopyIcon className="size-3" />
          ) : (
            <SquareIcon className="size-3" />
          )}
        </ControlButton>
        <ControlButton
          aria-label="Close"
          onClick={() => win()?.close()}
          className="hover:bg-destructive hover:text-white"
        >
          <XIcon className="size-3.5" />
        </ControlButton>
      </div>
    </header>
  );
}
