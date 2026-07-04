import type {
  BrandSchema,
  CoerceSchema,
  DefaultSchema,
  InferSchema,
  NullableSchema,
  NullishSchema,
  OptionalSchema,
  PipeSchema,
  PromiseSchema,
  ReadonlySchema,
  RefineSchema,
  TransformSchema,
  TransformSpec,
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

export function transform<TSchema extends AnyTypeSchema, const TSpec extends TransformSpec<InferSchema<TSchema>>>(
  schema: TSchema,
  transforms: TSpec
): TransformSchema<TSchema, TSpec> {
  return /* @__PURE__ */ createSchema(
    TypeName.transform,
    {
      innerType: schema,
      transforms,
    },
    schema.annotations
  );
}

export function refine<TSchema extends AnyTypeSchema>(
  schema: TSchema,
  predicate: (value: InferSchema<TSchema>) => boolean
): RefineSchema<TSchema> {
  return /* @__PURE__ */ createSchema(
    TypeName.refine,
    {
      innerType: schema,
      predicate,
    },
    schema.annotations
  );
}

export function coerce<TSchema extends AnyTypeSchema>(
  schema: TSchema,
  coercer: (value: unknown) => InferSchema<TSchema>
): CoerceSchema<TSchema> {
  return /* @__PURE__ */ createSchema(
    TypeName.coerce,
    {
      innerType: schema,
      coercer,
    },
    schema.annotations
  );
}
