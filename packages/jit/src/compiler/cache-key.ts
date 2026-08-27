import * as ATS from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { emitHashSource } from "./hash.js";
import { buildProjectionTree, type ProjectionTree, projectionCacheKey } from "./projection.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./source/access.js";

export type CacheKeyForm = "string" | "hash";

export interface CacheKeyDescriptor {
  readonly tree: ProjectionTree;
  readonly form: CacheKeyForm;
  readonly parts: readonly CacheKeyPart[];
}

interface CacheKeyPart {
  readonly path: string;
  readonly segments: readonly string[];
  /** How the value becomes text without a generic serializer. */
  readonly kind: "string" | "number" | "bigint" | "boolean" | "date" | "structural";
  readonly schema: ATS.AnyTypeSchema;
  readonly nullish: boolean;
}

/** The separator. `` cannot appear unescaped in the parts, so keys cannot collide. */
const SEPARATOR = "";

export function resolveCacheKeyDescriptor(
  schema: ATS.AnyTypeSchema,
  paths: readonly string[],
  form: CacheKeyForm
): CacheKeyDescriptor {
  const tree = buildProjectionTree(schema, paths, "JIT.cacheKey()");
  const parts = tree.paths.map((path) => {
    const leaf = leafSchema(tree, path);
    const wrappers = resolveWrappers(leaf);

    return Object.freeze({
      path,
      segments: Object.freeze(path.split(".")),
      kind: partKind(wrappers.base),
      schema: leaf,
      nullish: wrappers.optional || wrappers.nullable,
    });
  });

  return Object.freeze({ tree, form, parts: Object.freeze(parts) });
}

function partKind(base: ATS.AnyTypeSchema): CacheKeyPart["kind"] {
  switch (base.type) {
    case ATS.TypeName.string:
      return "string";
    case ATS.TypeName.number:
      return "number";
    case ATS.TypeName.bigint:
      return "bigint";
    case ATS.TypeName.boolean:
      return "boolean";
    case ATS.TypeName.date:
      return "date";
    case ATS.TypeName.literal:
    case ATS.TypeName.enum:
      return "string";
    default:
      return "structural";
  }
}

/**
 * Emits the key.
 *
 * The string form concatenates the parts directly. `JSON.stringify` would walk
 * the value, quote and escape every string, and allocate an intermediate object
 * for a selection that is already known — so it is never emitted. The hash form
 * combines the parts numerically and never builds a string at all.
 */
export function emitCacheKeySource(descriptor: CacheKeyDescriptor): string {
  return descriptor.form === "string" ? emitStringKey(descriptor) : emitHashKey(descriptor);
}

function emitStringKey(descriptor: CacheKeyDescriptor): string {
  const writer = new CodeWriter();

  writer.line("function cacheKey(value) {");
  writer.indent(() => {
    const parts = descriptor.parts.map((part, index) => {
      const read = readPath("value", part);
      const text = toText(part, read);

      // A separator between parts is what keeps ("a","bc") from colliding with
      // ("ab","c"); the leading one keeps a single-part key uniform.
      return index === 0 ? text : `${JSON.stringify(SEPARATOR)} + ${text}`;
    });

    writer.line(`return ${parts.join(" + ")};`);
  });
  writer.line("}");
  return writer.toString();
}

function toText(part: CacheKeyPart, read: string): string {
  const body = textExpression(part, read);

  // A nullish part still has to be distinguishable from the empty string.
  return part.nullish ? `(${read} == null ? "\\u0000" : ${body})` : body;
}

function textExpression(part: CacheKeyPart, read: string): string {
  switch (part.kind) {
    case "string":
      return read;
    case "number":
    case "boolean":
      return `${read}`;
    case "bigint":
      return `${read}`;
    case "date":
      return `${read}.getTime()`;
    default:
      // A structural part is reduced to its schema hash rather than serialized;
      // the alternative is walking it twice, once to serialize and once to read.
      return `__cacheKeyHash(${read})`;
  }
}

function emitHashKey(descriptor: CacheKeyDescriptor): string {
  const writer = new CodeWriter();

  writer.line("function cacheKey(value) {");
  writer.indent(() => {
    writer.line("let h = 23;");
    descriptor.parts.forEach((part, index) => {
      const read = readPath("value", part);
      const term = hashExpression(part, read, index);

      writer.line(`h = ((h << 5) - h + ${term}) | 0;`);
    });
    writer.line("return h;");
  });
  writer.line("}");
  return writer.toString();
}

function hashExpression(part: CacheKeyPart, read: string, index: number): string {
  const body = hashTerm(part, read, index);

  return part.nullish ? `(${read} == null ? 0 : ${body})` : body;
}

function hashTerm(part: CacheKeyPart, read: string, index: number): string {
  switch (part.kind) {
    case "string":
      return `__hashString(${read})`;
    case "number":
      return `(${read} | 0)`;
    case "boolean":
      return `(${read} ? 1 : 0)`;
    case "bigint":
      return `(Number(${read} & 0xffffffffn) | 0)`;
    case "date":
      return `(${read}.getTime() | 0)`;
    default:
      return `__cacheKeyHash${index}(${read})`;
  }
}

/** Reads a path, short-circuiting through a nullish parent. */
function readPath(source: string, part: CacheKeyPart): string {
  return part.segments.reduce(
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

  if (dot === -1) return (node as { schema: ATS.AnyTypeSchema }).schema;
  return leafSchema((node as { children: ProjectionTree }).children, path.slice(dot + 1));
}

/** The structural parts that need the schema's hash, named by their position. */
export function cacheKeyHashBindings(descriptor: CacheKeyDescriptor): readonly { name: string; source: string }[] {
  const bindings: { name: string; source: string }[] = [];

  descriptor.parts.forEach((part, index) => {
    if (part.kind !== "structural") return;
    bindings.push({
      name: descriptor.form === "string" ? "__cacheKeyHash" : `__cacheKeyHash${index}`,
      source: emitHashSource(part.schema),
    });
  });
  return bindings;
}

export function cacheKeyCacheKey(descriptor: CacheKeyDescriptor): string {
  return `cacheKey:${descriptor.form}:${projectionCacheKey(descriptor.tree)}`;
}

export function compileCacheKey<TValue, TKey>(
  schema: ATS.AnyTypeSchema,
  descriptor: CacheKeyDescriptor,
  hashHelpers: Readonly<Record<string, unknown>>,
  options?: CompileCacheOptions
): (value: TValue) => TKey {
  const bindings = cacheKeyHashBindings(descriptor);
  const helperNames = Object.keys(hashHelpers);

  if (descriptor.form === "string" && bindings.length > 1) {
    throw new JITError(
      "UNSUPPORTED_SCHEMA",
      "JIT.cacheKey.string() supports at most one structural field; select scalar fields, or use JIT.cacheKey.hash()"
    );
  }

  const template = getCompileCached(
    schema,
    cacheKeyCacheKey(descriptor),
    () => {
      const source = emitCacheKeySource(descriptor);
      return {
        source,
        create: globalThis.Function(...helperNames, ...bindings.map((binding) => binding.name), `return ${source};`),
      };
    },
    options
  );
  const compiled = template.create(
    ...helperNames.map((name) => hashHelpers[name]),
    ...bindings.map((binding) =>
      globalThis.Function(...helperNames, `return ${binding.source};`)(...helperNames.map((name) => hashHelpers[name]))
    )
  ) as (value: TValue) => TKey;

  registerArtifact(compiled as object, { kind: "cache-key-plan", schema, descriptor });
  return compiled;
}
