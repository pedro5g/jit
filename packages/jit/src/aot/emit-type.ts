import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { Parse } from "../shared/index.js";

type AnySchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };

/**
 * Emits the TypeScript type literal for a schema — powers the generated
 * `.d.ts` files. Unknown or unrepresentable kinds degrade to `unknown`.
 */
export function emitTypeScriptType(schema: ATS.AnyTypeSchema): string {
  const current = schema as AnySchema;

  switch (current.type) {
    case TypeName.string:
      return "string";
    case TypeName.number:
    case TypeName.int:
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
        const prop = props[key] as AnySchema;
        const optional = isOptional(prop);
        const safeKey = Parse.isValidIdentifier(key) ? key : JSON.stringify(key);

        return `readonly ${safeKey}${optional ? "?" : ""}: ${emitTypeScriptType(prop)}`;
      });

      return entries.length === 0 ? "{}" : `{ ${entries.join("; ")} }`;
    }
    case TypeName.array:
      return `${wrapForSuffix(emitTypeScriptType(current.def.element as ATS.AnyTypeSchema))}[]`;
    case TypeName.set:
      return `Set<${emitTypeScriptType(current.def.element as ATS.AnyTypeSchema)}>`;
    case TypeName.map:
      return `Map<${emitTypeScriptType(current.def.key as ATS.AnyTypeSchema)}, ${emitTypeScriptType(current.def.value as ATS.AnyTypeSchema)}>`;
    case TypeName.record:
      return `Record<string, ${emitTypeScriptType(current.def.value as ATS.AnyTypeSchema)}>`;
    case TypeName.tuple: {
      const items = (current.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];

      return `[${items.map(emitTypeScriptType).join(", ")}]`;
    }
    case TypeName.union:
    case TypeName.discriminatedUnion: {
      const options = current.def.options as readonly ATS.AnyTypeSchema[];

      return options.map(emitTypeScriptType).join(" | ");
    }
    case TypeName.intersection: {
      const options = current.def.options as readonly ATS.AnyTypeSchema[];

      return options.map(emitTypeScriptType).join(" & ");
    }
    case TypeName.optional:
      return `${emitTypeScriptType(current.def.innerType as ATS.AnyTypeSchema)} | undefined`;
    case TypeName.nullable:
      return `${emitTypeScriptType(current.def.innerType as ATS.AnyTypeSchema)} | null`;
    case TypeName.nullish:
      return `${emitTypeScriptType(current.def.innerType as ATS.AnyTypeSchema)} | null | undefined`;
    case TypeName.default:
    case TypeName.brand:
    case TypeName.readonly:
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
      return emitTypeScriptType(current.def.innerType as ATS.AnyTypeSchema);
    case TypeName.lazy:
      return emitTypeScriptType((current.def.getter as () => ATS.AnyTypeSchema)());
    case TypeName.promise:
      return `Promise<${emitTypeScriptType(current.def.innerType as ATS.AnyTypeSchema)}>`;
    default:
      return "unknown";
  }
}

function isOptional(schema: AnySchema): boolean {
  // Defaults make the field omittable on input.
  if (schema.type === TypeName.optional || schema.type === TypeName.nullish || schema.type === TypeName.default) {
    return true;
  }
  if (
    schema.type === TypeName.brand ||
    schema.type === TypeName.readonly ||
    schema.type === TypeName.refine ||
    schema.type === TypeName.coerce ||
    schema.type === TypeName.pipe ||
    schema.type === TypeName.transform ||
    schema.type === TypeName.nullable
  ) {
    return isOptional(schema.def.innerType as AnySchema);
  }

  return false;
}

function wrapForSuffix(type: string): string {
  if (type.includes("|") || type.includes("&")) return `(${type})`;

  return type;
}
