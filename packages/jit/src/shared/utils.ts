/** @private */
export const Object_keys = globalThis.Object.keys;

/** @private */
export const Object_hasOwn: <K extends keyof any>(x: unknown, k: K) => x is { [P in K]: unknown } = (
  x,
  k
): x is never =>
  !!x && (typeof x === "object" || typeof x === "function") && globalThis.Object.prototype.hasOwnProperty.call(x, k);

/** @private */
export const Object_is = globalThis.Object.is;

/** @private */
export const Is_Array: (u: unknown) => u is readonly unknown[] = globalThis.Array.isArray;
