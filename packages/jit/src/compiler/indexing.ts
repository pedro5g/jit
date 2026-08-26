import type * as ATS from "../core/ats/index.js";
import { resolveHints } from "../core/hints/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { resolveHintKey } from "./resolvers/resolve-hints.js";
import {
  isNullishField,
  resolveRowField,
  resolveRowObjectSchema,
  resolveScalarKeyKind,
  type ScalarKeyKind,
} from "./row-keys.js";
import { emitPropertyAccess } from "./source/access.js";

export interface IndexKey {
  readonly key: string;
  readonly valueKind: ScalarKeyKind;
  readonly nullish: boolean;
}

/** How the built index stores the rows that share a key. */
export type IndexShape = "unique" | "grouped";

/**
 * Semantic description of an index over the rows of a collection. It is
 * resolved once, from schema facts or explicit keys, and is the input to every
 * physical access path that addresses rows by key.
 */
export interface IndexDescriptor {
  readonly keys: readonly IndexKey[];
  readonly shape: IndexShape;
  /** True when a collection fact states the key identifies at most one row. */
  readonly uniqueByFact: boolean;
}

export interface CompiledIndex<TRow, TIndex> {
  (value: readonly TRow[]): TIndex;
  readonly cached: (value: readonly TRow[]) => TIndex;
}

/**
 * Reads the key a collection already declares through `.keyed`, `.indexBy`,
 * `.uniqueBy`, `.ordered` or an entity hint. Explicit keys always win.
 */
export function resolveIndexKeysFromFacts(schema: ATS.AnyTypeSchema): readonly string[] | undefined {
  const hints = resolveHints(schema);
  const key =
    resolveHintKey(hints.index?.key) ??
    resolveHintKey(hints.collection?.identify) ??
    resolveHintKey(hints.collection?.uniqueBy) ??
    resolveHintKey(hints.entity?.key);

  return key ? [key] : undefined;
}

export function resolveIndexDescriptor(
  schema: ATS.AnyTypeSchema,
  keys: readonly string[] | undefined,
  shape: IndexShape
): IndexDescriptor {
  const object = resolveRowObjectSchema(schema, "index");
  const resolvedKeys = keys ?? resolveIndexKeysFromFacts(schema);

  if (!resolvedKeys || resolvedKeys.length === 0) {
    throw new JITError(
      "INVALID_OPERATION",
      "index requires a key: declare one with .keyed(), .indexBy() or .uniqueBy(), or pass it to .by()"
    );
  }

  const seen = new Set<string>();
  const indexKeys = resolvedKeys.map((key) => {
    const field = resolveRowField(object, key, "index");

    if (seen.has(key)) {
      throw new JITError("INVALID_OPERATION", `index repeats key ${JSON.stringify(key)}`, { path: [key] });
    }
    seen.add(key);

    return Object.freeze({
      key,
      valueKind: resolveIndexKeyKind(field, key),
      nullish: isNullishField(field),
    });
  });
  const hints = resolveHints(schema);

  return Object.freeze({
    keys: Object.freeze(indexKeys),
    shape,
    uniqueByFact: hints.collection?.unique === true || hints.entity?.key !== undefined,
  });
}

/**
 * Emits the index builder. A single key produces one `Map`; compound keys
 * produce nested `Map`s, which stay exact where a concatenated composite key
 * would have to invent an escaping rule for separators.
 */
