/* ============================================================================
 * @daggler/simulate — `if:` expression evaluator
 *
 * evalIf() interprets the common subset of GitHub Actions expression syntax
 * used in `if:` conditions.  It does NOT use eval() or Function(); instead it
 * implements a tiny hand-written tokenizer + recursive-descent parser.
 *
 * Supported forms
 * ---------------
 *   Literals   :  true / false / null / numbers / single- or double-quoted strings
 *   Comparisons:  == and !=
 *   Logical    :  && / || / !
 *   Parens     :  ( expr )
 *   Members    :  github.ref / github.event_name / github.actor /
 *                 github.ref_name / github.base_ref / github.head_ref /
 *                 inputs.<name>
 *   Functions  :  contains(a, b) / startsWith(a, b) / endsWith(a, b) /
 *                 success() / always() / failure() / cancelled()
 *
 * Anything outside this subset returns { value: "unknown", reason: "…" }.
 * ========================================================================== */

/* -------------------------------------------------------------------------- */
/* Public context type                                                          */
/* -------------------------------------------------------------------------- */

export interface GithubContext {
  event_name: string;
  ref: string;
  ref_name: string;
  actor: string;
  base_ref: string;
  head_ref: string;
}

export interface EvalContext {
  github: GithubContext;
  inputs?: Record<string, string>;
  /** Current job status (for success()/failure()/cancelled()). Defaults to "success". */
  jobStatus?: "success" | "failure" | "cancelled";
}

export interface EvalResult {
  value: boolean | "unknown";
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* Tokenizer                                                                    */
/* -------------------------------------------------------------------------- */

type TokenKind =
  | "number"
  | "string"
  | "bool"
  | "null"
  | "ident"
  | "dot"
  | "lparen"
  | "rparen"
  | "comma"
  | "eq"
  | "neq"
  | "and"
  | "or"
  | "not"
  | "eof";

interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    // Skip whitespace
    if (/\s/.test(src[i] ?? "")) {
      i++;
      continue;
    }

    const ch = src[i] ?? "";
    const pos = i;

    // Two-char operators
    if (src.slice(i, i + 2) === "==") {
      tokens.push({ kind: "eq", value: "==", pos });
      i += 2;
      continue;
    }
    if (src.slice(i, i + 2) === "!=") {
      tokens.push({ kind: "neq", value: "!=", pos });
      i += 2;
      continue;
    }
    if (src.slice(i, i + 2) === "&&") {
      tokens.push({ kind: "and", value: "&&", pos });
      i += 2;
      continue;
    }
    if (src.slice(i, i + 2) === "||") {
      tokens.push({ kind: "or", value: "||", pos });
      i += 2;
      continue;
    }

    // Single-char tokens
    if (ch === "(") { tokens.push({ kind: "lparen", value: "(", pos }); i++; continue; }
    if (ch === ")") { tokens.push({ kind: "rparen", value: ")", pos }); i++; continue; }
    if (ch === ",") { tokens.push({ kind: "comma", value: ",", pos }); i++; continue; }
    if (ch === ".") { tokens.push({ kind: "dot", value: ".", pos }); i++; continue; }
    if (ch === "!") { tokens.push({ kind: "not", value: "!", pos }); i++; continue; }

    // String literals (single or double quoted)
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let str = "";
      i++; // skip opening quote
      while (i < src.length && src[i] !== quote) {
        str += src[i];
        i++;
      }
      i++; // skip closing quote
      tokens.push({ kind: "string", value: str, pos });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(src[i + 1] ?? ""))) {
      let num = ch;
      i++;
      while (i < src.length && /[0-9.]/.test(src[i] ?? "")) {
        num += src[i];
        i++;
      }
      tokens.push({ kind: "number", value: num, pos });
      continue;
    }

    // Identifiers / keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (i < src.length && /[a-zA-Z0-9_\-]/.test(src[i] ?? "")) {
        ident += src[i];
        i++;
      }
      if (ident === "true" || ident === "false") {
        tokens.push({ kind: "bool", value: ident, pos });
      } else if (ident === "null") {
        tokens.push({ kind: "null", value: "null", pos });
      } else {
        tokens.push({ kind: "ident", value: ident, pos });
      }
      continue;
    }

    // Unknown character — signal unsupported
    throw new UnsupportedExprError(`Unexpected character '${ch}' at position ${i}`);
  }

  tokens.push({ kind: "eof", value: "", pos: i });
  return tokens;
}

