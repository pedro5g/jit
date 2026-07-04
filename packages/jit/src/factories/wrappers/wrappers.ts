import type {
  AnyTypeSchema,
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

export function transform<TSchema extends AnyTypeSchema, const TSpec extends TransformSpec<InferSchema<TSchema>>>(
  schema: SchemaInput<TSchema>,
  transforms: TSpec
): Builder<TransformSchema<TSchema, TSpec>> {
  return /* @__PURE__ */ createBuilder(Transform.transform(unwrapSchema(schema), transforms));
}

export function refine<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  predicate: (value: InferSchema<TSchema>) => boolean
): Builder<RefineSchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(Transform.refine(unwrapSchema(schema), predicate));
}

export function coerce<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  coercer: (value: unknown) => InferSchema<TSchema>
): Builder<CoerceSchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(Transform.coerce(unwrapSchema(schema), coercer));
}
