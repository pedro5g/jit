import { buildIndex } from "./build-index.js";

/**
 * One per-array index store, shared by compiled equality and by index plans.
 *
 * Entries are held in a `WeakMap` keyed by the array reference, so they vanish
 * with the data. An index is only valid while that array's contents are: a
 * cached index of an array mutated in place is stale, which is why the public
 * plan builds fresh by default and exposes caching explicitly.
 */
interface ArrayIndexes {
  /** Single-key slot for compiled equality; matched without allocating. */
  legacyKey: PropertyKey | undefined;
  legacyMap: Map<unknown, object> | undefined;
  /** Index plans, keyed by their descriptor cache key. */
  plans: Map<string, unknown> | undefined;
}

const INDEX_CACHE = new WeakMap<readonly object[], ArrayIndexes>();

function indexesOf(items: readonly object[]): ArrayIndexes {
  let entry = INDEX_CACHE.get(items);

  if (entry === undefined) {
    entry = { legacyKey: undefined, legacyMap: undefined, plans: undefined };
    INDEX_CACHE.set(items, entry);
  }
  return entry;
}

export function getIndex<TItem extends object, TKey extends keyof TItem>(
  items: readonly TItem[],
  key: TKey
): Map<TItem[TKey], TItem> {
  const entry = indexesOf(items as readonly object[]);

  if (entry.legacyMap !== undefined && entry.legacyKey === key) {
    return entry.legacyMap as Map<TItem[TKey], TItem>;
  }

  const map = buildIndex(items, key);

  entry.legacyKey = key;
  entry.legacyMap = map as Map<unknown, object>;

  return map;
}

/**
 * Returns the index a plan built for this array, building it on first use.
 * Distinct plans over the same array coexist, so an index built for a lookup
 * is not thrown away by an index built for a join.
 */
export function getCachedIndex<TIndex>(
  items: readonly object[],
  cacheKey: string,
  build: (items: readonly object[]) => TIndex
): TIndex {
  const entry = indexesOf(items);
  const plans = entry.plans ?? (entry.plans = new Map<string, unknown>());
  const cached = plans.get(cacheKey);

  if (cached !== undefined) return cached as TIndex;

  const built = build(items);

  plans.set(cacheKey, built);
  return built;
}
