import {
  type AnyTypeSchema,
  createSchema,
  type DiscriminatedUnionSchema,
  type IntersectionSchema,
  TypeName,
  type UnionSchema,
} from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder, type SchemaInput, unwrapSchema } from "../../core/builder/index.js";

export function union<const TOptions extends readonly SchemaInput[]>(
  ...options: TOptions
): Builder<UnionSchema<UnwrapOptions<TOptions>>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.union, {
      options: options.map(unwrapSchema) as unknown as UnwrapOptions<TOptions>,
    })
  );
}

export function intersection<const TOptions extends readonly SchemaInput[]>(
  ...options: TOptions
): Builder<IntersectionSchema<UnwrapOptions<TOptions>>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.intersection, {
      options: options.map(unwrapSchema) as unknown as UnwrapOptions<TOptions>,
    })
  );
}

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
