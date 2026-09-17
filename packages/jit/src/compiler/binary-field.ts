import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import type { BinaryFieldKind } from "./binary-rowset.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";

type ScalarDictionaryValue = string | number;

export interface BinaryFieldDescriptor {
  readonly kind: BinaryFieldKind;
  readonly size: number;
  readonly dictionary?: "dynamic" | "adaptive" | "fixed";
  readonly values?: readonly ScalarDictionaryValue[];
  readonly literal?: unknown;
}

type FieldDescriber = (
  key: string,
  schema: ATS.AnyTypeSchema,
  adaptiveStringFields?: ReadonlySet<string>
) => BinaryFieldDescriptor | undefined;

const FIELD_DESCRIBERS: Readonly<Record<string, FieldDescriber>> = {
  [TypeName.number]: (_key, schema) => numberField(schema),
  [TypeName.nan]: (_key, schema) => numberField(schema),
  [TypeName.int]: () => ({ kind: "int32", size: 4 }),
  [TypeName.boolean]: () => ({ kind: "boolean", size: 1 }),
  [TypeName.bigint]: () => ({ kind: "bigint", size: 8 }),
  [TypeName.date]: () => ({ kind: "date", size: 8 }),
  [TypeName.string]: (key, _schema, adaptiveStringFields) => ({
    kind: "string",
    size: 4,
    dictionary: adaptiveStringFields?.has(key) ? "adaptive" : "dynamic",
  }),
  [TypeName.enum]: (_key, schema) => {
    const values = Object.values((schema as ATS.EnumSchema).def.values) as ScalarDictionaryValue[];
    return { kind: "enum", size: values.length <= 255 ? 1 : 4, dictionary: "fixed", values };
  },
  [TypeName.literal]: (_key, schema) => ({
    kind: "literal",
    size: 0,
    literal: (schema as ATS.LiteralSchema).def.value,
  }),
  [TypeName.null]: () => ({ kind: "null", size: 0 }),
  [TypeName.undefined]: () => ({ kind: "undefined", size: 0 }),
  [TypeName.union]: (_key, schema) => literalUnionField(schema),
  [TypeName.xor]: (_key, schema) => literalUnionField(schema),
};

export function describeField(
  key: string,
  schema: ATS.AnyTypeSchema,
  adaptiveStringFields?: ReadonlySet<string>
): BinaryFieldDescriptor {
  const descriptor = FIELD_DESCRIBERS[schema.type]?.(key, schema, adaptiveStringFields);
  if (descriptor !== undefined) return descriptor;
  throw new JITError(
    "UNSUPPORTED_SCHEMA",
    `binary rowset does not support field ${JSON.stringify(key)} (${schema.type}); use flat scalar object fields in v1`
  );
}

function literalUnionField(schema: ATS.AnyTypeSchema): BinaryFieldDescriptor | undefined {
  const values = literalUnionValues(schema);
  return values === undefined
    ? undefined
    : { kind: "literalUnion", size: values.length <= 255 ? 1 : 4, dictionary: "fixed", values };
}

function numberField(schema: ATS.AnyTypeSchema): { readonly kind: BinaryFieldKind; readonly size: number } {
  const checks = ((schema.def as { readonly checks?: readonly ATS.SchemaCheck[] }).checks ?? []).map(
    (check) => check.kind
  );
  if (checks.includes("int32")) return { kind: "int32", size: 4 };
  if (checks.includes("float32")) return { kind: "float32", size: 4 };
  return { kind: "float64", size: 8 };
}

function literalUnionValues(schema: ATS.AnyTypeSchema): readonly ScalarDictionaryValue[] | undefined {
  const values: ScalarDictionaryValue[] = [];
  const options = (schema.def as ATS.OptionsDef).options;

  for (const option of options) {
    const resolved = resolveWrappers(option).base;
    if (resolved.type !== TypeName.literal) return undefined;
    const value = (resolved as ATS.LiteralSchema).def.value;
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    values[values.length] = value;
  }
  return values;
}
