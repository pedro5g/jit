export function hashNumber(value: number): number {
  return value | 0;
}

export function hashString(value: string): number {
  let hash = 0;

  for (let i = 0, len = value.length; i < len; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }

  return hash;
}

export function hashBoolean(value: boolean): number {
  return value ? 1 : 0;
}

export function hashBigInt(value: bigint): number {
  return Number(value & 0xffff_ffffn) | 0;
}

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
