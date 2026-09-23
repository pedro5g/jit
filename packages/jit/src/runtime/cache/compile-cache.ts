import { executableSchema } from "../../core/hints/metadata.js";

/**
 * Compiled-function cache shared by every `compileX` entry point.
 *
 * Two usage tiers with one storage mechanism:
 * - Tier A (equal/clone/diff/update/hash): bindings derive from the schema
 *   alone, so the fully applied compiled function is cached per schema.
 * - Tier B (query/mapper): bindings are user values, so callers cache the
 *   pure source template (`Function(...names, "return fn;")`) and re-apply
 *   their bindings on every compile — each compile gets its own closure
 *   while AST lowering, optimization, emission, and parsing are skipped.
 *
 * Entries live in a `WeakMap` keyed by executable schema identity: rebuilt
 * schemas never collide, descriptive metadata wrappers reuse their semantic
 * entry, and dropping a schema releases its entry. Hints live on the schema
 * wrapper chain, so identity still captures hint changes.
 */

export interface CompileCacheOptions {
  /** Set to `false` to bypass the compiled-function cache for this call. */
  readonly cache?: boolean;
  /** Semantic compiler context digest; presentation settings must not use this. */
  readonly compilerDigest?: string;
}

let cacheStore = new WeakMap<object, Map<string, unknown>>();

/** Returns the JIT get compile cached result for the supplied input. */
export function getCompileCached<TValue>(
  schema: object,
  key: string,
  build: () => TValue,
  options?: CompileCacheOptions
): TValue {
  if (options?.cache === false) return build();

  const cacheKey = options?.compilerDigest === undefined ? key : `${options.compilerDigest}:${key}`;
  const cacheSchema = executableSchema(schema);

  let entry = cacheStore.get(cacheSchema);

  if (!entry) {
    entry = new Map();
    cacheStore.set(cacheSchema, entry);
  }

  if (entry.has(cacheKey)) return entry.get(cacheKey) as TValue;

  const built = build();

  entry.set(cacheKey, built);
  return built;
}

/** Drops every cached compiled function; intended for tests. */
export function clearCompileCache(): void {
  cacheStore = new WeakMap();
}
