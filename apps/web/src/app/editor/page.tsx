"use client";

import { useEffect } from "react";
import { EditorProvider } from "@/lib/store";
import { EditorShell } from "@/components/EditorShell";

export default function EditorPage() {
  // The editor takes over the viewport; the marketing pages scroll normally.
  useEffect(() => {
    document.body.classList.add("editor-mode");
    return () => document.body.classList.remove("editor-mode");
  }, []);

  return (
    <EditorProvider>
      <EditorShell />
    </EditorProvider>
  );
}
