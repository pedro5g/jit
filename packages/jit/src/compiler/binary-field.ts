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

export function describeField(
  key: string,
  schema: ATS.AnyTypeSchema,
  adaptiveStringFields?: ReadonlySet<string>
): BinaryFieldDescriptor {
  switch (schema.type) {
    case TypeName.number:
    case TypeName.nan:
      return numberField(schema);
    case TypeName.int:
      return { kind: "int32", size: 4 };
    case TypeName.boolean:
      return { kind: "boolean", size: 1 };
    case TypeName.bigint:
      return { kind: "bigint", size: 8 };
    case TypeName.date:
      return { kind: "date", size: 8 };
    case TypeName.string:
      return { kind: "string", size: 4, dictionary: adaptiveStringFields?.has(key) ? "adaptive" : "dynamic" };
    case TypeName.enum: {
      const values = Object.values((schema as ATS.EnumSchema).def.values) as ScalarDictionaryValue[];
      return { kind: "enum", size: values.length <= 255 ? 1 : 4, dictionary: "fixed", values };
    }
    case TypeName.literal:
      return { kind: "literal", size: 0, literal: (schema as ATS.LiteralSchema).def.value };
    case TypeName.null:
      return { kind: "null", size: 0 };
    case TypeName.undefined:
      return { kind: "undefined", size: 0 };
    case TypeName.union:
    case TypeName.xor: {
      const values = literalUnionValues(schema);
      if (values) return { kind: "literalUnion", size: values.length <= 255 ? 1 : 4, dictionary: "fixed", values };
      break;
    }
  }
  throw new JITError(
    "UNSUPPORTED_SCHEMA",
    `binary rowset does not support field ${JSON.stringify(key)} (${schema.type}); use flat scalar object fields in v1`
  );
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
