import type {
  BrandSchema,
  DefaultSchema,
  InferSchema,
  NullableSchema,
  NullishSchema,
  OptionalSchema,
  PipeSchema,
  PromiseSchema,
  ReadonlySchema,
} from "../../core/ats/index.js";
import { type AnyTypeSchema, createSchema, TypeName } from "../../core/ats/index.js";

export function optional<TSchema extends AnyTypeSchema>(schema: TSchema): OptionalSchema<TSchema> {
  return /* @__PURE__ */ createSchema(TypeName.optional, {
    innerType: schema,
  });
}

export function nullable<TSchema extends AnyTypeSchema>(schema: TSchema): NullableSchema<TSchema> {
  return /* @__PURE__ */ createSchema(TypeName.nullable, {
    innerType: schema,
  });
}

export function nullish<TSchema extends AnyTypeSchema>(schema: TSchema): NullishSchema<TSchema> {
  return /* @__PURE__ */ createSchema(TypeName.nullish, {
    innerType: schema,
  });
}

export function readonly<TSchema extends AnyTypeSchema>(schema: TSchema): ReadonlySchema<TSchema> {
  return /* @__PURE__ */ createSchema(TypeName.readonly, {
    innerType: schema,
  });
}

export function promise<TSchema extends AnyTypeSchema>(schema: TSchema): PromiseSchema<TSchema> {
  return /* @__PURE__ */ createSchema(TypeName.promise, {
    innerType: schema,
  });
}

function defaultTo<TSchema extends AnyTypeSchema>(
  schema: TSchema,
  defaultValue: InferSchema<TSchema> | (() => InferSchema<TSchema>)
): DefaultSchema<TSchema> {
  return /* @__PURE__ */ createSchema(TypeName.default, {
    innerType: schema,
    defaultValue,
  });
}

export { defaultTo as default };

export function brand<TSchema extends AnyTypeSchema, const TBrand extends string>(
  schema: TSchema,
  brandName: TBrand
): BrandSchema<TSchema, TBrand> {
  return /* @__PURE__ */ createSchema(TypeName.brand, {
    innerType: schema,
    brand: brandName,
  });
}

export function pipe<TSchema extends AnyTypeSchema, TOutput>(
  schema: TSchema,
  transform: (value: InferSchema<TSchema>) => TOutput
): PipeSchema<TSchema, TOutput> {
  return /* @__PURE__ */ createSchema(TypeName.pipe, {
    innerType: schema,
    transform,
  });
}
