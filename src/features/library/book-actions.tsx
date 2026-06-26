import { useState } from "react";
import { Check, Heart, HeartOff, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLibraryStore } from "@/stores/library-store";
import { readingStatus } from "@/lib/format";
import { BookEditDialog } from "./book-edit-dialog";
import type { Book } from "@/lib/types";

interface ActionItem {
  key: string;
  label?: string;
  icon?: React.ComponentType<{ className?: string }>;
  variant?: "default" | "destructive";
  separator?: boolean;
  onSelect?: () => void;
}

interface BookActionsState {
  status: string;
  items: ActionItem[];
  editOpen: boolean;
  setEditOpen: (open: boolean) => void;
  confirmOpen: boolean;
  setConfirmOpen: (open: boolean) => void;
  handleRemove: () => Promise<void>;
}

/**
 * Shared state + handlers for the book actions, surfaced as both a right-click
 * context menu and a dropdown. Owning the dialogs here keeps the two menus in sync.
 */
function useBookActions(book: Book): BookActionsState {
  const removeBook = useLibraryStore((s) => s.removeBook);
  const setFinished = useLibraryStore((s) => s.setFinished);
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const status = readingStatus(book);

  const handleRemove = async () => {
    try {
      await removeBook(book.id);
      toast.success("Book removed");
    } catch {
      toast.error("Failed to remove book");
    }
  };

  const handleMark = (finished: boolean) => {
    setFinished(book.id, finished).catch(() => toast.error("Failed to update status"));
  };

  const handleToggleFavorite = () => {
    toggleFavorite(book.id)
      .then(() => toast.success(book.favorite ? "Removed from favorites" : "Added to favorites"))
      .catch(() => toast.error("Failed to update favorite"));
  };

  // Descriptors shared by both menus; falsy entries are filtered so the mark
  // items only show when they'd actually change state.
  const items = [
    { key: "edit", label: "Edit details", icon: Pencil, onSelect: () => setEditOpen(true) },
    book.favorite
      ? { key: "favorite", label: "Remove from favorites", icon: HeartOff, onSelect: handleToggleFavorite }
      : { key: "favorite", label: "Add to favorites", icon: Heart, onSelect: handleToggleFavorite },
    status !== "finished" && { key: "finish", label: "Mark as finished", icon: Check, onSelect: () => handleMark(true) },
    status !== "unread" && { key: "unread", label: "Mark as unread", icon: RotateCcw, onSelect: () => handleMark(false) },
    { key: "sep", separator: true },
    { key: "remove", label: "Remove", icon: Trash2, variant: "destructive", onSelect: () => setConfirmOpen(true) },
  ].filter(Boolean) as ActionItem[];

  return { status, items, editOpen, setEditOpen, confirmOpen, setConfirmOpen, handleRemove };
}

/** The edit dialog + remove confirmation, rendered once per menu instance. */
function BookActionDialogs({ book, state }: { book: Book; state: BookActionsState }) {
  return (
    <>
      <BookEditDialog book={book} open={state.editOpen} onOpenChange={state.setEditOpen} />

      <AlertDialog open={state.confirmOpen} onOpenChange={state.setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove book?</AlertDialogTitle>
            <AlertDialogDescription>
              “{book.title}” will be removed from your library and its files deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={state.handleRemove}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Wraps a book card/row so right-clicking opens the action menu. */
export function BookContextMenu({ book, children }: { book: Book; children: React.ReactNode }) {
  const state = useBookActions(book);

  return (
    <>
      {/* modal={false}: opening a dialog from a menu item otherwise collides
          with the menu's body pointer-events lock. */}
      <ContextMenu modal={false}>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          {state.items.map((item) =>
            item.separator ? (
              <ContextMenuSeparator key={item.key} />
            ) : (
              <ContextMenuItem key={item.key} variant={item.variant} onSelect={item.onSelect}>
                {item.icon && <item.icon className="size-3.5" />}
                {item.label}
              </ContextMenuItem>
            ),
          )}
        </ContextMenuContent>
      </ContextMenu>

      <BookActionDialogs book={book} state={state} />
    </>
  );
}

/**
 * The same actions as a dropdown, for the hover "⋯" button on cards/rows.
 * `trigger` is the element that opens it (rendered via asChild).
 */
export function BookActionsMenu({ book, trigger }: { book: Book; trigger: React.ReactNode }) {
  const state = useBookActions(book);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {state.items.map((item) =>
            item.separator ? (
              <DropdownMenuSeparator key={item.key} />
            ) : (
              <DropdownMenuItem key={item.key} variant={item.variant} onSelect={item.onSelect}>
                {item.icon && <item.icon className="size-3.5" />}
                {item.label}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <BookActionDialogs book={book} state={state} />
    </>
  );
}
