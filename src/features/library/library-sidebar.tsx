import { useMemo } from "react";
import { BarChart3, BookA, BookOpen, CheckCircle2, Circle, Heart, Library, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { readingStatus } from "@/lib/format";
import { useLibraryStore } from "@/stores/library-store";
import { useUiStore, type StatusFilter } from "@/stores/ui-store";
import aozoraLogo from "@/assets/aozora-logo.png";

const STATUS_NAV: { value: StatusFilter; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "all", label: "All books", icon: Library },
  { value: "favorites", label: "Favorites", icon: Heart },
  { value: "reading", label: "Reading", icon: BookOpen },
  { value: "finished", label: "Finished", icon: CheckCircle2 },
  { value: "unread", label: "Unread", icon: Circle },
];

/** A single sidebar nav row: icon + label on the left, a count on the right. */
function NavItem({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors cursor-pointer",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-foreground/80 hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="truncate">{label}</span>
      {count != null && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">{count}</span>}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{children}</p>;
}

/**
 * The app's left rail: brand, status nav, links, and an author browser derived
 * from the books (no stored taxonomy). Reads the library and owns nav/filter
 * state via the stores, so every page can render it unchanged.
 */
export function LibrarySidebar() {
  const books = useLibraryStore((s) => s.books);
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const statusFilter = useUiStore((s) => s.statusFilter);
  const setStatusFilter = useUiStore((s) => s.setStatusFilter);
  const authorFilter = useUiStore((s) => s.authorFilter);
  const setAuthorFilter = useUiStore((s) => s.setAuthorFilter);

  const inLibrary = view === "library";

  // Status counts for the nav labels, over the whole library. Derived with
  // useMemo (never returned straight from a store selector).
  const counts = useMemo(() => {
    const c = { all: books.length, favorites: 0, reading: 0, finished: 0, unread: 0 };
    for (const b of books) {
      c[readingStatus(b)] += 1;
      if (b.favorite) c.favorites += 1;
    }
    return c;
  }, [books]);

  // Authors grouped from the library, most-prolific first.
  const authors = useMemo(() => {
    const map = new Map();
    for (const b of books) {
      const name = b.author?.trim();
      if (!name) continue;
      map.set(name, (map.get(name) || 0) + 1);
    }
    return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"));
  }, [books]);

  return (
    <aside className="flex h-full w-52 shrink-0 flex-col border-r bg-sidebar">
      <div className="flex shrink-0 items-center justify-center border-b p-4">
        <img src={aozoraLogo} alt="Aozora" className="h-26 w-auto object-contain" draggable={false} />
      </div>

      <nav className="shrink-0 space-y-0.5 px-2 py-3">
        <SectionLabel>Library</SectionLabel>
        {STATUS_NAV.map((item) => (
          <NavItem
            key={item.value}
            icon={item.icon}
            label={item.label}
            count={counts[item.value]}
            active={inLibrary && statusFilter === item.value && !authorFilter}
            onClick={() => {
              setView("library");
              setAuthorFilter(null);
              setStatusFilter(item.value);
            }}
          />
        ))}
      </nav>

      <nav className="shrink-0 space-y-0.5 border-t px-2 py-3">
        <NavItem icon={BarChart3} label="Statistics" active={view === "stats"} onClick={() => setView("stats")} />
        <NavItem icon={BookA} label="Dictionaries" active={view === "dictionaries"} onClick={() => setView("dictionaries")} />
        <NavItem icon={Settings} label="Settings" active={view === "settings"} onClick={() => setView("settings")} />
      </nav>

      {authors.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col border-t pt-3">
          <SectionLabel>Authors</SectionLabel>
          <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3 [&::-webkit-scrollbar-thumb]:bg-transparent [&::-webkit-scrollbar-thumb]:transition-colors hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40">
            {authors.map((a) => (
              <NavItem
                key={a.name}
                label={a.name}
                count={a.count}
                active={inLibrary && authorFilter === a.name}
                onClick={() => {
                  // Picking an author shows all their works — clear the status
                  // filter so it isn't applied on top.
                  setView("library");
                  setStatusFilter("all");
                  setAuthorFilter(authorFilter === a.name ? null : a.name);
                }}
              />
            ))}
          </nav>
        </div>
      )}
    </aside>
  );
}
