// Handwritten "what a dev would write" baselines. They are registered with a
// bias flag because they are local implementations, not published libraries.

export function genericMerge<T>(left: T, right: unknown): T {
  if (right === undefined || Object.is(left, right)) return left;
  if (left == null || right == null || typeof left !== "object" || typeof right !== "object") return right as T;

  let changed = false;
  const out: Record<string, unknown> = {};
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);

  for (let i = 0, len = keys.length; i < len; i++) {
    const key = keys[i];
    const next = genericMerge(leftRecord[key], rightRecord[key]);

    out[key] = next;
    if (!Object.is(next, leftRecord[key])) changed = true;
  }

  return changed ? (out as T) : left;
}

export function genericPick<T extends object>(value: T, keys: readonly (keyof T & string)[]): Partial<T> {
  const out: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;

  for (let i = 0, len = keys.length; i < len; i++) {
    const key = keys[i];
    out[key] = record[key];
  }

  return out as Partial<T>;
}

export function genericOmit<T extends object>(value: T, omitted: readonly (keyof T & string)[]): Partial<T> {
  const omittedSet = new Set(omitted);
  const out: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);

  for (let i = 0, len = keys.length; i < len; i++) {
    const key = keys[i];
    if (!omittedSet.has(key as keyof T & string)) out[key] = record[key];
  }

  return out as Partial<T>;
}

export function genericTransform<T extends object>(
  value: T,
  transforms: Partial<Record<keyof T & string, (value: unknown, source: T) => unknown>>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);

  for (let i = 0, len = keys.length; i < len; i++) {
    const key = keys[i];
    const typedKey = key as keyof T & string;
    const fn = transforms[typedKey];
    out[key] = fn ? fn(record[key], value) : record[key];
  }

  return out;
}

export function genericNormalize<T extends object>(
  value: readonly T[],
  keyName: keyof T & string
): { readonly byId: Record<PropertyKey, T>; readonly ids: PropertyKey[] } {
  return value.reduce(
    (out, item) => {
      const id = (item as Record<string, unknown>)[keyName] as PropertyKey;

      out.ids.push(id);
      out.byId[id] = item;
      return out;
    },
    { byId: {} as Record<PropertyKey, T>, ids: [] as PropertyKey[] }
  );
}

export function genericGroupBy<T extends object>(
  value: readonly T[],
  keyName: keyof T & string
): Record<PropertyKey, T[]> {
  return value.reduce(
    (out, item) => {
      const key = (item as Record<string, unknown>)[keyName] as PropertyKey;
      const group = out[key] ?? [];

      group.push(item);
      out[key] = group;
      return out;
    },
    {} as Record<PropertyKey, T[]>
  );
}

export function genericSortBy<T extends object>(
  value: readonly T[],
  keyName: keyof T & string,
  direction: "asc" | "desc"
): T[] {
  return [...value].sort((left, right) => {
    const leftValue = (left as Record<string, string | number>)[keyName];
    const rightValue = (right as Record<string, string | number>)[keyName];

    if (leftValue === rightValue) return 0;
    if (direction === "desc") return leftValue < rightValue ? 1 : -1;
    return leftValue < rightValue ? -1 : 1;
  });
}

export function genericUniqueBy<T extends object>(value: readonly T[], keyName: keyof T & string): T[] {
  const seen = new Set();

  return value.filter((item) => {
    const key = (item as Record<string, unknown>)[keyName];

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
