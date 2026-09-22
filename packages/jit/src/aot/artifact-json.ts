/** Produces canonical JSON for hashes and deterministic artifact sidecars. */
export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "function") return `[Function ${(value as Function).name || "anonymous"}]`;
    return value;
  }
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  try {
    if (Array.isArray(value)) return value.map((item) => canonicalValue(item, seen));
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalValue(record[key], seen)])
    );
  } finally {
    seen.delete(value);
  }
}
