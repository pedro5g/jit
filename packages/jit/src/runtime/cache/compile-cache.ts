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
 * Entries live in a `WeakMap` keyed by schema object identity: rebuilt
 * schemas never collide, and dropping a schema releases its entry. Hints
 * live on the schema wrapper chain, so identity also captures hint changes.
 */

export interface CompileCacheOptions {
  /** Set to `false` to bypass the compiled-function cache for this call. */
  readonly cache?: boolean;
}

let cacheStore = new WeakMap<object, Map<string, unknown>>();

export function getCompileCached<TValue>(
  schema: object,
  key: string,
  build: () => TValue,
  options?: CompileCacheOptions
): TValue {
  if (options?.cache === false) return build();

  let entry = cacheStore.get(schema);

  if (!entry) {
    entry = new Map();
    cacheStore.set(schema, entry);
  }

  if (entry.has(key)) return entry.get(key) as TValue;

  const built = build();

  entry.set(key, built);
  return built;
}

/** Drops every cached compiled function; intended for tests. */
export function clearCompileCache(): void {
  cacheStore = new WeakMap();
}
