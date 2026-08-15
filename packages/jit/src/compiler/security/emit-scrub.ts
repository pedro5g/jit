import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { JITError } from "../../errors/index.js";
import { CodeWriter } from "../emitter/code-writer.js";
import { findRecursiveSchemas } from "../schema-recursion.js";
import { emitPropertyAccess } from "../source/access.js";
import { emitLiteral } from "../source/literal.js";

type AnySchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };

/**
 * A field rewrite: receives the (hoisted) field expression and returns the
 * replacement expression, optionally emitting prelude statements through the
 * writer (hash loops, temporaries).
 */
export type ScrubAction = (valueExpr: string, writer: CodeWriter, nextVar: (prefix: string) => string) => string;

/** Decides whether a leaf schema gets rewritten and how. */
export type ScrubSelector = (base: AnySchema) => ScrubAction | undefined;

export interface EmittedScrub {
  readonly source: string;
  /** False when no field matched — the compiled function is the identity. */
  readonly rewrites: boolean;
}

interface ScrubContext {
  readonly writer: CodeWriter;
  readonly selector: ScrubSelector;
  varCounter: number;
  /** Cycle participants, each rewritten once as its own named function. */
  readonly recursive: ReadonlySet<ATS.AnyTypeSchema>;
  readonly helperIds: Map<ATS.AnyTypeSchema, string>;
  readonly pending: ATS.AnyTypeSchema[];
}

/**
 * Emits a surgical rewriting function `scrub(value)`: subtrees containing a
 * selected field are rebuilt as inline object literals / indexed loops, and
 * every untouched subtree is reused by reference (structural sharing, like
 * compiled updates). No `Object.keys`, no spread, no closures.
 */
export function emitScrub(schema: ATS.AnyTypeSchema, selector: ScrubSelector): EmittedScrub {
  const writer = new CodeWriter();
  const context: ScrubContext = {
    writer,
    selector,
    varCounter: 0,
    recursive: findRecursiveSchemas(schema),
    helperIds: new Map(),
    pending: [],
  };
  const rewrites = subtreeMatches(schema, selector, new Set());

  writer.line("function scrub(value) {");
  writer.indent(() => {
    if (!rewrites) {
      writer.line("return value;");
      return;
    }

    const output = emitScrubExpr(context, schema, "value");

    writer.line(`return ${output};`);
  });
  writer.line("}");

  emitScrubHelpers(context);
  return { source: writer.toString(), rewrites };
}

/**
 * A cycle participant becomes its own function, so a self-referencing shape
 * rewrites at run time instead of expanding forever at emit time.
 */
function emitScrubHelpers(context: ScrubContext): void {
  while (context.pending.length > 0) {
    const target = context.pending.shift() as ATS.AnyTypeSchema;
    const writer = context.writer;
    const body = new CodeWriter();
    const nested: ScrubContext = { ...context, writer: body };

    body.line(`function ${context.helperIds.get(target)}(value) {`);
    body.indent(() => {
      const output = emitScrubBase(nested, target, "value");

      body.line(`return ${output};`);
    });
    body.line("}");
    writer.line(body.toString().trimEnd());
  }
}

function scrubHelper(context: ScrubContext, target: ATS.AnyTypeSchema): string {
  const existing = context.helperIds.get(target);

  if (existing) return existing;

  const id = `scrub_r${context.helperIds.size + 1}`;

  context.helperIds.set(target, id);
  context.pending.push(target);
  return id;
}

function nextVar(context: ScrubContext, prefix: string): string {
  return `${prefix}${++context.varCounter}`;
}

/**
 * Emits statements rewriting `valueExpr` under `schema` and returns the
 * resulting expression. Optional/nullable wrappers become statement-level
 * guards so loops and hash preludes never touch missing values.
 */
function emitScrubExpr(context: ScrubContext, schema: ATS.AnyTypeSchema, valueExpr: string): string {
  const resolved = resolveScrubWrappers(schema);
  const base = resolved.base;

  if (context.recursive.has(base)) {
    const call = `${scrubHelper(context, base)}(${valueExpr})`;

    if (!resolved.optional && !resolved.nullable) return call;

    const holder = hoist(context, valueExpr);

    return `(${holder} == null ? ${holder} : ${scrubHelper(context, base)}(${holder}))`;
  }

  return emitScrubBase(context, schema, valueExpr);
}

