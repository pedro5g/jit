import type * as ATS from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { type ChangeLayout, changeLayoutBitFor, emitChangeZero } from "./change-layout.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { emitEqualSource } from "./equal.js";
import { buildProjectionTree, type ProjectionTree } from "./projection.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./source/access.js";
import { emitObjectKey } from "./source/literal.js";

/** One field a derived computation reads, and how it is compared. */
export interface DerivedDependency {
  readonly path: string;
  readonly segments: readonly string[];
  /** The key this dependency takes in the derived value. */
  readonly key: string;
  /** True when `!==` is not enough and the field's own equality is needed. */
  readonly structural: boolean;
  readonly schema: ATS.AnyTypeSchema;
}

/**
 * A computation over part of a state, and the exact fields it reads.
 *
 * Reference memoization asks "did the input change". This asks "did anything
 * this computation reads change", which is a much narrower question — and one
 * that can only be asked because the read set is known before the call.
 */
export interface DerivedDescriptor {
  readonly schema: ATS.AnyTypeSchema;
  readonly dependencies: readonly DerivedDependency[];
  /** The layout the change-mask shortcut is expressed in. */
  readonly layout: ChangeLayout;
  /** Bits of `layout` this computation depends on. */
  readonly mask: number | bigint;
}

/** `!==` answers these correctly; everything else needs the schema's equality. */
const SCALAR_TYPES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "int",
  "bigint",
  "boolean",
  "literal",
  "enum",
  "symbol",
  "undefined",
  "null",
  "date",
]);

export function resolveDerivedDescriptor(
  schema: ATS.AnyTypeSchema,
  paths: readonly string[],
  layout: ChangeLayout
): DerivedDescriptor {
  if (paths.length === 0) {
    throw new JITError("INVALID_OPERATION", "JIT.state.derive().select() needs at least one path");
  }
  const tree = buildProjectionTree(schema, paths, "JIT.state.derive()");
  const keys = new Set<string>();
  const dependencies = tree.paths.map((path) => {
    const segments = path.split(".");
    const key = segments[segments.length - 1] as string;
    if (keys.has(key)) {
      throw new JITError(
        "INVALID_OPERATION",
        `JIT.state.derive() selects ${JSON.stringify(path)} into ${JSON.stringify(key)}, which another path already takes`
      );
    }
    keys.add(key);
    const leaf = leafSchema(tree, path);

    return Object.freeze({
      path,
      segments: Object.freeze(segments),
      key,
      // A date is compared by reference here on purpose: a state that replaced
      // a Date instance replaced the value, which is what a selector sees.
      structural: !SCALAR_TYPES.has(resolveWrappers(leaf).base.type as string),
      schema: leaf,
    });
  });

  let mask: number | bigint = layout.representation === "bigint" ? 0n : 0;
  for (const dependency of dependencies) {
    const bit = changeLayoutBitFor(layout, dependency.segments);
    if (bit === undefined) continue;
    mask = layout.representation === "bigint" ? (mask as bigint) | (1n << BigInt(bit)) : (mask as number) | (1 << bit);
  }

  return Object.freeze({ schema, dependencies, layout, mask });
}

/** The structural comparisons a derived computation needs, named by position. */
export function derivedEqualBindings(descriptor: DerivedDescriptor): readonly { name: string; source: string }[] {
  const bindings: { name: string; source: string }[] = [];

  descriptor.dependencies.forEach((dependency, index) => {
    if (!dependency.structural) return;
    bindings.push({ name: `__derivedEqual${index}`, source: emitEqualSource(dependency.schema) });
  });
  return bindings;
}

/** Emits the plain selector: read the dependencies, build the derived value. */
export function emitDerivedSource(descriptor: DerivedDescriptor): string {
  const writer = new CodeWriter();

  writer.line("function select(state) {");
  writer.indent(() => {
    const entries = descriptor.dependencies.map(
      (dependency) => `${emitObjectKey(dependency.key)}: ${readPath("state", dependency)}`
    );
    writer.line(`return { ${entries.join(", ")} };`);
  });
  writer.line("}");
  return writer.toString();
}