export function emitIndexBuilder(
  writer: CodeWriter,
  descriptor: IndexDescriptor,
  open = "(value) => {",
  close = "}"
): void {
  const depth = descriptor.keys.length;

  writer.line(open);
  writer.indent(() => {
    writer.line("const index = new Map();");
    writer.line("const len = value.length;");
    writer.line("for (let i = 0; i < len; i++) {");
    writer.indent(() => {
      writer.line("const row = value[i];");
      descriptor.keys.forEach((key, level) => {
        writer.line(`const key${level} = ${emitIndexKeyRead("row", key)};`);
      });
      // Walk to the map that owns the last key, creating levels on the way.
      for (let level = 0; level < depth - 1; level++) {
        const parent = level === 0 ? "index" : `level${level}`;
        writer.line(`let level${level + 1} = ${parent}.get(key${level});`);
        writer.line(`if (level${level + 1} === undefined) {`);
        writer.indent(() => {
          writer.line(`level${level + 1} = new Map();`);
          writer.line(`${parent}.set(key${level}, level${level + 1});`);
        });
        writer.line("}");
      }
      const bucket = depth === 1 ? "index" : `level${depth - 1}`;
      const lastKey = `key${depth - 1}`;

      if (descriptor.shape === "grouped") {
        writer.line(`const group = ${bucket}.get(${lastKey});`);
        writer.line("if (group === undefined) {");
        writer.indent(() => writer.line(`${bucket}.set(${lastKey}, [row]);`));
        writer.line("} else {");
        writer.indent(() => writer.line("group[group.length] = row;"));
        writer.line("}");
      } else {
        writer.line(`${bucket}.set(${lastKey}, row);`);
      }
    });
    writer.line("}");
    writer.line("return index;");
  });
  writer.line(close);
}

export function emitIndexSource(descriptor: IndexDescriptor): string {
  const writer = new CodeWriter();
  emitIndexBuilder(writer, descriptor);
  return writer.toString();
}

/**
 * Wraps the builder with the shared per-array index cache. The cache arrives as
 * a parameter so runtime and generated hosts share one source shape.
 */
export function emitIndexPlanSource(descriptor: IndexDescriptor, cacheKey: string): string {
  const writer = new CodeWriter();

  writer.line("((__cache) => {");
  writer.indent(() => {
    emitIndexBuilder(writer, descriptor, "const build = (value) => {", "};");
    writer.line(`const cached = (value) => __cache(value, ${JSON.stringify(cacheKey)}, build);`);
    writer.line('Object.defineProperty(build, "cached", { value: cached });');
    writer.line("return build;");
  });
  writer.line("})");
  return writer.toString();
}

/** A `Date` key must be read as a timestamp: Date objects key a Map by identity. */
export function emitIndexKeyRead(row: string, key: IndexKey): string {
  const access = emitPropertyAccess(row, key.key);

  if (key.valueKind !== "date") return access;
  return key.nullish ? `(${access} == null ? ${access} : ${access}.getTime())` : `${access}.getTime()`;
}

export function indexCacheKey(descriptor: IndexDescriptor): string {
  return `index:${descriptor.shape}:${descriptor.keys.map(({ key, valueKind, nullish }) => `${key}:${valueKind}:${nullish}`).join(",")}`;
}

export function compileIndex<TRow, TIndex>(
  schema: ATS.AnyTypeSchema,
  descriptor: IndexDescriptor,
  runtimeIndexCache: (value: readonly TRow[], key: string, build: (value: readonly TRow[]) => TIndex) => TIndex,
  options?: CompileCacheOptions
): CompiledIndex<TRow, TIndex> {
  const cacheKey = indexCacheKey(descriptor);
  const template = getCompileCached(
    schema,
    cacheKey,
    () => {
      const source = emitIndexPlanSource(descriptor, cacheKey);
      return { source, create: globalThis.Function(`return ${source};`) };
    },
    options
  );
  const compiled = template.create()(runtimeIndexCache) as CompiledIndex<TRow, TIndex>;

  registerArtifact(compiled, { kind: "index-plan", schema, descriptor });
  return compiled;
}

function resolveIndexKeyKind(schema: ATS.AnyTypeSchema, key: string): ScalarKeyKind {
  // Indexing shares the scalar classification but not the numeric fast path:
  // a Map key is matched with SameValueZero, so number and string are alike.
  const kind = resolveScalarKeyKind(schema, key, "index");
  return kind === "numeric" ? "direct" : kind;
}
