"use client";

/* ============================================================================
 * The editor store. Holds the workflow library, the live editable source, the
 * derived analysis (re-run on every edit), selection, view, theme, the run
 * simulation, and the edit/quick-fix actions that mutate YAML through the IR's
 * source-preserving patch engine. This is the single source of truth the UI
 * binds to.
 * ============================================================================ */

import {
  applyCommand,
  pinActionToSha,
  SAMPLE_WORKFLOWS,
  type EditorCommand,
  type SampleWorkflow,
} from "@daggler/workflow-ir";
import { KNOWN_SHAS, type Diagnostic } from "@daggler/validators";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { analyze, type Analysis } from "./engine";

/** Resolve a tag/ref to a pinned SHA from the known catalog. */
function resolveSha(
  fullName: string,
  ref?: string,
): { sha: string; note: string } | undefined {
  if (!ref) return undefined;
  const table = KNOWN_SHAS[fullName];
  if (!table) return undefined;
  const sha = table[ref];
  if (!sha) return undefined;
  return { sha, note: ref };
}

export type Selection =
  | { type: "workflow" }
  | { type: "job"; id: string }
  | { type: "step"; id: string; stepIndex: number }
  | null;

export type SidebarTab =
  | "workflows"
  | "actions"
  | "templates"
  | "diagnostics"
  | "policies";

export type View = "graph" | "split" | "yaml";
export type RunMode = "static" | "local" | "github";
export type JobRunStatus = "idle" | "running" | "passed" | "failed";

export interface RunState {
  mode: RunMode;
  running: boolean;
  jobs: Record<string, JobRunStatus>;
  simulated: boolean;
}

export interface Toast {
  id: number;
  text: string;
}

export interface EditorApi {
  // library + source
  workflows: SampleWorkflow[];
  activeId: string;
  active: SampleWorkflow;
  source: string;
  dirty: boolean;
  analysis: Analysis;
  // ui state
  view: View;
  setView: (v: View) => void;
  tab: SidebarTab;
  setTab: (t: SidebarTab) => void;
  selected: Selection;
  setSelected: (s: Selection) => void;
  selectedAction: string | null;
  setSelectedAction: (a: string | null) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
  diagOpen: boolean;
  setDiagOpen: (o: boolean) => void;
  palOpen: boolean;
  setPalOpen: (o: boolean) => void;
  runState: RunState | null;
  runMode: RunMode;
  toasts: Toast[];
  // mutations
  selectWorkflow: (id: string) => void;
  setSource: (next: string) => void;
  applyEdit: (command: EditorCommand) => void;
  applyQuickFix: (diag: Diagnostic) => void;
  resetActive: () => void;
  runSimulation: (mode: RunMode) => void;
  pushToast: (text: string) => void;
}

const Ctx = createContext<EditorApi | null>(null);

export function useEditor(): EditorApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useEditor must be used within <EditorProvider>");
  return ctx;
}

function depthOf(
  id: string,
  edges: { from: string; to: string; kind: string }[],
  seen = new Set<string>(),
): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  const ins = edges.filter((e) => e.kind === "needs" && e.to === id);
  return ins.length
    ? Math.max(...ins.map((e) => 1 + depthOf(e.from, edges, new Set(seen))))
    : 0;
}

