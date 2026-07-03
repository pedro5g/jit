import { buildIndex } from "./build-index.js";

interface CachedIndex<TItem> {
  readonly key: PropertyKey;
  readonly map: Map<unknown, TItem>;
}

const INDEX_CACHE = new WeakMap<readonly object[], CachedIndex<object>>();

export function getIndex<TItem extends object, TKey extends keyof TItem>(
  items: readonly TItem[],
  key: TKey
): Map<TItem[TKey], TItem> {
  const cached = INDEX_CACHE.get(items as readonly object[]);

  if (cached && cached.key === key) {
    return cached.map as Map<TItem[TKey], TItem>;
  }

  const map = buildIndex(items, key);
  INDEX_CACHE.set(items as readonly object[], { key, map: map as Map<unknown, object> });

  return map;
}
