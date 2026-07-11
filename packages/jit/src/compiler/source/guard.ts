import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { emitStaticDefaultSource } from "../defaults.js";
import { resolveWrappers } from "../resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./access.js";
import { emitLiteral } from "./literal.js";

type GuardSchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };

export function emitSchemaGuard(schema: ATS.AnyTypeSchema, value: string): string {
  const resolved = resolveWrappers(schema);
  const base = resolved.base as GuardSchema;
  const inner = emitBaseGuard(base, value);
  const defaultable = emitStaticDefaultSource(schema) !== undefined;

  if (resolved.optional && resolved.nullable) return `(${value} == null || (${inner}))`;
  if (resolved.optional) return `(${value} === undefined || (${inner}))`;
  if (resolved.nullable) {
    return defaultable
      ? `(${value} === undefined || ${value} === null || (${inner}))`
      : `(${value} === null || (${inner}))`;
  }
  if (defaultable) return `(${value} === undefined || (${inner}))`;

  return inner;
}

function emitBaseGuard(schema: GuardSchema, value: string): string {
  switch (schema.type) {
    case TypeName.any:
    case TypeName.unknown:
      return "true";
    case TypeName.never:
      return "false";
    case TypeName.void:
    case TypeName.undefined:
      return `${value} === undefined`;
    case TypeName.null:
      return `${value} === null`;
    case TypeName.string:
      return `typeof ${value} === "string"`;
    case TypeName.number:
    case TypeName.int:
    case TypeName.nan:
      return `typeof ${value} === "number"`;
    case TypeName.boolean:
      return `typeof ${value} === "boolean"`;
    case TypeName.bigint:
      return `typeof ${value} === "bigint"`;
    case TypeName.symbol:
      return `typeof ${value} === "symbol"`;
    case TypeName.date:
      return `${value} instanceof Date`;
    case TypeName.regex:
      return `${value} instanceof RegExp`;
    case TypeName.file:
      return `(typeof File !== "undefined" && ${value} instanceof File)`;
    case TypeName.json:
      return "true";
    case TypeName.custom:
      return "true";
    case TypeName.templateLiteral:
      return `typeof ${value} === "string"`;
    case TypeName.function:
      return `typeof ${value} === "function"`;
    case TypeName.temporal:
      return emitTemporalGuard(schema, value);
    case TypeName.codec:
      return emitSchemaGuard(schema.def.input as ATS.AnyTypeSchema, value);
    case TypeName.literal:
      return emitLiteralGuard(schema, value);
    case TypeName.enum:
      return emitEnumGuard(schema, value);
    case TypeName.array:
      return `Array.isArray(${value})`;
    case TypeName.set:
      return `${value} instanceof Set`;
    case TypeName.map:
      return `${value} instanceof Map`;
    case TypeName.record:
      return `${value} !== null && typeof ${value} === "object" && !Array.isArray(${value})`;
    case TypeName.object:
      return emitObjectGuard(schema, value);
    case TypeName.tuple:
      return `Array.isArray(${value})`;
    case TypeName.union:
      return `(${(schema.def.options as ATS.AnyTypeSchema[]).map((option) => emitSchemaGuard(option, value)).join(" || ")})`;
    case TypeName.xor:
      return emitXorGuard(schema, value);
    case TypeName.not:
      return `!(${emitSchemaGuard(schema.def.innerType as ATS.AnyTypeSchema, value)})`;
    case TypeName.when:
      return `((${emitSchemaGuard(schema.def.thenType as ATS.AnyTypeSchema, value)}) || (${emitSchemaGuard(schema.def.otherwiseType as ATS.AnyTypeSchema, value)}))`;
    case TypeName.discriminatedUnion:
      return emitDiscriminatedUnionGuard(schema, value);
    case TypeName.intersection:
      return `(${(schema.def.options as ATS.AnyTypeSchema[]).map((option) => emitSchemaGuard(option, value)).join(" && ")})`;
    case TypeName.instanceof:
      return emitInstanceOfGuard(schema, value);
    default:
      return "true";
  }
}