/**
 * Emits the memoized selector.
 *
 * Three questions, cheapest first. Is this the same state object? Does the
 * change mask say nothing this computation reads moved — answered without
 * reading the state at all? And only then: did any dependency actually change?
 * The whole state is never compared, because the computation never reads it.
 */
export function emitDerivedMemoSource(descriptor: DerivedDescriptor): string {
  const writer = new CodeWriter();
  const zero = emitChangeZero(descriptor.layout);
  const maskLiteral = descriptor.layout.representation === "bigint" ? `${descriptor.mask}n` : `${descriptor.mask}`;

  writer.line("(() => {");
  writer.indent(() => {
    // One sentinel stands for "nothing seen yet", so the steady-state call
    // costs one reference comparison and no separate primed flag.
    writer.line("const unset = {};");
    writer.line("let previousState = unset;");
    writer.line("let result;");
    descriptor.dependencies.forEach((_, index) => {
      writer.line(`let previous${index} = unset;`);
    });
    writer.line("function memo(state, mask) {");
    writer.indent(() => {
      writer.line("if (state === previousState) return result;");
      // The mask is consulted before the state is read at all; the primed check
      // rides along on the rare branch where a mask was actually supplied.
      writer.line(`if (mask !== undefined && previousState !== unset && (mask & ${maskLiteral}) === ${zero}) {`);
      writer.indent(() => {
        writer.line("previousState = state;");
        writer.line("return result;");
      });
      writer.line("}");
      descriptor.dependencies.forEach((dependency, index) => {
        writer.line(`const next${index} = ${readPath("state", dependency)};`);
      });
      const same = descriptor.dependencies.map((dependency, index) =>
        dependency.structural
          ? `previous${index} !== unset && __derivedEqual${index}(next${index}, previous${index})`
          : `next${index} === previous${index}`
      );
      writer.line(`if (previousState !== unset && ${same.join(" && ")}) {`);
      writer.indent(() => {
        writer.line("previousState = state;");
        writer.line("return result;");
      });
      writer.line("}");
      descriptor.dependencies.forEach((_, index) => {
        writer.line(`previous${index} = next${index};`);
      });
      writer.line("previousState = state;");
      const entries = descriptor.dependencies.map(
        (dependency, index) => `${emitObjectKey(dependency.key)}: next${index}`
      );
      writer.line(`result = { ${entries.join(", ")} };`);
      writer.line("return result;");
    });
    writer.line("}");
    writer.line("return memo;");
  });
  writer.line("})()");
  return writer.toString();
}

export function derivedCacheKey(descriptor: DerivedDescriptor, memo: boolean): string {
  return `derive:${memo ? "memo" : "select"}:${descriptor.layout.id}:${descriptor.dependencies
    .map((dependency) => dependency.path)
    .join(",")}`;
}

/** Reads a field, short-circuiting through a nullish parent rather than throwing. */
function readPath(source: string, dependency: DerivedDependency): string {
  return dependency.segments.reduce(
    (carrier, segment, index) =>
      index === 0 ? emitPropertyAccess(carrier, segment) : `${carrier}?.${optionalSegment(segment)}`,
    source
  );
}

function optionalSegment(segment: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment) ? segment : `[${JSON.stringify(segment)}]`;
}

function leafSchema(tree: ProjectionTree, path: string): ATS.AnyTypeSchema {
  const dot = path.indexOf(".");
  const head = dot === -1 ? path : path.slice(0, dot);
  const node = tree.nodes.find((candidate) => candidate.key === head);

  // The tree produced this path, so both lookups are guaranteed to resolve.
  if (dot === -1) return (node as { schema: ATS.AnyTypeSchema }).schema;
  return leafSchema((node as { children: ProjectionTree }).children, path.slice(dot + 1));
}
