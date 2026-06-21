import React from "react";
import { Toaster } from "@/components/ui/sonner";
import { TitleBar } from "@/components/title-bar";
import { LibraryView } from "@/features/library/library-view";
import { ReaderView } from "@/features/reader/reader-view";
import { useReaderStore } from "@/stores/reader-store";

export function App() {
  const reading = useReaderStore((s) => s.currentBook !== null);

  return (
    <div className="flex h-screen flex-col">
      <TitleBar />
      <main className="flex-1 overflow-hidden">
        {reading ? <ReaderView /> : <LibraryView />}
      </main>
      <Toaster />
    </div>
  );
}
