import {
  type AnyTypeSchema,
  createSchema,
  type EnumSchema,
  type EnumValuesInput,
  type InstanceOfSchema,
  type LazySchema,
  type LiteralSchema,
  TypeName,
} from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder, type SchemaInput, unwrapSchema } from "../../core/builder/index.js";

/**
 * Creates a literal schema builder.
 *
 * @template TValue - The literal value type.
 * @param value - The literal runtime value.
 * @returns A builder wrapping a literal schema.
 */
export function literal<const TValue>(value: TValue): Builder<LiteralSchema<TValue>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.literal, {
      value,
    })
  );
}

/**
 * Creates an enum schema builder from a native enum-like object.
 *
 * @template TValues - The enum object type.
 * @param values - An object whose values are strings or numbers.
 * @returns A builder wrapping an enum schema.
 */
function nativeEnum<const TValues extends EnumValuesInput>(values: TValues): Builder<EnumSchema<TValues>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.enum, {
      values,
    })
  );
}

export { nativeEnum as enum };

/**
 * Creates a lazy schema builder.
 *
 * @template TSchema - The schema returned by the lazy getter.
 * @param getter - A callback that returns the schema or builder when resolved.
 * @returns A builder wrapping a lazy schema.
 */
export function lazy<TSchema extends AnyTypeSchema>(getter: () => SchemaInput<TSchema>): Builder<LazySchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.lazy, {
      getter: () => unwrapSchema(getter()),
    })
  );
}

/**
 * Creates an instanceof schema builder.
 *
 * @template TCtor - The constructor used for runtime instanceof checks.
 * @param ctor - The constructor accepted by the schema.
 * @returns A builder wrapping an instanceof schema.
 */
export function instanceOf<TCtor extends abstract new (...args: any[]) => unknown>(
  ctor: TCtor
): Builder<InstanceOfSchema<TCtor>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.instanceof, {
      ctor,
    })
  );
}
