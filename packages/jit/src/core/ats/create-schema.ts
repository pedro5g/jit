import type { AnyTypeName } from "./type-name.js";
import type { BaseSchema } from "./type-schema.js";

export function createSchema<TOutput, TName extends AnyTypeName, TDef>(
  type: TName,
  def: Readonly<TDef>
): BaseSchema<TOutput, TName, TDef> {
  return {
    type,
    _type: null as unknown as TOutput,
    def,
    annotations: undefined,
  };
}
