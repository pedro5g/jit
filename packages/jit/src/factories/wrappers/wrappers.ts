import type {
  AnyTypeSchema,
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
import type { Builder } from "../../core/builder/index.js";
import { createBuilder, type SchemaInput, unwrapSchema } from "../../core/builder/index.js";
import * as Transform from "../../transforms/index.js";

export function optional<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): Builder<OptionalSchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(Transform.optional(unwrapSchema(schema)));
}

export function nullable<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): Builder<NullableSchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(Transform.nullable(unwrapSchema(schema)));
}

export function nullish<TSchema extends AnyTypeSchema>(schema: SchemaInput<TSchema>): Builder<NullishSchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(Transform.nullish(unwrapSchema(schema)));
}

export function readonly<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): Builder<ReadonlySchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(Transform.readonly(unwrapSchema(schema)));
}

export function promise<TSchema extends AnyTypeSchema>(schema: SchemaInput<TSchema>): Builder<PromiseSchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(Transform.promise(unwrapSchema(schema)));
}

function defaultTo<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  defaultValue: InferSchema<TSchema> | (() => InferSchema<TSchema>)
): Builder<DefaultSchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(Transform.default(unwrapSchema(schema), defaultValue));
}

export { defaultTo as default };

export function brand<TSchema extends AnyTypeSchema, const TBrand extends string>(
  schema: SchemaInput<TSchema>,
  brandName: TBrand
): Builder<BrandSchema<TSchema, TBrand>> {
  return /* @__PURE__ */ createBuilder(Transform.brand(unwrapSchema(schema), brandName));
}

export function pipe<TSchema extends AnyTypeSchema, TOutput>(
  schema: SchemaInput<TSchema>,
  transform: (value: InferSchema<TSchema>) => TOutput
): Builder<PipeSchema<TSchema, TOutput>> {
  return /* @__PURE__ */ createBuilder(Transform.pipe(unwrapSchema(schema), transform));
}
