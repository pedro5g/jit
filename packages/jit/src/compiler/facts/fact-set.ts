/** Immutable set helper for deterministic semantic facts. */
export interface FactSet<TFact> {
  readonly values: readonly TFact[];
  has(key: string): boolean;
}

/** Creates a fact set from values and a stable key function. */
export function createFactSet<TFact>(values: readonly TFact[], keyOf: (fact: TFact) => string): FactSet<TFact> {
  const keys = new Set<string>();
  const unique: TFact[] = [];
  for (const value of values) {
    const key = keyOf(value);
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(value);
  }
  return Object.freeze({
    values: Object.freeze(unique),
    has: (key: string) => keys.has(key),
  });
}
