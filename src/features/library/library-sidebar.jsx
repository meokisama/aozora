import { useMemo } from "react";
import { BookOpen, CheckCircle2, Circle, Heart, Library } from "lucide-react";
import { cn } from "@/lib/utils";
import aozoraLogo from "@/assets/aozora-logo.png";

const STATUS_NAV = [
  { value: "all", label: "All books", icon: Library },
  { value: "favorites", label: "Favorites", icon: Heart },
  { value: "reading", label: "Reading", icon: BookOpen },
  { value: "finished", label: "Finished", icon: CheckCircle2 },
  { value: "unread", label: "Unread", icon: Circle },
];

/** A single sidebar nav row: icon + label on the left, a count on the right. */
function NavItem({ icon: Icon, label, count, active, onClick }) {
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

function SectionLabel({ children }) {
  return <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{children}</p>;
}

/**
 * The library's left rail: brand, status navigation and an author browser
 * (derived from the books themselves — no stored taxonomy). All filter state is
 * owned by the parent LibraryView and threaded through here.
 */
export function LibrarySidebar({ books, counts, statusFilter, setStatusFilter, authorFilter, setAuthorFilter }) {
  // Authors grouped from the library, most-prolific first. Derived with useMemo
  // (never returned straight from a store selector).
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
            active={statusFilter === item.value && !authorFilter}
            onClick={() => {
              setAuthorFilter(null);
              setStatusFilter(item.value);
            }}
          />
        ))}
      </nav>

      {authors.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col">
          <SectionLabel>Authors</SectionLabel>
          <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3 [&::-webkit-scrollbar-thumb]:bg-transparent [&::-webkit-scrollbar-thumb]:transition-colors hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40">
            {authors.map((a) => (
              <NavItem
                key={a.name}
                label={a.name}
                count={a.count}
                active={authorFilter === a.name}
                onClick={() => {
                  // Picking an author shows all of their works — clear any
                  // reading/unread status filter so it isn't applied on top.
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
