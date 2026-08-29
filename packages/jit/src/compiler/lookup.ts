import type * as ATS from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import {
  emitBinarySearch,
  emitCachedIndexLookup,
  emitEarlyExitScan,
  type KeyedAccessChoice,
  type KeyedEmitShape,
  resolveKeyedAccessChoice,
} from "./access-path.js";
import { type IndexDescriptor, resolveIndexDescriptor, resolveIndexKeysFromFacts } from "./indexing.js";
import { resolveRowField, resolveRowObjectSchema, resolveScalarKeyKind } from "./row-keys.js";

/** Reaching one row by one key. The caller supplies the value; JIT picks the path. */
export interface LookupDescriptor {
  readonly key: string;
  readonly descriptor: IndexDescriptor;
  readonly choice: KeyedAccessChoice;
  /** A Date key is matched by timestamp, the way the index stores it. */
  readonly date: boolean;
}

export interface CompiledLookup<TRow, TKey> {
  (rows: readonly TRow[], key: TKey): TRow | undefined;
  /** The access path this lookup resolved to, for review. */
  explain(): Omit<KeyedAccessChoice, "direction">;
}

/**
 * Resolves the key and the access path for a lookup. The key comes from the
 * collection's own facts unless one is named, so `JIT.lookup(Users)` over a
 * `.keyed("id")` collection needs no argument to know what identity means.
 */
export function resolveLookupDescriptor(schema: ATS.AnyTypeSchema, key: string | undefined): LookupDescriptor {
  const object = resolveRowObjectSchema(schema, "lookup");
  const resolved = key ?? resolveIndexKeysFromFacts(schema)?.[0];

  if (!resolved) {
    throw new JITError(
      "UNSUPPORTED_SCHEMA",
      "JIT.lookup() needs a key: declare one with .keyed()/.indexBy()/.uniqueBy(), or name it with .by()"
    );
  }

  const field = resolveRowField(object, resolved, "lookup");

  return Object.freeze({
    key: resolved,
    descriptor: resolveIndexDescriptor(schema, [resolved], "unique"),
    choice: resolveKeyedAccessChoice(schema, resolved),
    date: resolveScalarKeyKind(field, resolved, "lookup") === "date",
  });
}

/**
 * Emits the lookup. The index and binary-search bodies come from the physical
 * query emitters unchanged — a standalone lookup and `where(eq).first()` are
 * the same access path, so they are the same generated code.
 */
export function emitLookupSource(lookup: LookupDescriptor): string {
  // A Date argument has to be read as a timestamp on both sides of the match.
  const shape: KeyedEmitShape = {
    signature: "value, key",
    probe: lookup.date ? "(key == null ? key : key.getTime())" : "key",
    answers: "row",
  };

  if (lookup.choice.strategy === "CachedIndexLookup") return emitCachedIndexLookup(lookup.descriptor, shape);
  if (lookup.choice.strategy === "BinarySearch") {
    return emitBinarySearch(lookup.key, lookup.descriptor, lookup.choice.direction, shape);
  }
  // The fallback is the shared early-exit scan: a lookup, a keyed query
  // terminal and a collection mutation reach a row the same way, so there is
  // one scan rather than one per caller.
  return emitEarlyExitScan(lookup.key, lookup.descriptor, shape);
}

export function lookupCacheKey(lookup: LookupDescriptor): string {
  return `lookup:${lookup.choice.strategy}:${lookup.key}:${lookup.date}:${lookup.choice.direction}`;
}

export function compileLookup<TRow, TKey>(
  schema: ATS.AnyTypeSchema,
  lookup: LookupDescriptor,
  runtimeIndexCache: (value: readonly TRow[], key: string, build: (value: readonly TRow[]) => unknown) => unknown,
  options?: CompileCacheOptions
): CompiledLookup<TRow, TKey> {
  const template = getCompileCached(
    schema,
    lookupCacheKey(lookup),
    () => {
      const source = emitLookupSource(lookup);
      return { source, create: globalThis.Function("__cachedIndex", `return ${source};`) };
    },
    options
  );
  const compiled = template.create(runtimeIndexCache) as CompiledLookup<TRow, TKey>;

  Object.defineProperty(compiled, "explain", {
    value: () =>
      Object.freeze({
        strategy: lookup.choice.strategy,
        reason: lookup.choice.reason,
        complexity: lookup.choice.complexity,
        facts: lookup.choice.facts,
      }),
  });
  registerArtifact(compiled as object, { kind: "lookup-plan", schema, lookup });
  return compiled;
}
