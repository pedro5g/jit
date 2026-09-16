/** Returns the stable 32-bit hash representation used for a number. */
export function hashNumber(value: number): number {
  return value | 0;
}

/** Computes the deterministic UTF-16 hash used for string values. */
export function hashString(value: string): number {
  let hash = 0;

  for (let i = 0, len = value.length; i < len; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }

  return hash;
}

/** Returns the canonical hash value for a boolean. */
export function hashBoolean(value: boolean): number {
  return value ? 1 : 0;
}

/** Returns the low 32 bits of a bigint as a signed hash value. */
export function hashBigInt(value: bigint): number {
  return Number(value & 0xffff_ffffn) | 0;
}

/** Computes the runtime hash category used for an unknown value. */
export function hashUnknown(value: unknown): number {
  switch (typeof value) {
    case "string":
      return hashString(value);
    case "number":
      return hashNumber(value);
    case "boolean":
      return hashBoolean(value);
    case "bigint":
      return hashBigInt(value);
    case "undefined":
      return 0;
    case "symbol":
      return hashString(String(value));
    case "object":
      return value === null ? 1 : hashString(Object.prototype.toString.call(value));
    case "function":
      return hashString("function");
  }
}
