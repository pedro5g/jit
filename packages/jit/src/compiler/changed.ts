import * as ATS from "../core/ats/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { emitEqualSource } from "./equal.js";
import { buildProjectionTree, expectProjectionObject, type ProjectionTree } from "./projection.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./source/access.js";

/**
 * How a change mask is represented.
 *
 * Up to 31 fields fit in a value V8 keeps as a small integer, so the mask costs
 * nothing to return, test or store. Past that a number would silently drop
 * bits, so the representation widens to `bigint` rather than answering wrongly.
 */
export type MaskRepresentation = "int32" | "bigint";

/** The most fields a small-integer mask carries without losing a bit. */
export const INT32_MASK_LIMIT = 31;

interface ChangedField {
  readonly path: string;
  readonly segments: readonly string[];
  /** True when `!==` is not enough and the field's own equality is needed. */
  readonly structural: boolean;
  readonly schema: ATS.AnyTypeSchema;
}

export interface ChangedDescriptor {
  readonly tree: ProjectionTree;
  readonly representation: MaskRepresentation;
  /** Watched fields in bit order; the index is the bit position. */
  readonly fields: readonly ChangedField[];
}

/** `!==` answers these correctly; everything else needs the schema's equality. */
const SCALAR_TYPES: ReadonlySet<string> = new Set([
  ATS.TypeName.string,
  ATS.TypeName.number,
  ATS.TypeName.bigint,
  ATS.TypeName.boolean,
  ATS.TypeName.literal,
  ATS.TypeName.enum,
  ATS.TypeName.symbol,
  ATS.TypeName.undefined,
  ATS.TypeName.null,
]);

/** Every declared field, in declaration order — what `changed()` watches by default. */
export function allFieldPaths(schema: ATS.AnyTypeSchema, operation: string): readonly string[] {
  return Object.keys(expectProjectionObject(schema, operation).def.props);
}

export function resolveChangedDescriptor(schema: ATS.AnyTypeSchema, paths: readonly string[]): ChangedDescriptor {
  const tree = buildProjectionTree(schema, paths, "JIT.compare.changed()");
  const fields = tree.paths.map((path) => {
    const leaf = leafSchema(tree, path);

    return Object.freeze({
      path,
      segments: Object.freeze(path.split(".")),
      structural: !SCALAR_TYPES.has(resolveWrappers(leaf).base.type as string),
      schema: leaf,
    });
  });

  return Object.freeze({
    tree,
    fields: Object.freeze(fields),
    representation: fields.length > INT32_MASK_LIMIT ? ("bigint" as const) : ("int32" as const),
  });
}

/**
 * Emits the mask: one comparison per watched field, each setting its own bit.
 *
 * There is no result object and no field-name string. A `{ field: boolean }`
 * result would allocate an object per comparison to answer a question that fits
 * in a register, and callers overwhelmingly ask about one field at a time.
 */
export function emitChangedSource(descriptor: ChangedDescriptor): string {
  const writer = new CodeWriter();
  const zero = descriptor.representation === "bigint" ? "0n" : "0";

  writer.line("function changed(left, right) {");
  writer.indent(() => {
    writer.line(`if (left === right) return ${zero};`);
    writer.line(`let mask = ${zero};`);
    descriptor.fields.forEach((field, index) => {
      const bit = descriptor.representation === "bigint" ? `(1n << ${index}n)` : `${1 << index}`;
      const left = readPath("left", field);
      const right = readPath("right", field);
      const differs = field.structural ? `!__changedEqual${index}(${left}, ${right})` : `${left} !== ${right}`;

      writer.line(`if (${differs}) mask |= ${bit};`);
    });
    writer.line("return mask;");
  });
  writer.line("}");
  return writer.toString();
}

/** Reads a field, short-circuiting through a nullish parent rather than throwing. */
function readPath(source: string, field: ChangedField): string {
  return field.segments.reduce(
    (carrier, segment, index) =>
      index === 0 ? emitPropertyAccess(carrier, segment) : `${carrier}?.${optionalSegment(segment)}`,
    source
  );
}

function optionalSegment(segment: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment) ? segment : `[${JSON.stringify(segment)}]`;
}

/** The structural comparisons a mask needs, named by their bit position. */
export function changedEqualBindings(descriptor: ChangedDescriptor): readonly { name: string; source: string }[] {
  const bindings: { name: string; source: string }[] = [];

  descriptor.fields.forEach((field, index) => {
    if (!field.structural) return;
    bindings.push({ name: `__changedEqual${index}`, source: emitEqualSource(field.schema) });
  });
  return bindings;
}

function leafSchema(tree: ProjectionTree, path: string): ATS.AnyTypeSchema {
  const dot = path.indexOf(".");
  const head = dot === -1 ? path : path.slice(0, dot);
  const node = tree.nodes.find((candidate) => candidate.key === head);

  // The tree produced this path, so both lookups are guaranteed to resolve.
  if (dot === -1) return (node as { schema: ATS.AnyTypeSchema }).schema;
  return leafSchema((node as { children: ProjectionTree }).children, path.slice(dot + 1));
}

export function changedCacheKey(descriptor: ChangedDescriptor): string {
  return `changed:${descriptor.representation}:${descriptor.fields.map((field) => field.path).join(",")}`;
}

export function compileChanged<TValue, TMask>(
  schema: ATS.AnyTypeSchema,
  descriptor: ChangedDescriptor,
  options?: CompileCacheOptions
): (left: TValue, right: TValue) => TMask {
  const bindings = changedEqualBindings(descriptor);
  const template = getCompileCached(
    schema,
    changedCacheKey(descriptor),
    () => {
      const source = emitChangedSource(descriptor);
      return {
        source,
        create: globalThis.Function(...bindings.map((binding) => binding.name), `return ${source};`),
      };
    },
    options
  );
  const compiled = template.create(
    ...bindings.map((binding) => globalThis.Function(`return ${binding.source};`)())
  ) as (left: TValue, right: TValue) => TMask;

  registerArtifact(compiled as object, { kind: "changed-plan", schema, descriptor });
  return compiled;
}
