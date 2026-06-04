/* ============================================================================
 * Source map runtime: turn raw {path → span} data into bidirectional lookups
 * for the editor — node path → highlight range, and cursor line → node path.
 * ========================================================================== */

import type { Position, SourceMapData, SourceSpan } from "./types.js";

/** Build an offset → Position converter for a source string (1-based line/col). */
export function makePositioner(source: string): (offset: number) => Position {
  const lineStarts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) lineStarts.push(i + 1);
  }
  return (offset: number): Position => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: offset - lineStarts[lo]! + 1, offset };
  };
}

/** "Specificity" rank so step spans win over job spans win over workflow spans. */
function rankOf(path: string): number {
  if (path.startsWith("step:")) return 3;
  if (path.startsWith("job:") && path.includes(":", 4)) return 3; // job:x:field
  if (path.startsWith("job:")) return 2;
  if (path.startsWith("trigger:")) return 2;
  if (path.startsWith("workflow:")) return 1;
  return 0;
}

export class SourceMap {
  readonly spans: Record<string, SourceSpan>;
  readonly source: string;

  constructor(data: SourceMapData) {
    this.spans = data.spans;
    this.source = data.source;
  }

  /** The highlight range for a node path, if known. */
  spanForPath(path: string): SourceSpan | undefined {
    return this.spans[path];
  }

  /**
   * The most specific node path whose span contains the given 1-based line.
   * Ties broken by specificity (step > job-field > job > workflow) then by the
   * smallest line range.
   */
  pathAtLine(line: number): string | undefined {
    let best: string | undefined;
    let bestRank = -1;
    let bestSize = Infinity;
    for (const path of Object.keys(this.spans)) {
      const s = this.spans[path]!;
      if (line < s.start.line || line > s.end.line) continue;
      const rank = rankOf(path);
      const size = s.end.line - s.start.line;
      if (rank > bestRank || (rank === bestRank && size < bestSize)) {
        best = path;
        bestRank = rank;
        bestSize = size;
      }
    }
    return best;
  }

  /** Every path whose span covers the given line (unsorted). */
  pathsAtLine(line: number): string[] {
    const out: string[] = [];
    for (const path of Object.keys(this.spans)) {
      const s = this.spans[path]!;
      if (line >= s.start.line && line <= s.end.line) out.push(path);
    }
    return out;
  }
}