/* -------------------------------------------------------------------------- */
/* AST nodes (a lightweight value union)                                        */
/* -------------------------------------------------------------------------- */

type AstValue =
  | { kind: "literal"; value: boolean | number | string | null }
  | { kind: "member"; path: string[] }
  | { kind: "call"; name: string; args: AstValue[] }
  | { kind: "unary"; op: "!"; operand: AstValue }
  | { kind: "binary"; op: "==" | "!=" | "&&" | "||"; left: AstValue; right: AstValue };

class UnsupportedExprError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "UnsupportedExprError";
  }
}

/* -------------------------------------------------------------------------- */
/* Recursive-descent parser                                                     */
/* -------------------------------------------------------------------------- */

class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: "eof", value: "", pos: -1 };
  }

  private consume(): Token {
    const t = this.tokens[this.pos] ?? { kind: "eof", value: "", pos: -1 };
    this.pos++;
    return t;
  }

  private expect(kind: TokenKind): Token {
    const t = this.consume();
    if (t.kind !== kind) {
      throw new UnsupportedExprError(
        `Expected ${kind} but got ${t.kind} ("${t.value}") at pos ${t.pos}`,
      );
    }
    return t;
  }

  parse(): AstValue {
    const node = this.parseOr();
    if (this.peek().kind !== "eof") {
      throw new UnsupportedExprError(
        `Unexpected token "${this.peek().value}" after expression`,
      );
    }
    return node;
  }

  private parseOr(): AstValue {
    let left = this.parseAnd();
    while (this.peek().kind === "or") {
      this.consume();
      const right = this.parseAnd();
      left = { kind: "binary", op: "||", left, right };
    }
    return left;
  }

  private parseAnd(): AstValue {
    let left = this.parseEquality();
    while (this.peek().kind === "and") {
      this.consume();
      const right = this.parseEquality();
      left = { kind: "binary", op: "&&", left, right };
    }
    return left;
  }

  private parseEquality(): AstValue {
    const left = this.parseUnary();
    const pk = this.peek().kind;
    if (pk === "eq" || pk === "neq") {
      const op = this.consume().kind === "eq" ? "==" : "!=";
      const right = this.parseUnary();
      return { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseUnary(): AstValue {
    if (this.peek().kind === "not") {
      this.consume();
      return { kind: "unary", op: "!", operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): AstValue {
    const t = this.peek();

    if (t.kind === "lparen") {
      this.consume();
      const inner = this.parseOr();
      this.expect("rparen");
      return inner;
    }

    if (t.kind === "bool") {
      this.consume();
      return { kind: "literal", value: t.value === "true" };
    }

    if (t.kind === "null") {
      this.consume();
      return { kind: "literal", value: null };
    }

    if (t.kind === "string") {
      this.consume();
      return { kind: "literal", value: t.value };
    }

    if (t.kind === "number") {
      this.consume();
      return { kind: "literal", value: parseFloat(t.value) };
    }

    if (t.kind === "ident") {
      this.consume();
      const name = t.value;

      // Might be: function call, member access, or bare identifier
      if (this.peek().kind === "lparen") {
        // Function call
        this.consume(); // (
        const args: AstValue[] = [];
        while (this.peek().kind !== "rparen" && this.peek().kind !== "eof") {
          if (args.length > 0) this.expect("comma");
          args.push(this.parseOr());
        }
        this.expect("rparen");
        return { kind: "call", name, args };
      }

      // Member access chain: github.ref, inputs.SOME_KEY, etc.
      const path: string[] = [name];
      while (this.peek().kind === "dot") {
        this.consume(); // .
        const member = this.expect("ident");
        path.push(member.value);
      }

      return { kind: "member", path };
    }

    throw new UnsupportedExprError(
      `Unexpected token ${t.kind} ("${t.value}") in expression`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Evaluator                                                                    */
/* -------------------------------------------------------------------------- */

type RuntimeValue = boolean | number | string | null;

function coerceString(v: RuntimeValue): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function evalNode(
  node: AstValue,
  ctx: EvalContext,
): RuntimeValue | "unknown" {
  switch (node.kind) {
    case "literal":
      return node.value;

    case "member": {
      const [root, ...rest] = node.path;
      if (root === "github") {
        const key = rest.join(".");
        switch (key) {
          case "event_name": return ctx.github.event_name;
          case "ref": return ctx.github.ref;
          case "ref_name": return ctx.github.ref_name;
          case "actor": return ctx.github.actor;
          case "base_ref": return ctx.github.base_ref;
          case "head_ref": return ctx.github.head_ref;
          default: return "unknown";
        }
      }
      if (root === "inputs") {
        const key = rest[0];
        if (key === undefined) return "unknown";
        return ctx.inputs?.[key] ?? "";
      }
      // Unsupported member root
      return "unknown";
    }

    case "unary": {
      const operand = evalNode(node.operand, ctx);
      if (operand === "unknown") return "unknown";
      return !operand;
    }

    case "binary": {
      if (node.op === "&&") {
        const left = evalNode(node.left, ctx);
        // Short-circuit: false && X => false
        if (left !== "unknown" && !left) return false;
        const right = evalNode(node.right, ctx);
        if (left === "unknown" || right === "unknown") return "unknown";
        return Boolean(left) && Boolean(right);
      }
      if (node.op === "||") {
        const left = evalNode(node.left, ctx);
        // Short-circuit: true || X => true
        if (left !== "unknown" && left) return true;
        const right = evalNode(node.right, ctx);
        if (left === "unknown" || right === "unknown") return "unknown";
        return Boolean(left) || Boolean(right);
      }
      // == / !=
      const left = evalNode(node.left, ctx);
      const right = evalNode(node.right, ctx);
      if (left === "unknown" || right === "unknown") return "unknown";
      // GitHub coerces both sides to the same type for comparison
      const ls = coerceString(left);
      const rs = coerceString(right);
      return node.op === "==" ? ls === rs : ls !== rs;
    }

    case "call": {
      const fname = node.name.toLowerCase();

      if (fname === "success") {
        return (ctx.jobStatus ?? "success") === "success";
      }
      if (fname === "always") {
        return true;
      }
      if (fname === "failure") {
        return (ctx.jobStatus ?? "success") === "failure";
      }
      if (fname === "cancelled") {
        return (ctx.jobStatus ?? "success") === "cancelled";
      }

      if (fname === "contains" && node.args.length === 2) {
        const haystack = evalNode(node.args[0]!, ctx);
        const needle = evalNode(node.args[1]!, ctx);
        if (haystack === "unknown" || needle === "unknown") return "unknown";
        return coerceString(haystack).includes(coerceString(needle));
      }

      if (fname === "startswith" && node.args.length === 2) {
        const str = evalNode(node.args[0]!, ctx);
        const prefix = evalNode(node.args[1]!, ctx);
        if (str === "unknown" || prefix === "unknown") return "unknown";
        return coerceString(str).startsWith(coerceString(prefix));
      }

      if (fname === "endswith" && node.args.length === 2) {
        const str = evalNode(node.args[0]!, ctx);
        const suffix = evalNode(node.args[1]!, ctx);
        if (str === "unknown" || suffix === "unknown") return "unknown";
        return coerceString(str).endsWith(coerceString(suffix));
      }

      return "unknown";
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Evaluate a GitHub Actions `if:` expression against a built github context.
 *
 * Strips a leading `${{` / trailing `}}` wrapper if present (the expression
 * body is identical whether it appears bare or inside `${{ }}`).
 *
 * Returns `{ value: boolean | "unknown", reason: string }`.
 */
export function evalIf(ifExpr: string, ctx: EvalContext): EvalResult {
  // Strip ${{ … }} wrapper
  let expr = ifExpr.trim();
  if (expr.startsWith("${{") && expr.endsWith("}}")) {
    expr = expr.slice(3, -2).trim();
  }

  if (expr === "") {
    return { value: true, reason: "Empty if expression defaults to true" };
  }

  try {
    const tokens = tokenize(expr);
    const ast = new Parser(tokens).parse();
    const raw = evalNode(ast, ctx);

    if (raw === "unknown") {
      return {
        value: "unknown",
        reason: `Expression "${expr}" contains unsupported context references`,
      };
    }

    const value = Boolean(raw);
    return {
      value,
      reason: value
        ? `Expression "${expr}" evaluated to true`
        : `Expression "${expr}" evaluated to false`,
    };
  } catch (err) {
    if (err instanceof UnsupportedExprError) {
      return {
        value: "unknown",
        reason: `Cannot evaluate "${expr}": ${err.message}`,
      };
    }
    return {
      value: "unknown",
      reason: `Unexpected error evaluating "${expr}": ${String(err)}`,
    };
  }
}
