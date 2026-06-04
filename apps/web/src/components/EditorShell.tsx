"use client";

/* ============================================================================
 * EditorShell — composes the workbench. Every panel reads the shared store via
 * useEditor(), so this is pure layout: top bar, left rail, sidebar, the
 * graph/YAML canvas (driven by the current view), the inspector, the bottom
 * diagnostics panel, the command palette, and the ⌘K fab.
 * ============================================================================ */

import { useEffect } from "react";
import { useEditor } from "../lib/store";
import { TopBar, LeftRail, DiagnosticsPanel, CommandPalette, Fab, ToastStack } from "./Chrome";
import { SidePanel } from "./SidePanel";
import { GraphCanvas } from "./GraphCanvas";
import { YamlPane } from "./YamlPane";
import { Inspector } from "./Inspector";

export function EditorShell() {
  const { view, palOpen, setPalOpen } = useEditor();

  // ⌘K / Ctrl-K toggles the command palette; Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalOpen(!palOpen);
      }
      if (e.key === "Escape") setPalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [palOpen, setPalOpen]);

  return (
    <div className="ed" data-view={view}>
      <TopBar />
      <div className="ed-body">
        <LeftRail />
        <aside className="ed-side">
          <SidePanel />
        </aside>
        <main className="ed-main">
          <div className="ed-canvasarea">
            {(view === "graph" || view === "split") && (
              <div className="ed-pane ed-pane--graph">
                <GraphCanvas />
              </div>
            )}
            {(view === "yaml" || view === "split") && (
              <div className="ed-pane ed-pane--yaml">
                <YamlPane />
              </div>
            )}
          </div>
          <DiagnosticsPanel />
        </main>
        <aside className="ed-inspector">
          <Inspector />
        </aside>
      </div>
      <CommandPalette />
      <Fab />
      <ToastStack />
    </div>
  );
}
