import type { SchemaAnnotations } from "./schema-annotation.js";
import type { AnyTypeName } from "./type-name.js";
import type { BaseSchema } from "./type-schema.js";

export function createSchema<TOutput, TName extends AnyTypeName, TDef>(
  type: TName,
  def: Readonly<TDef>,
  annotations?: unknown
): BaseSchema<TOutput, TName, TDef> {
  return {
    type,
    _type: null as unknown as TOutput,
    def,
    annotations: annotations as SchemaAnnotations<TOutput> | undefined,
  };
}
