import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Clears the error when it changes, so navigating away recovers on its own. */
  resetKey?: string;
  /** Backs the primary escape-hatch button; omitted ⇒ only "Reload" is offered. */
  onReset?: () => void;
  resetLabel?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render/lifecycle crashes so one malformed book can't blank the window.
 * React unmounts everything below the nearest boundary on a throw — without one,
 * that's the entire app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled render error", error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { onReset, resetLabel } = this.props;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 border p-6">
          <div className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-destructive" />
            <h2 className="text-sm font-medium">Something went wrong</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Aozora hit an unexpected error and stopped drawing this screen. Your library and reading progress are safe.
          </p>
          {error.message && <pre className="max-h-32 overflow-auto border bg-muted/40 p-3 text-[11px] leading-relaxed">{error.message}</pre>}
          <div className="flex gap-2">
            {onReset && (
              <Button size="sm" onClick={() => this.setState({ error: null }, onReset)}>
                {resetLabel || "Go back"}
              </Button>
            )}
            <Button size="sm" variant={onReset ? "outline" : "default"} onClick={() => window.location.reload()}>
              <RotateCcw />
              Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
