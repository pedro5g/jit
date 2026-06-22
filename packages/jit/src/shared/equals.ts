import type { Equal } from "./index.js";
import { Utils } from "./index.js";

/** @private */
export const SameType = ((l, r) =>
  (l === undefined && r === undefined) ||
  (typeof l === "boolean" && typeof r === "boolean") ||
  (typeof l === "number" && typeof r === "number") ||
  (typeof l === "string" && typeof r === "string") ||
  (typeof l === "object" && typeof r === "object") ||
  (typeof l === "bigint" && typeof r === "bigint") ||
  (typeof l === "symbol" && typeof r === "symbol")) satisfies Equal<unknown>;

/** @private */
export const IsStrictEqual = <T>(l: T, r: T): boolean => l === r;

/** @private */
export const SameNumber = ((l, r) =>
  Utils.Object_is(l, r) || (typeof l === "number" && typeof r === "number")
    ? l === 0 && r === 0
      ? 1 / l === 1 / r
      : Number.isNaN(l as number)
        ? Number.isNaN(r as number)
        : l === r
    : false) satisfies Equal<number>;

export const SameValue: <T>(l: T, r: T) => boolean = globalThis.Object.is;

type T = null | undefined | symbol | boolean | number | bigint | string | readonly unknown[] | { [x: string]: unknown };

export { deepEquals as deep };

/** @private  */
export function deepEquals<T>(x: T, y: T): boolean;
export function deepEquals(x: T, y: T): boolean;
export function deepEquals(x: T, y: T): boolean {
  if (Utils.Object_is(x, y)) return true;
  let len: number | undefined;
  let ix: number | undefined;
  let ks: string[];

  if (Utils.Is_Array(x)) {
    if (!Utils.Is_Array(y)) return false;
    void (len = x.length);
    if (len !== y.length) return false;
    for (ix = len; ix-- !== 0; ) {
      if (!deepEquals(x[ix], y[ix])) {
        return false;
      }
    }
    return true;
  }

  if (x && y && typeof x === "object" && typeof y === "object") {
    if (Utils.Is_Array(y)) return false;
    const yks = Utils.Object_keys(y);
    void (ks = Utils.Object_keys(x));
    void (len = ks.length);
    if (len !== yks.length) return false;
    for (ix = len; ix-- !== 0; ) {
      const k = ks[ix]!;
      if (!yks.includes(k)) return false;
      if (!deepEquals(x[k], y[k])) return false;
    }
    return true;
  }
  return false;
}

export { laxEquals as lax };

/** @private  */
export function laxEquals<T>(x: T, y: T): boolean;
export function laxEquals(x: T, y: T): boolean;
export function laxEquals(x: T, y: T): boolean {
  if (x === y) return true;
  let len: number | undefined;
  let ix: number | undefined;
  let ks: string[];

  if (Utils.Is_Array(x)) {
    if (!Utils.Is_Array(y)) return false;
    void (len = x.length);
    if (len !== y.length) return false;
    for (ix = len; ix-- !== 0; ) if (!deepEquals(x[ix], y[ix])) return false;
    return true;
  }

  if (x && y && typeof x === "object" && typeof y === "object") {
    if (Utils.Is_Array(y)) return false;
    const yks = Utils.Object_keys(y).filter((k) => y[k] !== void 0);
    void (ks = Utils.Object_keys(x).filter((k) => x[k] !== void 0));
    void (len = ks.length);
    if (len !== yks.length) return false;
    for (ix = len; ix-- !== 0; ) {
      const k = ks[ix];
      if (!yks.includes(k)) return false;
      if (!deepEquals(x[k], y[k])) return false;
    }
    return true;
  }
  return false;
}
