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
  // A self-referencing schema would expand forever. The root is expanded
  // directly below, so any later encounter of a schema still being expanded is
  // a back-edge: it emits that schema's name, which is what makes
  // `export type Node = { children: Node[] }` come out valid. Without a name
  // there is nothing to refer to, so the edge degrades to `unknown`.
  const expanding = new Set<ATS.AnyTypeSchema>();

  const emit: EmitChild = (child) => {
    const named = names?.get(child);

    if (named !== undefined) return named;
    if (expanding.has(child)) return "unknown";

    expanding.add(child);
    const emitted = emitStructural(child, emit);

    expanding.delete(child);
    return emitted;
  };

  expanding.add(schema);
  const emitted = emitStructural(schema, emit);

  expanding.delete(schema);
  return emitted;
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
    case TypeName.runtimeType: {
      const value = emit(current.def.innerType as ATS.AnyTypeSchema);
      return current.def.representation === "value"
        ? `{ readonly value: ${value}; equals(other: unknown): boolean; hashCode(): number }`
        : value;
    }
    default:
      return "unknown";
  }
}

/** Emits the external create/hydrate representation instead of the materialized Runtime Type. */
export function emitBoundaryType(
  schema: ATS.AnyTypeSchema,
  mode: "create" | "hydrate",
  names?: ReadonlyMap<ATS.AnyTypeSchema, string>
): string {
  const emit = (current: ATS.AnyTypeSchema): string => {
    const node = current as AnySchema;
    if (node.type === TypeName.runtimeType) return emit(node.def.innerType as ATS.AnyTypeSchema);
    if (node.type === TypeName.object) {
      const props = node.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;
      const entries = Object.keys(props).map((key) => {
        const property = props[key];
        const safeKey = Parse.isValidIdentifier(key) ? key : JSON.stringify(key);
        const optional = mode === "create" && acceptsMissingBoundary(property) ? "?" : "";
        return `${safeKey}${optional}: ${emit(property)}`;
      });
      return entries.length === 0 ? "{}" : `{ ${entries.join("; ")} }`;
    }
    if (node.type === TypeName.array) return `${wrapForSuffix(emit(node.def.element as ATS.AnyTypeSchema))}[]`;
    if (node.type === TypeName.optional) return `${emit(node.def.innerType as ATS.AnyTypeSchema)} | undefined`;
    if (node.type === TypeName.nullable) return `${emit(node.def.innerType as ATS.AnyTypeSchema)} | null`;
    if (node.type === TypeName.nullish) return `${emit(node.def.innerType as ATS.AnyTypeSchema)} | null | undefined`;
    if (
      node.type === TypeName.default ||
      node.type === TypeName.brand ||
      node.type === TypeName.readonly ||
      node.type === TypeName.refine ||
      node.type === TypeName.coerce ||
      node.type === TypeName.pipe ||
      node.type === TypeName.transform
    ) {
      return emit(node.def.innerType as ATS.AnyTypeSchema);
    }
    if (node.type === TypeName.lazy) return emit((node.def.getter as () => ATS.AnyTypeSchema)());
    return emitTypeScriptType(current, names);
  };
  return emit(schema);
}

export function acceptsMissingBoundary(schema: ATS.AnyTypeSchema): boolean {
  const node = schema as AnySchema;
  if (node.type === TypeName.optional || node.type === TypeName.nullish || node.type === TypeName.default) return true;
  if (
    node.type === TypeName.runtimeType ||
    node.type === TypeName.brand ||
    node.type === TypeName.readonly ||
    node.type === TypeName.refine ||
    node.type === TypeName.coerce ||
    node.type === TypeName.pipe ||
    node.type === TypeName.transform
  ) {
    return acceptsMissingBoundary(node.def.innerType as ATS.AnyTypeSchema);
  }
  return false;
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
