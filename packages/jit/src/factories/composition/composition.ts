import {
  type AnyTypeSchema,
  createSchema,
  type DiscriminatedUnionSchema,
  type IntersectionSchema,
  type NotSchema,
  TypeName,
  type UnionSchema,
  type XorSchema,
} from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder, type SchemaInput, unwrapSchema } from "../../core/builder/index.js";

/**
 * Creates a union schema builder.
 *
 * @template TOptions - The option schema inputs.
 * @param options - The schemas or builders accepted by the union.
 * @returns A builder wrapping a union schema.
 */
export function union<const TOptions extends readonly SchemaInput[]>(
  ...options: TOptions
): Builder<UnionSchema<UnwrapOptions<TOptions>>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.union, {
      options: options.map(unwrapSchema) as unknown as UnwrapOptions<TOptions>,
    })
  );
}

export function xor<const TOptions extends readonly SchemaInput[]>(
  ...options: TOptions
): Builder<XorSchema<UnwrapOptions<TOptions>>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.xor, {
      options: options.map(unwrapSchema) as unknown as UnwrapOptions<TOptions>,
    })
  );
}

export function not<TSchema extends AnyTypeSchema>(schema: SchemaInput<TSchema>): Builder<NotSchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.not, {
      innerType: unwrapSchema(schema),
    })
  );
}

/**
 * Creates an intersection schema builder.
 *
 * @template TOptions - The option schema inputs.
 * @param options - The schemas or builders intersected by the schema.
 * @returns A builder wrapping an intersection schema.
 */
export function intersection<const TOptions extends readonly SchemaInput[]>(
  ...options: TOptions
): Builder<IntersectionSchema<UnwrapOptions<TOptions>>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.intersection, {
      options: options.map(unwrapSchema) as unknown as UnwrapOptions<TOptions>,
    })
  );
}

/**
 * Creates a discriminated-union schema builder.
 *
 * @template TDiscriminator - The discriminator property name.
 * @template TOptions - The option schema inputs.
 * @param discriminator - The property used to discriminate options.
 * @param options - The schemas or builders accepted by the union.
 * @returns A builder wrapping a discriminated-union schema.
 */
export function discriminatedUnion<const TDiscriminator extends string, const TOptions extends readonly SchemaInput[]>(
  discriminator: TDiscriminator,
  options: TOptions
): Builder<DiscriminatedUnionSchema<UnwrapOptions<TOptions>>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.discriminatedUnion, {
      discriminator,
      options: options.map(unwrapSchema) as unknown as UnwrapOptions<TOptions>,
    })
  );
}

type UnwrapOptions<TOptions extends readonly SchemaInput[]> = {
  readonly [TKey in keyof TOptions]: TOptions[TKey] extends SchemaInput<infer TSchema extends AnyTypeSchema>
    ? TSchema
    : never;
};
