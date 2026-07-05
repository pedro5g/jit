import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { JITError } from "../../errors/index.js";
import { CodeWriter } from "../emitter/code-writer.js";
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
}

/**
 * Emits a surgical rewriting function `scrub(value)`: subtrees containing a
 * selected field are rebuilt as inline object literals / indexed loops, and
 * every untouched subtree is reused by reference (structural sharing, like
 * compiled updates). No `Object.keys`, no spread, no closures.
 */
export function emitScrub(schema: ATS.AnyTypeSchema, selector: ScrubSelector): EmittedScrub {
  const writer = new CodeWriter();
  const context: ScrubContext = { writer, selector, varCounter: 0 };
  const rewrites = subtreeMatches(schema, selector);

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

  return { source: writer.toString(), rewrites };
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
export function subtreeMatches(schema: ATS.AnyTypeSchema, selector: ScrubSelector): boolean {
  const base = resolveScrubWrappers(schema).base;

  if (selector(base)) return true;

  switch (base.type) {
    case TypeName.object: {
      const props = base.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;

      return Object.keys(props).some((key) => subtreeMatches(props[key], selector));
    }
    case TypeName.array:
      return subtreeMatches(base.def.element as ATS.AnyTypeSchema, selector);
    default:
      return false;
  }
}