/** The body of a scrub, with the recursion guard already applied. */
function emitScrubBase(context: ScrubContext, schema: ATS.AnyTypeSchema, valueExpr: string): string {
  const resolved = resolveScrubWrappers(schema);
  const base = resolved.base;
  const action = context.selector(base);
  const writer = context.writer;

  const guard = (inner: (source: string) => string): string => {
    if (!resolved.optional && !resolved.nullable) return inner(valueExpr);

    const holder = hoist(context, valueExpr);
    const result = nextVar(context, "r");
    const presentTest =
      resolved.optional && resolved.nullable
        ? `${holder} != null`
        : resolved.optional
          ? `${holder} !== undefined`
          : `${holder} !== null`;

    writer.line(`let ${result} = ${holder};`);
    writer.line(`if (${presentTest}) {`);
    writer.indent(() => {
      writer.line(`${result} = ${inner(holder)};`);
    });
    writer.line("}");
    return result;
  };

  if (action) {
    return guard((source) => {
      const holder = hoist(context, source);

      return action(holder, writer, (prefix) => nextVar(context, prefix));
    });
  }

  switch (base.type) {
    case TypeName.object: {
      const props = base.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;

      return guard((source) => {
        const holder = hoist(context, source);
        const entries = Object.keys(props).map((key) => {
          const propExpr = emitPropertyAccess(holder, key);
          const rewritten = subtreeMatches(props[key], context.selector)
            ? emitScrubExpr(context, props[key], propExpr)
            : propExpr;

          return `${emitLiteral(key)}: ${rewritten}`;
        });

        return `{ ${entries.join(", ")} }`;
      });
    }
    case TypeName.array: {
      const element = base.def.element as ATS.AnyTypeSchema;

      return guard((source) => {
        const holder = hoist(context, source);
        const out = nextVar(context, "a");
        const index = nextVar(context, "i");
        const item = nextVar(context, "e");

        writer.line(`const ${out} = new Array(${holder}.length);`);
        writer.line(`for (let ${index} = 0; ${index} < ${holder}.length; ${index}++) {`);
        writer.indent(() => {
          writer.line(`const ${item} = ${holder}[${index}];`);
          writer.line(`${out}[${index}] = ${emitScrubExpr(context, element, item)};`);
        });
        writer.line("}");
        return out;
      });
    }
    default:
      throw new JITError(
        "UNSUPPORTED_SCHEMA",
        `scrub compilers support marked fields inside objects and arrays; found ${base.type}`
      );
  }
}

/** Ensures the expression is bound to a named const before repeated reads. */
function hoist(context: ScrubContext, expr: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(expr)) return expr;

  const holder = nextVar(context, "s");

  context.writer.line(`const ${holder} = ${expr};`);
  return holder;
}

interface ResolvedScrubWrappers {
  readonly base: AnySchema;
  readonly optional: boolean;
  readonly nullable: boolean;
}

function resolveScrubWrappers(schema: ATS.AnyTypeSchema): ResolvedScrubWrappers {
  let current = schema as AnySchema;
  let optional = false;
  let nullable = false;

  while (true) {
    switch (current.type) {
      case TypeName.optional:
        optional = true;
        current = current.def.innerType as AnySchema;
        continue;
      case TypeName.nullable:
        nullable = true;
        current = current.def.innerType as AnySchema;
        continue;
      case TypeName.nullish:
        optional = true;
        nullable = true;
        current = current.def.innerType as AnySchema;
        continue;
      case TypeName.default:
      case TypeName.brand:
      case TypeName.readonly:
      case TypeName.refine:
      case TypeName.coerce:
      case TypeName.pipe:
      case TypeName.transform:
        current = current.def.innerType as AnySchema;
        continue;
      case TypeName.lazy:
        current = (current.def.getter as () => AnySchema)();
        continue;
      default:
        return { base: current, optional, nullable };
    }
  }
}

/** True when any leaf in the subtree is selected for rewriting. */
export function subtreeMatches(
  schema: ATS.AnyTypeSchema,
  selector: ScrubSelector,
  seen: Set<ATS.AnyTypeSchema> = new Set()
): boolean {
  const base = resolveScrubWrappers(schema).base;

  // A cycle is finite for this question: revisiting adds nothing.
  if (seen.has(base)) return false;
  seen.add(base);

  if (selector(base)) return true;

  switch (base.type) {
    case TypeName.object: {
      const props = base.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;

      return Object.keys(props).some((key) => subtreeMatches(props[key], selector, seen));
    }
    case TypeName.array:
      return subtreeMatches(base.def.element as ATS.AnyTypeSchema, selector, seen);
    default:
      return false;
  }
}
