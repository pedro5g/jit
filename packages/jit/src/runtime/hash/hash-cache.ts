const HASH_CACHE = new WeakMap<object, number>();

export function getHash<TValue extends object>(value: TValue, compute: (value: TValue) => number): number {
  const cached = HASH_CACHE.get(value);

  if (cached !== undefined) {
    return cached;
  }

  const hash = compute(value);
  HASH_CACHE.set(value, hash);

  return hash;
}

export function isHashCacheable(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}