function emitXorGuard(schema: GuardSchema, value: string): string {
  const tests = (schema.def.options as ATS.AnyTypeSchema[]).map((option) => emitSchemaGuard(option, value));

  if (tests.length === 0) return "false";

  return `(${tests.map((test) => `((${test}) ? 1 : 0)`).join(" + ")} === 1)`;
}

function emitObjectGuard(schema: GuardSchema, value: string): string {
  const props = (schema as ATS.ObjectSchema<ATS.SchemaShape>).def.props;
  const checks = Object.entries(props).map(([key, prop]) => emitSchemaGuard(prop, emitPropertyAccess(value, key)));
  const objectCheck = `${value} !== null && typeof ${value} === "object" && !Array.isArray(${value})`;

  return checks.length === 0 ? objectCheck : `(${objectCheck} && ${checks.join(" && ")})`;
}

function emitLiteralGuard(schema: GuardSchema, value: string): string {
  const literal = schema.def.value;

  if (typeof literal === "number") {
    return `${value} === ${emitLiteral(literal)} || (${value} !== ${value} && ${emitLiteral(literal)} !== ${emitLiteral(literal)})`;
  }

  return `${value} === ${emitLiteral(literal as never)}`;
}

function emitEnumGuard(schema: GuardSchema, value: string): string {
  const values = Object.values(schema.def.values as Record<string, string | number>);

  if (values.length === 0) return "false";

  return `(${values.map((enumValue) => `${value} === ${emitLiteral(enumValue)}`).join(" || ")})`;
}

function emitDiscriminatedUnionGuard(schema: GuardSchema, value: string): string {
  const discriminator = schema.def.discriminator as string;
  const tags = (schema.def.options as ATS.AnyTypeSchema[]).map((option) => {
    const tag = literalDiscriminatorValue(option, discriminator);

    return tag === undefined ? undefined : `${emitPropertyAccess(value, discriminator)} === ${emitLiteral(tag)}`;
  });
  const filtered = tags.filter((tag): tag is string => tag !== undefined);

  return filtered.length === 0 ? "false" : `(${filtered.join(" || ")})`;
}

function emitInstanceOfGuard(schema: GuardSchema, value: string): string {
  const name = (schema.def.ctor as { readonly name?: string }).name;

  if (!name) return `${value} !== null && typeof ${value} === "object"`;

  return `(typeof ${name} !== "undefined" && ${value} instanceof ${name})`;
}

function emitTemporalGuard(schema: GuardSchema, value: string): string {
  const ctor = temporalConstructorName(schema.def.kind as ATS.TemporalKind);

  return `(globalThis.Temporal !== undefined && ${value} instanceof globalThis.Temporal.${ctor})`;
}

function temporalConstructorName(kind: ATS.TemporalKind): string {
  switch (kind) {
    case "instant":
      return "Instant";
    case "plainDate":
      return "PlainDate";
    case "plainTime":
      return "PlainTime";
    case "plainDateTime":
      return "PlainDateTime";
    case "zonedDateTime":
      return "ZonedDateTime";
    case "plainYearMonth":
      return "PlainYearMonth";
    case "plainMonthDay":
      return "PlainMonthDay";
    case "duration":
      return "Duration";
  }
}

export function literalDiscriminatorValue(
  schema: ATS.AnyTypeSchema,
  discriminator: string
): string | number | undefined {
  const resolved = resolveWrappers(schema).base;

  if (resolved.type !== TypeName.object) return undefined;

  const props = (resolved as ATS.ObjectSchema<ATS.SchemaShape>).def.props;
  const prop = props[discriminator];
  const propBase = prop ? resolveWrappers(prop).base : undefined;

  if (propBase?.type !== TypeName.literal) return undefined;

  const value = (propBase as ATS.LiteralSchema).def.value;

  return typeof value === "string" || typeof value === "number" ? value : undefined;
}
