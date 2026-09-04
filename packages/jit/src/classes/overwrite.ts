/**
 * Declaration-only marker used by Runtime Class extensions.
 *
 * The marker is consumed while a class definition is resolved. It is never
 * copied to an instance or inspected by generated methods.
 */
const OVERWRITE = Symbol("jit.class.overwrite");

export interface OverwriteDescriptor<TValue = unknown> {
  readonly [OVERWRITE]: true;
  readonly value: TValue;
}

export function overwrite<TValue>(value: TValue): OverwriteDescriptor<TValue> {
  return Object.freeze({
    [OVERWRITE]: true as const,
    value,
  });
}

export function isOverwriteDescriptor(value: unknown): value is OverwriteDescriptor {
  return typeof value === "object" && value !== null && (value as Partial<OverwriteDescriptor>)[OVERWRITE] === true;
}
