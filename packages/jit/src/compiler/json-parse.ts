import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";

type AnySchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };

/**
 * Returns the native parser after priming V8's object-map transitions with a
 * canonical value for the schema. This only affects runtime JIT compilation;
 * AOT output remains side-effect free and warms naturally under application
 * traffic.
 */
export function compileJsonParse(schema: ATS.AnyTypeSchema): (json: string) => unknown {
  warmJsonParseShape(schema);
  return JSON.parse;
}

/** Performs bounded, best-effort shape warm-up without invoking validation callbacks. */
export function warmJsonParseShape(schema: ATS.AnyTypeSchema): boolean {
  const sample = jsonWarmupSample(schema);

  if (sample === undefined) return false;
  JSON.parse(sample);
  JSON.parse(sample);
  return true;
}

/** Emits a compact JSON sample whose object keys follow schema declaration order. */
export function jsonWarmupSample(schema: ATS.AnyTypeSchema): string | undefined {
  const value = emitWarmupValue(schema, new Set(), 0);

  if (value === undefined) return undefined;
  if (rootIsArray(schema)) {
    const element = rootArrayElement(schema);
    const item = element ? emitWarmupValue(element, new Set(), 1) : undefined;

    if (item !== undefined) return `[${item},${item}]`;
  }
  return value;
}

function emitWarmupValue(schema: ATS.AnyTypeSchema, seen: Set<ATS.AnyTypeSchema>, depth: number): string | undefined {
  if (depth > 12 || seen.has(schema)) return "null";
  seen.add(schema);
  const current = schema as AnySchema;
  let output: string | undefined;

  switch (current.type) {
    case TypeName.string:
      output = '""';
      break;
    case TypeName.number:
    case TypeName.int:
    case TypeName.bigint:
    case TypeName.nan:
      output = "0";
      break;
    case TypeName.boolean:
      output = "false";
      break;
    case TypeName.null:
    case TypeName.undefined:
    case TypeName.void:
    case TypeName.never:
    case TypeName.unknown:
    case TypeName.any:
    case TypeName.json:
      output = "null";
      break;
    case TypeName.literal:
      output = jsonPrimitive(current.def.value);
      break;
    case TypeName.enum: {
      const values = Object.values(current.def.values as Record<string, unknown>);

      output = values.map(jsonPrimitive).find((value) => value !== undefined) ?? "null";
      break;
    }
    case TypeName.array: {
      const item = emitWarmupValue(current.def.element as ATS.AnyTypeSchema, seen, depth + 1);

      output = item === undefined ? "[]" : `[${item},${item}]`;
      break;
    }
    case TypeName.tuple: {
      const items = (current.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];

      output = `[${items.map((item) => emitWarmupValue(item, seen, depth + 1) ?? "null").join(",")}]`;
      break;
    }
    case TypeName.object: {
      const props = current.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;
      const entries = Object.keys(props).map((key) => {
        const value = emitWarmupValue(props[key], seen, depth + 1) ?? "null";

        return `${JSON.stringify(key)}:${value}`;
      });

      output = `{${entries.join(",")}}`;
      break;
    }
    case TypeName.record:
    case TypeName.map:
      output = "{}";
      break;
    case TypeName.set:
      output = "[]";
      break;
    case TypeName.union:
    case TypeName.xor:
    case TypeName.discriminatedUnion:
    case TypeName.intersection: {
      const options = (current.def.options as readonly ATS.AnyTypeSchema[] | undefined) ?? [];

      output = options.length === 0 ? "null" : emitWarmupValue(options[0], seen, depth + 1);
      break;
    }
    case TypeName.optional:
    case TypeName.nullable:
    case TypeName.nullish:
    case TypeName.default:
    case TypeName.brand:
    case TypeName.readonly:
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
    case TypeName.not:
      output = emitWarmupValue(current.def.innerType as ATS.AnyTypeSchema, seen, depth + 1);
      break;
    case TypeName.lazy:
      output = emitWarmupValue((current.def.getter as () => ATS.AnyTypeSchema)(), seen, depth + 1);
      break;
    case TypeName.when:
      output = emitWarmupValue(current.def.thenType as ATS.AnyTypeSchema, seen, depth + 1);
      break;
    case TypeName.codec:
      output = emitWarmupValue(current.def.input as ATS.AnyTypeSchema, seen, depth + 1);
      break;
    default:
      output = "null";
  }

  seen.delete(schema);
  return output;
}

function jsonPrimitive(value: unknown): string | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function rootIsArray(schema: ATS.AnyTypeSchema, seen = new Set<ATS.AnyTypeSchema>()): boolean {
  if (seen.has(schema)) return false;
  seen.add(schema);
  const current = schema as AnySchema;

  if (current.type === TypeName.array) return true;
  const inner = wrapperInner(current);
  return inner === undefined ? false : rootIsArray(inner, seen);
}

function rootArrayElement(
  schema: ATS.AnyTypeSchema,
  seen = new Set<ATS.AnyTypeSchema>()
): ATS.AnyTypeSchema | undefined {
  if (seen.has(schema)) return undefined;
  seen.add(schema);
  const current = schema as AnySchema;

  if (current.type === TypeName.array) return current.def.element as ATS.AnyTypeSchema;
  const inner = wrapperInner(current);
  return inner === undefined ? undefined : rootArrayElement(inner, seen);
}

function wrapperInner(schema: AnySchema): ATS.AnyTypeSchema | undefined {
  switch (schema.type) {
    case TypeName.optional:
    case TypeName.nullable:
    case TypeName.nullish:
    case TypeName.default:
    case TypeName.brand:
    case TypeName.readonly:
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
    case TypeName.not:
      return schema.def.innerType as ATS.AnyTypeSchema;
    case TypeName.lazy:
      return (schema.def.getter as () => ATS.AnyTypeSchema)();
    default:
      return undefined;
  }
}
