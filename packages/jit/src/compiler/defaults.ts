import { type AnyTypeSchema, TypeName } from "../core/ats/index.js";
import { arrayLiteral, construct, type IRExpr, type IRLiteralValue, literal, objectLiteral } from "./ir/ir.js";
import { emitLiteral, emitObjectKey } from "./source/literal.js";

type WrappedSchema = AnyTypeSchema & {
  readonly def: {
    readonly innerType?: AnyTypeSchema;
    readonly defaultValue?: unknown;
    readonly getter?: () => AnyTypeSchema;
  };
};

const NO_DEFAULT = Symbol("jit.no-static-default");

/**
 * Returns a source expression for a static `.default(value)` when it is safe
 * to embed in generated code. Lazy defaults are deliberately ignored here:
 * equal/hash/diff/clone/stringify must stay side-effect-free.
 */
export function emitStaticDefaultSource(schema: AnyTypeSchema): string | undefined {
  const value = getStaticDefaultValue(schema);

  if (value === NO_DEFAULT) return undefined;
  return emitStaticDefaultValueSource(value, new Set());
}

export function staticDefaultIRExpr(schema: AnyTypeSchema): IRExpr | undefined {
  const value = getStaticDefaultValue(schema);

  if (value === NO_DEFAULT) return undefined;
  return staticValueIRExpr(value, new Set());
}

export function emitDefaultedValue(schema: AnyTypeSchema, valueExpr: string): string {
  const defaultSource = emitStaticDefaultSource(schema);

  return defaultSource === undefined ? valueExpr : `(${valueExpr} === undefined ? ${defaultSource} : ${valueExpr})`;
}

function getStaticDefaultValue(schema: AnyTypeSchema): unknown | typeof NO_DEFAULT {
  let current = schema as WrappedSchema;

  while (true) {
    switch (current.type) {
      case TypeName.default: {
        const value = current.def.defaultValue;

        return typeof value === "function" ? NO_DEFAULT : value;
      }
      case TypeName.optional:
      case TypeName.nullish:
        return NO_DEFAULT;
      case TypeName.nullable:
      case TypeName.brand:
      case TypeName.readonly:
      case TypeName.refine:
      case TypeName.coerce:
      case TypeName.pipe:
      case TypeName.transform:
        current = current.def.innerType as WrappedSchema;
        continue;
      case TypeName.lazy:
        current = current.def.getter?.() as WrappedSchema;
        continue;
      default:
        return NO_DEFAULT;
    }
  }
}

function emitStaticDefaultValueSource(value: unknown, seen: Set<object>): string | undefined {
  if (value instanceof Date) return `new Date(${value.getTime()})`;
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
    case "number":
    case "bigint":
    case "boolean":
    case "undefined":
      return emitLiteral(value as IRLiteralValue);
    case "object":
      return emitStaticObjectDefaultSource(value, seen);
    default:
      return undefined;
  }
}

function staticValueIRExpr(value: unknown, seen: Set<object>): IRExpr | undefined {
  if (value instanceof Date) return construct("Date", [literal(value.getTime())]);
  if (value === null) return literal(null);

  switch (typeof value) {
    case "string":
    case "number":
    case "bigint":
    case "boolean":
    case "undefined":
      return literal(value as IRLiteralValue);
    case "object":
      return staticObjectDefaultIRExpr(value, seen);
    default:
      return undefined;
  }
}

function emitStaticObjectDefaultSource(value: object, seen: Set<object>): string | undefined {
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    const elements = value.map((element) => emitStaticDefaultValueSource(element, seen));

    seen.delete(value);
    return elements.every((element): element is string => element !== undefined)
      ? `[${elements.join(", ")}]`
      : undefined;
  }

  if (!isPlainObject(value)) {
    seen.delete(value);
    return undefined;
  }

  const entries: string[] = [];

  for (const key of Object.keys(value)) {
    const emitted = emitStaticDefaultValueSource((value as Record<string, unknown>)[key], seen);

    if (emitted === undefined) {
      seen.delete(value);
      return undefined;
    }

    entries.push(`${emitObjectKey(key)}: ${emitted}`);
  }

  seen.delete(value);
  return `{ ${entries.join(", ")} }`;
}

function staticObjectDefaultIRExpr(value: object, seen: Set<object>): IRExpr | undefined {
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    const elements = value.map((element) => staticValueIRExpr(element, seen));

    seen.delete(value);
    return elements.every((element): element is IRExpr => element !== undefined) ? arrayLiteral(elements) : undefined;
  }

  if (!isPlainObject(value)) {
    seen.delete(value);
    return undefined;
  }

  const entries: { key: string; value: IRExpr }[] = [];

  for (const key of Object.keys(value)) {
    const emitted = staticValueIRExpr((value as Record<string, unknown>)[key], seen);

    if (emitted === undefined) {
      seen.delete(value);
      return undefined;
    }

    entries.push({ key, value: emitted });
  }

  seen.delete(value);
  return objectLiteral(entries);
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}