export function EditorProvider({ children }: { children: ReactNode }) {
  const workflows = SAMPLE_WORKFLOWS;
  const [activeId, setActiveId] = useState(workflows[0]!.id);
  // Editable source per workflow id (so switching preserves edits).
  const [sources, setSources] = useState<Record<string, string>>(() =>
    Object.fromEntries(workflows.map((w) => [w.id, w.yaml])),
  );

  const active = useMemo(
    () => workflows.find((w) => w.id === activeId)!,
    [workflows, activeId],
  );
  const source = sources[activeId] ?? active.yaml;
  const dirty = source !== active.yaml;

  const analysis = useMemo(() => analyze(source, active.path), [source, active.path]);

  const [view, setView] = useState<View>("split");
  const [tab, setTab] = useState<SidebarTab>("workflows");
  const [selected, setSelected] = useState<Selection>({ type: "job", id: "build" });
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [diagOpen, setDiagOpen] = useState(true);
  const [palOpen, setPalOpen] = useState(false);
  const [runState, setRunState] = useState<RunState | null>(null);
  const [runMode, setRunMode] = useState<RunMode>("static");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const runTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // theme: hydrate from storage, reflect on <html>
  useEffect(() => {
    const saved = (typeof localStorage !== "undefined" &&
      localStorage.getItem("daggler-theme")) as "dark" | "light" | null;
    if (saved) setTheme(saved);
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("daggler-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  const pushToast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts, { id, text }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 2600);
  }, []);

  const selectWorkflow = useCallback((id: string) => {
    setActiveId(id);
    setSelected(null);
    setSelectedAction(null);
    setRunState(null);
  }, []);

  const setSource = useCallback(
    (next: string) => setSources((s) => ({ ...s, [activeId]: next })),
    [activeId],
  );

  const resetActive = useCallback(() => {
    setSources((s) => ({ ...s, [activeId]: active.yaml }));
    pushToast("Reverted to original");
  }, [activeId, active.yaml, pushToast]);

  const applyEdit = useCallback(
    (command: EditorCommand) => {
      const res = applyCommand(source, command);
      if (res.ok) {
        setSource(res.source);
      } else {
        pushToast(res.error ?? "Edit could not be applied");
      }
    },
    [source, setSource, pushToast],
  );

  const applyQuickFix = useCallback(
    (diag: Diagnostic) => {
      const fix = diag.fix;
      if (!fix) return;
      if (fix.pinSha) {
        const { jobId, stepIndex } = fix.pinSha;
        const job = analysis.ir.jobs.find((j) => j.id === jobId);
        const step = job?.steps[stepIndex];
        if (step && step.kind === "uses" && step.ref.kind === "remote") {
          const full = `${step.ref.owner}/${step.ref.repo}`;
          const resolved = resolveSha(full, step.ref.ref);
          if (resolved) {
            const res = pinActionToSha(
              source,
              jobId,
              stepIndex,
              resolved.sha,
              `${full}@${resolved.note}`,
            );
            if (res.ok) {
              setSource(res.source);
              pushToast(`Pinned ${full} to ${resolved.sha.slice(0, 10)}…`);
              return;
            }
          }
          pushToast(`No known SHA for ${full}@${step.ref.ref} — resolve manually`);
          return;
        }
      }
      if (fix.commands?.length) {
        let next = source;
        for (const cmd of fix.commands) {
          const res = applyCommand(next, cmd);
          if (res.ok) next = res.source;
        }
        setSource(next);
        pushToast(fix.label);
      }
    },
    [analysis.ir, source, setSource, pushToast],
  );

  const runSimulation = useCallback(
    (mode: RunMode) => {
      setRunMode(mode);
      runTimers.current.forEach(clearTimeout);
      runTimers.current = [];

      if (mode === "static") {
        // Static analysis is real and already live — just acknowledge.
        pushToast(
          `Static analysis: ${analysis.validation.counts.error} errors, ` +
            `${analysis.validation.counts.warning} warnings`,
        );
        return;
      }

      const jobs = analysis.ir.jobs;
      const edges = analysis.graph.edges;
      const order = [...jobs].sort(
        (a, b) => depthOf(a.id, edges) - depthOf(b.id, edges),
      );
      const initial: Record<string, JobRunStatus> = {};
      jobs.forEach((j) => (initial[j.id] = "idle"));
      setRunState({ mode, running: true, jobs: initial, simulated: true });

      let i = 0;
      const dur = mode === "local" ? 360 : 560;
      const tick = () => {
        if (i >= order.length) {
          setRunState((rs) => (rs ? { ...rs, running: false } : rs));
          pushToast(
            mode === "local"
              ? "Local approximation finished (simulated — run the bridge to prove)"
              : "GitHub run finished (simulated — connect GitHub to prove)",
          );
          return;
        }
        const id = order[i]!.id;
        setRunState((rs) => (rs ? { ...rs, jobs: { ...rs.jobs, [id]: "running" } } : rs));
        const t1 = setTimeout(() => {
          setRunState((rs) => {
            if (!rs) return rs;
            // surface a failure on a deploy job in github mode, to show error UX
            const concl: JobRunStatus =
              mode === "github" && /deploy|release/i.test(id) ? "failed" : "passed";
            return { ...rs, jobs: { ...rs.jobs, [id]: concl } };
          });
          i++;
          const t2 = setTimeout(tick, 110);
          runTimers.current.push(t2);
        }, dur);
        runTimers.current.push(t1);
      };
      tick();
    },
    [analysis, pushToast],
  );

  useEffect(() => () => runTimers.current.forEach(clearTimeout), []);

  const api: EditorApi = {
    workflows,
    activeId,
    active,
    source,
    dirty,
    analysis,
    view,
    setView,
    tab,
    setTab,
    selected,
    setSelected,
    selectedAction,
    setSelectedAction,
    theme,
    toggleTheme,
    diagOpen,
    setDiagOpen,
    palOpen,
    setPalOpen,
    runState,
    runMode,
    toasts,
    selectWorkflow,
    setSource,
    applyEdit,
    applyQuickFix,
    resetActive,
    runSimulation,
    pushToast,
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
