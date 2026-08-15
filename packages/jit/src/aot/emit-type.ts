import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { Parse } from "../shared/index.js";

type AnySchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };
type EmitChild = (schema: ATS.AnyTypeSchema) => string;

/**
 * Emits the TypeScript type literal for a schema — powers generated `.ts`
 * files. Unknown or unrepresentable kinds degrade to `unknown`.
 *
 * `names` maps schemas that were declared with their own binding to that
 * name, so a nested schema is emitted as `User` instead of being inlined
 * structurally a second time. The schema being emitted is always expanded,
 * which is what makes `export type User = { ... }` possible.
 */
export function emitTypeScriptType(schema: ATS.AnyTypeSchema, names?: ReadonlyMap<ATS.AnyTypeSchema, string>): string {
  const emit: EmitChild = (child) => {
    const named = names?.get(child);

    return named !== undefined && child !== schema ? named : emitStructural(child, emit);
  };

  return emitStructural(schema, emit);
}

function emitStructural(schema: ATS.AnyTypeSchema, emit: EmitChild): string {
  const current = schema as AnySchema;

  switch (current.type) {
    case TypeName.string:
      return emitOneOfType(current, "string");
    case TypeName.number:
    case TypeName.int:
      return emitOneOfType(current, "number");
    case TypeName.nan:
      return "number";
    case TypeName.boolean:
      return "boolean";
    case TypeName.bigint:
      return "bigint";
    case TypeName.symbol:
      return "symbol";
    case TypeName.date:
      return "Date";
    case TypeName.regex:
      return "RegExp";
    case TypeName.null:
      return "null";
    case TypeName.undefined:
    case TypeName.void:
      return "undefined";
    case TypeName.any:
      return "any";
    case TypeName.unknown:
      return "unknown";
    case TypeName.never:
      return "never";
    case TypeName.literal: {
      const value = current.def.value;

      return typeof value === "string" ? JSON.stringify(value) : String(value);
    }
    case TypeName.enum: {
      const values = Object.values(current.def.values as Record<string, string | number>);

      return values.map((value) => (typeof value === "string" ? JSON.stringify(value) : String(value))).join(" | ");
    }
    case TypeName.object: {
      const props = current.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;
      const entries = Object.keys(props).map((key) => {
        const prop = props[key];
        const safeKey = Parse.isValidIdentifier(key) ? key : JSON.stringify(key);

        return `${safeKey}: ${emit(prop)}`;
      });

      return entries.length === 0 ? "{}" : `{ ${entries.join("; ")} }`;
    }
    case TypeName.array:
      return `${wrapForSuffix(emit(current.def.element as ATS.AnyTypeSchema))}[]`;
    case TypeName.set:
      return `Set<${emit(current.def.element as ATS.AnyTypeSchema)}>`;
    case TypeName.map:
      return `Map<${emit(current.def.key as ATS.AnyTypeSchema)}, ${emit(current.def.value as ATS.AnyTypeSchema)}>`;
    case TypeName.record:
      return `Record<string, ${emit(current.def.value as ATS.AnyTypeSchema)}>`;
    case TypeName.tuple: {
      const items = (current.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];

      return `[${items.map(emit).join(", ")}]`;
    }
    case TypeName.union:
    case TypeName.xor:
    case TypeName.discriminatedUnion: {
      const options = current.def.options as readonly ATS.AnyTypeSchema[];

      return options.map(emit).join(" | ");
    }
    case TypeName.not:
      return "unknown";
    case TypeName.when:
      return `${emit(current.def.thenType as ATS.AnyTypeSchema)} | ${emit(current.def.otherwiseType as ATS.AnyTypeSchema)}`;
    case TypeName.intersection: {
      const options = current.def.options as readonly ATS.AnyTypeSchema[];

      return options.map(emit).join(" & ");
    }
    case TypeName.optional:
      return `${emit(current.def.innerType as ATS.AnyTypeSchema)} | undefined`;
    case TypeName.nullable:
      return `${emit(current.def.innerType as ATS.AnyTypeSchema)} | null`;
    case TypeName.nullish:
      return `${emit(current.def.innerType as ATS.AnyTypeSchema)} | null | undefined`;
    case TypeName.default:
    case TypeName.brand:
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
      return emit(current.def.innerType as ATS.AnyTypeSchema);
    case TypeName.readonly:
      return emitReadonlyType(current.def.innerType as ATS.AnyTypeSchema, emit);
    case TypeName.lazy:
      return emit((current.def.getter as () => ATS.AnyTypeSchema)());
    case TypeName.promise:
      return `Promise<${emit(current.def.innerType as ATS.AnyTypeSchema)}>`;
    default:
      return "unknown";
  }
}

function emitReadonlyType(schema: ATS.AnyTypeSchema, emit: EmitChild): string {
  const current = schema as AnySchema;

  switch (current.type) {
    case TypeName.array:
      return `readonly ${wrapForSuffix(emit(current.def.element as ATS.AnyTypeSchema))}[]`;
    case TypeName.tuple: {
      const items = (current.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];

      return `readonly [${items.map(emit).join(", ")}]`;
    }
    case TypeName.set:
      return `ReadonlySet<${emit(current.def.element as ATS.AnyTypeSchema)}>`;
    case TypeName.map:
      return `ReadonlyMap<${emit(current.def.key as ATS.AnyTypeSchema)}, ${emit(current.def.value as ATS.AnyTypeSchema)}>`;
    default:
      return `Readonly<${emit(schema)}>`;
  }
}

function emitOneOfType(schema: AnySchema, fallback: "string" | "number"): string {
  const checks =
    (schema.def.checks as readonly { readonly kind: string; readonly value?: unknown }[] | undefined) ?? [];
  const oneOf = checks.find((check) => check.kind === "oneOf");

  if (!Array.isArray(oneOf?.value) || oneOf.value.length === 0) return fallback;

  return oneOf.value.map((value) => (typeof value === "string" ? JSON.stringify(value) : String(value))).join(" | ");
}

function wrapForSuffix(type: string): string {
  if (type.includes("|") || type.includes("&")) return `(${type})`;

  return type;
}
