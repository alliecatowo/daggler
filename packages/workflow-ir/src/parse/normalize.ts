/* ============================================================================
 * Normalizers: convert the loose, many-shaped GitHub Actions YAML values into
 * Daggler's strict IR sub-structures. These are pure functions over plain JS
 * (the post-YAML object), with no source-position concerns.
 * ========================================================================== */

import type {
  ActionRef,
  CallSecret,
  DispatchInput,
  ExpressionIR,
  MatrixIR,
  PermissionIR,
  PermissionLevel,
  ReusableWorkflowCallIR,
  StrategyIR,
  TriggerIR,
} from "../ir/types.js";

const EXPR_RE = /\$\{\{\s*([\s\S]*?)\s*\}\}/g;

/** Extract `${{ … }}` expression bodies and whether any are present. */
export function parseExpression(raw: unknown): ExpressionIR {
  const text = raw == null ? "" : String(raw);
  const expressions: string[] = [];
  let m: RegExpExecArray | null;
  EXPR_RE.lastIndex = 0;
  while ((m = EXPR_RE.exec(text)) !== null) {
    expressions.push(m[1]!.trim());
  }
  return { raw: text, hasExpression: expressions.length > 0, expressions };
}

const SHA_RE = /^[0-9a-f]{40}$/i;
const TAG_RE = /^v?\d+(?:[._-]\w+)*$/i;

export function classifyRef(ref: string | undefined): ActionRef["refKind"] {
  if (!ref) return "unknown";
  if (SHA_RE.test(ref)) return "sha";
  if (TAG_RE.test(ref)) return "tag";
  return "branch";
}

/** Parse `owner/repo[/subpath]@ref`, `./local`, or `docker://…`. */
export function parseActionRef(raw: string): ActionRef {
  const value = raw.trim();
  if (value.startsWith("docker://")) {
    return { raw: value, kind: "docker" };
  }
  if (value.startsWith("./") || value.startsWith("../") || value === ".") {
    return { raw: value, kind: "local" };
  }
  const at = value.lastIndexOf("@");
  const pathPart = at >= 0 ? value.slice(0, at) : value;
  const ref = at >= 0 ? value.slice(at + 1) : undefined;
  const segments = pathPart.split("/");
  if (segments.length < 2) {
    return { raw: value, kind: "unknown", ref, refKind: classifyRef(ref) };
  }
  const [owner, repo, ...rest] = segments;
  return {
    raw: value,
    kind: "remote",
    owner,
    repo,
    subpath: rest.length ? rest.join("/") : undefined,
    ref,
    refKind: classifyRef(ref),
  };
}

/** Parse a reusable-workflow `uses:` at the job level. */
export function parseReusableCall(raw: string): ReusableWorkflowCallIR {
  const value = raw.trim();
  if (value.startsWith("./")) {
    return { raw: value, kind: "local", path: value };
  }
  const at = value.lastIndexOf("@");
  const pathPart = at >= 0 ? value.slice(0, at) : value;
  const ref = at >= 0 ? value.slice(at + 1) : undefined;
  const segments = pathPart.split("/");
  if (segments.length < 3) {
    return { raw: value, kind: "unknown", ref, refKind: classifyRef(ref) };
  }
  const [owner, repo, ...rest] = segments;
  return {
    raw: value,
    kind: "remote",
    owner,
    repo,
    path: rest.join("/"),
    ref,
    refKind: classifyRef(ref),
  };
}

const KNOWN_LEVELS = new Set<PermissionLevel>(["read", "write", "none"]);

export function parsePermissions(raw: unknown): PermissionIR | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") {
    if (raw === "read-all") return { all: "read" };
    if (raw === "write-all") return { all: "write" };
    return undefined;
  }
  if (typeof raw === "object") {
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length === 0) return { none: true };
    const scopes: Record<string, PermissionLevel> = {};
    for (const [key, val] of entries) {
      const level = String(val) as PermissionLevel;
      if (KNOWN_LEVELS.has(level)) scopes[key] = level;
    }
    return { scopes: scopes as PermissionIR["scopes"] };
  }
  return undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
}

