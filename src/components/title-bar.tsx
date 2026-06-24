import React, { useEffect, useState } from "react";
import { MinusIcon, SquareIcon, CopyIcon, XIcon, Moon, Sun, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettingsStore, THEMES } from "@/stores/settings-store";
import { AboutDialog } from "@/components/about-dialog";

const win = () => window.electronAPI?.window;

function ControlButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      // Buttons must opt out of the draggable region so clicks register.
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      className={cn(
        "flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}

interface TitleBarProps {
  brand?: string;
  tagline?: string;
}

export function TitleBar({ brand = "Aozora 青空", tagline = "青空の下で、物語が始まる。" }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const isDark = (THEMES[theme] || THEMES.sepia).dark;

  useEffect(() => {
    const api = win();
    if (!api) return;
    api.isMaximized().then(setIsMaximized);
    return api.onMaximizedChanged(setIsMaximized);
  }, []);

  return (
    <>
      <header
        // The whole bar is draggable; interactive children opt out via no-drag.
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        className="flex h-8 shrink-0 select-none items-center justify-between border-b border-border bg-background"
      >
        <div className="flex items-center gap-1 px-3 text-xs font-medium text-muted-foreground">
          <span className="font-bold">{brand}</span>
          {tagline && (
            <>
              <span aria-hidden className="h-[1.5px] w-7 bg-muted-foreground/80" />
              <span>{tagline}</span>
            </>
          )}
        </div>

        <div className="flex h-full">
          <ControlButton
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => setTheme(isDark ? "sepia" : "dark")}
            className="w-8"
          >
            {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </ControlButton>
          <ControlButton aria-label="About Aozora" onClick={() => setAboutOpen(true)} className="w-8">
            <Info className="size-3.5" />
          </ControlButton>

          {/* Divider between the app-action group and the window controls. */}
          <span aria-hidden className="mx-1 h-4 w-px self-center bg-border" />

          <ControlButton aria-label="Minimize" onClick={() => win()?.minimize()}>
            <MinusIcon className="size-3.5" />
          </ControlButton>
          <ControlButton aria-label={isMaximized ? "Restore" : "Maximize"} onClick={() => win()?.toggleMaximize()}>
            {isMaximized ? <CopyIcon className="size-3" /> : <SquareIcon className="size-3" />}
          </ControlButton>
          <ControlButton aria-label="Close" onClick={() => win()?.close()} className="hover:bg-destructive hover:text-white">
            <XIcon className="size-3.5" />
          </ControlButton>
        </div>
      </header>

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </>
  );
}
