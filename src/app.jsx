import React from "react";
import { Toaster } from "@/components/ui/sonner";
import { TitleBar } from "@/components/title-bar";

export function App() {
  return (
    <div className="flex h-screen flex-col">
      <TitleBar />
      <main className="flex-1 overflow-auto p-4">
        <p>Hello World!</p>
      </main>
      <Toaster />
    </div>
  );
}