function parseDispatchInputs(
  raw: unknown,
): Record<string, DispatchInput> | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const out: Record<string, DispatchInput> = {};
  for (const [name, spec] of Object.entries(raw as Record<string, unknown>)) {
    if (spec && typeof spec === "object") {
      const s = spec as Record<string, unknown>;
      out[name] = {
        description: s.description != null ? String(s.description) : undefined,
        required: s.required === true,
        default: s.default as DispatchInput["default"],
        type: s.type as DispatchInput["type"],
        options: asStringArray(s.options),
      };
    } else {
      out[name] = {};
    }
  }
  return out;
}

function parseCallSecrets(
  raw: unknown,
): Record<string, CallSecret> | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const out: Record<string, CallSecret> = {};
  for (const [name, spec] of Object.entries(raw as Record<string, unknown>)) {
    if (spec && typeof spec === "object") {
      const s = spec as Record<string, unknown>;
      out[name] = {
        description: s.description != null ? String(s.description) : undefined,
        required: s.required === true,
      };
    } else {
      out[name] = {};
    }
  }
  return out;
}

function parseCallOutputs(raw: unknown): Record<string, string> | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [name, spec] of Object.entries(raw as Record<string, unknown>)) {
    if (spec && typeof spec === "object") {
      const v = (spec as Record<string, unknown>).value;
      out[name] = v != null ? String(v) : "";
    }
  }
  return out;
}

/** Normalize the `on:` value (string | array | map) into a list of triggers. */
export function parseTriggers(raw: unknown): TriggerIR[] {
  if (raw == null) return [];
  if (typeof raw === "string") return [{ event: raw }];
  if (Array.isArray(raw)) return raw.map((e) => ({ event: String(e) }));
  if (typeof raw !== "object") return [];

  const out: TriggerIR[] = [];
  for (const [event, spec] of Object.entries(raw as Record<string, unknown>)) {
    const t: TriggerIR = { event };
    if (event === "schedule" && Array.isArray(spec)) {
      t.schedule = spec
        .map((s) =>
          s && typeof s === "object"
            ? String((s as Record<string, unknown>).cron ?? "")
            : String(s),
        )
        .filter(Boolean);
    } else if (spec && typeof spec === "object" && !Array.isArray(spec)) {
      const s = spec as Record<string, unknown>;
      t.branches = asStringArray(s.branches);
      t.branchesIgnore = asStringArray(s["branches-ignore"]);
      t.tags = asStringArray(s.tags);
      t.tagsIgnore = asStringArray(s["tags-ignore"]);
      t.paths = asStringArray(s.paths);
      t.pathsIgnore = asStringArray(s["paths-ignore"]);
      t.types = asStringArray(s.types);
      t.inputs = parseDispatchInputs(s.inputs);
      t.secrets = parseCallSecrets(s.secrets);
      t.outputs = parseCallOutputs(s.outputs);
    }
    out.push(t);
  }
  return out;
}

export function parseMatrix(raw: unknown): MatrixIR | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") {
    return { dimensions: {}, fromExpression: true, size: 0 };
  }
  if (typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const dimensions: Record<string, Array<string | number | boolean>> = {};
  let size = 1;
  let hasDim = false;
  for (const [key, val] of Object.entries(r)) {
    if (key === "include" || key === "exclude") continue;
    if (Array.isArray(val)) {
      dimensions[key] = val as Array<string | number | boolean>;
      size *= Math.max(val.length, 1);
      hasDim = true;
    }
  }
  return {
    dimensions,
    include: Array.isArray(r.include)
      ? (r.include as Array<Record<string, string | number | boolean>>)
      : undefined,
    exclude: Array.isArray(r.exclude)
      ? (r.exclude as Array<Record<string, string | number | boolean>>)
      : undefined,
    size: hasDim ? size : 0,
  };
}

export function parseStrategy(raw: unknown): StrategyIR | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  return {
    matrix: parseMatrix(r.matrix),
    failFast: typeof r["fail-fast"] === "boolean"
      ? (r["fail-fast"] as boolean)
      : undefined,
    maxParallel:
      typeof r["max-parallel"] === "number"
        ? (r["max-parallel"] as number)
        : undefined,
  };
}
