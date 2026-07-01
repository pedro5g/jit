import {
  type AnyTypeSchema,
  createSchema,
  type EnumSchema,
  type InstanceOfSchema,
  type LazySchema,
  type LiteralSchema,
  TypeName,
} from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder, type SchemaInput, unwrapSchema } from "../../core/builder/index.js";

export function literal<const TValue>(value: TValue): Builder<LiteralSchema<TValue>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.literal, {
      value,
    })
  );
}

function nativeEnum<const TValues extends Readonly<Record<string, string | number>>>(
  values: TValues
): Builder<EnumSchema<TValues>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.enum, {
      values,
    })
  );
}

export { nativeEnum as enum };

export function lazy<TSchema extends AnyTypeSchema>(getter: () => SchemaInput<TSchema>): Builder<LazySchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.lazy, {
      getter: () => unwrapSchema(getter()),
    })
  );
}

export function instanceOf<TCtor extends abstract new (...args: any[]) => unknown>(
  ctor: TCtor
): Builder<InstanceOfSchema<TCtor>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.instanceof, {
      ctor,
    })
  );
}
