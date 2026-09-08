/**
 * Declaration-only marker used by Runtime Class member resolution.
 *
 * The marker is intentionally consumed before code generation. The generated
 * class contains only the resolved member and never branches on this value.
 */
const OVERRIDE = Symbol("jit.class.override");

export interface OverrideDescriptor<TValue = unknown> {
  readonly [OVERRIDE]: true;
  readonly value: TValue;
}

/**
 * Explicit-this fallback for function expressions. Automatic contextual `this`
 * cannot flow backwards through the generic `.extends()` call, while method
 * shorthand does receive the prefix surface from `ThisType`.
 */
export function override<TThis extends object, TResult = unknown>(
  value: (this: TThis, ...args: never[]) => TResult
): OverrideDescriptor<(this: TThis, ...args: never[]) => TResult>;
export function override<TValue>(value: TValue): OverrideDescriptor<TValue>;
export function override<TValue>(value: TValue): OverrideDescriptor<TValue> {
  return Object.freeze({
    [OVERRIDE]: true as const,
    value,
  });
}

export function isOverrideDescriptor(value: unknown): value is OverrideDescriptor {
  return typeof value === "object" && value !== null && (value as Partial<OverrideDescriptor>)[OVERRIDE] === true;
}
