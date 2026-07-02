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
  return /* @__PURE__ */ createSchema(
    TypeName.optional,
    {
      innerType: schema,
    },
    schema.annotations
  );
}

export function nullable<TSchema extends AnyTypeSchema>(schema: TSchema): NullableSchema<TSchema> {
  return /* @__PURE__ */ createSchema(
    TypeName.nullable,
    {
      innerType: schema,
    },
    schema.annotations
  );
}

export function nullish<TSchema extends AnyTypeSchema>(schema: TSchema): NullishSchema<TSchema> {
  return /* @__PURE__ */ createSchema(
    TypeName.nullish,
    {
      innerType: schema,
    },
    schema.annotations
  );
}

export function readonly<TSchema extends AnyTypeSchema>(schema: TSchema): ReadonlySchema<TSchema> {
  return /* @__PURE__ */ createSchema(
    TypeName.readonly,
    {
      innerType: schema,
    },
    schema.annotations
  );
}

export function promise<TSchema extends AnyTypeSchema>(schema: TSchema): PromiseSchema<TSchema> {
  return /* @__PURE__ */ createSchema(
    TypeName.promise,
    {
      innerType: schema,
    },
    schema.annotations
  );
}

function defaultTo<TSchema extends AnyTypeSchema>(
  schema: TSchema,
  defaultValue: InferSchema<TSchema> | (() => InferSchema<TSchema>)
): DefaultSchema<TSchema> {
  return /* @__PURE__ */ createSchema(
    TypeName.default,
    {
      innerType: schema,
      defaultValue,
    },
    schema.annotations
  );
}

export { defaultTo as default };

export function brand<TSchema extends AnyTypeSchema, const TBrand extends string>(
  schema: TSchema,
  brandName: TBrand
): BrandSchema<TSchema, TBrand> {
  return /* @__PURE__ */ createSchema(
    TypeName.brand,
    {
      innerType: schema,
      brand: brandName,
    },
    schema.annotations
  );
}

export function pipe<TSchema extends AnyTypeSchema, TOutput>(
  schema: TSchema,
  transform: (value: InferSchema<TSchema>) => TOutput
): PipeSchema<TSchema, TOutput> {
  return /* @__PURE__ */ createSchema(
    TypeName.pipe,
    {
      innerType: schema,
      transform,
    },
    schema.annotations
  );
}
