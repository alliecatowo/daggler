"use client";

/* ============================================================================
 * The YAML pane — a real Monaco editor wired to Daggler's live engine.
 *
 *  • Editing the text re-runs the whole pipeline (store.setSource → analysis).
 *  • Diagnostics with resolved spans become Monaco markers (the squiggles).
 *  • Selecting a node elsewhere reveals + line-highlights its source span.
 *  • Moving the cursor selects the owning node (graph + inspector follow).
 * ============================================================================ */

import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import { useEditor } from "../lib/store";
import { pathToSelection, selectionKey, selectionToPath } from "../lib/selection";

const SEV_MARKER = { error: 8, warning: 4, info: 2 } as const; // MarkerSeverity

function defineThemes(monaco: Monaco) {
  monaco.editor.defineTheme("daggler-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "type", foreground: "b39cf0" },
      { token: "string.yaml", foreground: "e7e5f0" },
      { token: "string", foreground: "e7e5f0" },
      { token: "keyword", foreground: "b39cf0" },
      { token: "number", foreground: "c9b8f5" },
      { token: "comment", foreground: "6c6c7a", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#15151b",
      "editor.foreground": "#c6c5d0",
      "editorLineNumber.foreground": "#4a4a57",
      "editorLineNumber.activeForeground": "#9b9ba8",
      "editor.selectionBackground": "#3a2f6a66",
      "editor.lineHighlightBackground": "#1c1c24",
      "editorCursor.foreground": "#9d86e8",
      "editorIndentGuide.background1": "#26262f",
      "editor.selectionHighlightBackground": "#3a2f6a33",
    },
  });
  monaco.editor.defineTheme("daggler-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "type", foreground: "6d3fd1" },
      { token: "string.yaml", foreground: "1f1f29" },
      { token: "comment", foreground: "8a8a98", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#f4f4f7",
      "editor.foreground": "#2a2a35",
      "editorLineNumber.foreground": "#b3b3c0",
    },
  });
}

export function YamlPane() {
  const {
    source,
    setSource,
    analysis,
    selected,
    setSelected,
    theme,
    active,
  } = useEditor();

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decoRef = useRef<string[]>([]);
  const lastSelKey = useRef<string>("none");
  const suppressCursor = useRef(false);

  const onMount: OnMount = useCallback(
    (ed, monaco) => {
      editorRef.current = ed;
      monacoRef.current = monaco;
      defineThemes(monaco);
      monaco.editor.setTheme(theme === "dark" ? "daggler-dark" : "daggler-light");

      ed.onDidChangeCursorPosition((e) => {
        if (suppressCursor.current) return;
        const path = analysisRef.current.sourceMap.pathAtLine(e.position.lineNumber);
        const sel = pathToSelection(path);
        const key = selectionKey(sel);
        if (key !== lastSelKey.current) {
          lastSelKey.current = key;
          setSelected(sel);
        }
      });
    },
    [theme, setSelected],
  );

  // Keep a ref to the latest analysis for the cursor handler closure.
  const analysisRef = useRef(analysis);
  useEffect(() => {
    analysisRef.current = analysis;
  }, [analysis]);

  // Theme switching
  useEffect(() => {
    monacoRef.current?.editor.setTheme(
      theme === "dark" ? "daggler-dark" : "daggler-light",
    );
  }, [theme]);

  // Diagnostics → markers
  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;
    const model = ed.getModel();
    if (!model) return;
    const markers = analysis.validation.diagnostics
      .filter((d) => d.span)
      .map((d) => ({
        startLineNumber: d.span!.start.line,
        startColumn: d.span!.start.col,
        endLineNumber: d.span!.end.line,
        endColumn: Math.max(d.span!.end.col, d.span!.start.col + 1),
        message: `${d.code}: ${d.title}\n${d.message}`,
        severity: SEV_MARKER[d.severity],
        source: d.source,
      }));
    monaco.editor.setModelMarkers(model, "daggler", markers);
  }, [analysis]);

  // External selection → reveal + line highlight
  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;
    const key = selectionKey(selected);
    lastSelKey.current = key;
    const path = selectionToPath(selected);
    const span = path ? analysis.sourceMap.spanForPath(path) : undefined;
    if (!span) {
      decoRef.current = ed.deltaDecorations(decoRef.current, []);
      return;
    }
    suppressCursor.current = true;
    ed.revealLineInCenterIfOutsideViewport(span.start.line);
    decoRef.current = ed.deltaDecorations(decoRef.current, [
      {
        range: new monaco.Range(span.start.line, 1, span.end.line, 1),
        options: {
          isWholeLine: true,
          className: "yaml-sel-deco",
          linesDecorationsClassName: "yaml-sel-gutter",
        },
      },
    ]);
    const t = setTimeout(() => (suppressCursor.current = false), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, analysis.sourceMap]);

  return (
    <div className="yaml-pane">
      <div className="yaml-head">
        <span className="yaml-file mono">{active.path}</span>
        <span className="yaml-flag">YAML · live</span>
      </div>
      <div className="yaml-monaco">
        <Editor
          language="yaml"
          theme={theme === "dark" ? "daggler-dark" : "daggler-light"}
          value={source}
          onChange={(v) => setSource(v ?? "")}
          onMount={onMount}
          loading={<div className="yaml-monaco-loading">Loading editor…</div>}
          options={{
            fontFamily:
              '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
            fontSize: 12.5,
            lineHeight: 20,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderLineHighlight: "line",
            smoothScrolling: true,
            padding: { top: 10, bottom: 60 },
            tabSize: 2,
            wordWrap: "on",
            scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
            overviewRulerLanes: 2,
            guides: { indentation: true },
            fixedOverflowWidgets: true,
          }}
        />
      </div>
    </div>
  );
}
