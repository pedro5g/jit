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
import { nativeCoercions } from "../coerce.js";

/**
 * Creates an optional schema builder from a schema input.
 *
 * @template TSchema - The wrapped schema type.
 * @param schema - The schema or builder to wrap.
 * @returns A builder wrapping an optional schema.
 */
export function optional<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): Builder<OptionalSchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(Transform.optional(unwrapSchema(schema)));
}

/**
 * Creates a nullable schema builder from a schema input.
 *
 * @template TSchema - The wrapped schema type.
 * @param schema - The schema or builder to wrap.
 * @returns A builder wrapping a nullable schema.
 */
export function nullable<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): Builder<NullableSchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(Transform.nullable(unwrapSchema(schema)));
}

/**
 * Creates a nullish schema builder from a schema input.
 *
 * @template TSchema - The wrapped schema type.
 * @param schema - The schema or builder to wrap.
 * @returns A builder wrapping a nullish schema.
 */
export function nullish<TSchema extends AnyTypeSchema>(schema: SchemaInput<TSchema>): Builder<NullishSchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(Transform.nullish(unwrapSchema(schema)));
}

/**
 * Creates a readonly schema builder from a schema input.
 *
 * @template TSchema - The wrapped schema type.
 * @param schema - The schema or builder to wrap.
 * @returns A builder wrapping a readonly schema.
 */
export function readonly<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): Builder<ReadonlySchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(Transform.readonly(unwrapSchema(schema)));
}

/**
 * Creates a promise schema builder from a resolved-value schema input.
 *
 * @template TSchema - The resolved-value schema type.
 * @param schema - The schema or builder for the resolved value.
 * @returns A builder wrapping a promise schema.
 */
export function promise<TSchema extends AnyTypeSchema>(schema: SchemaInput<TSchema>): Builder<PromiseSchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(Transform.promise(unwrapSchema(schema)));
}

/**
 * Creates a default-value schema builder from a schema input.
 *
 * @template TSchema - The wrapped schema type.
 * @param schema - The schema or builder to wrap.
 * @param defaultValue - The eager value or lazy factory used for `undefined` input.
 * @returns A builder wrapping a default schema.
 */
function defaultTo<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  defaultValue: InferSchema<TSchema> | (() => InferSchema<TSchema>)
): Builder<DefaultSchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(Transform.default(unwrapSchema(schema), defaultValue));
}

export { defaultTo as default };

/**
 * Creates a branded schema builder.
 *
 * @template TSchema - The wrapped schema type.
 * @template TBrand - The brand string literal.
 * @param schema - The schema or builder to brand.
 * @param brandName - The brand name.
 * @returns A builder wrapping a branded schema.
 */
export function brand<TSchema extends AnyTypeSchema, const TBrand extends string>(
  schema: SchemaInput<TSchema>,
  brandName: TBrand
): Builder<BrandSchema<TSchema, TBrand>> {
  return /* @__PURE__ */ createBuilder(Transform.brand(unwrapSchema(schema), brandName));
}

/**
 * Creates a pipe schema builder.
 *
 * @template TSchema - The input schema type.
 * @template TOutput - The transform output type.
 * @param schema - The schema or builder to pipe from.
 * @param transform - The output transform callback.
 * @returns A builder wrapping a pipe schema.
 */
export function pipe<TSchema extends AnyTypeSchema, TOutput>(
  schema: SchemaInput<TSchema>,
  transform: (value: InferSchema<TSchema>) => TOutput
): Builder<PipeSchema<TSchema, TOutput>> {
  return /* @__PURE__ */ createBuilder(Transform.pipe(unwrapSchema(schema), transform));
}

/**
 * Creates a per-field transform schema builder.
 *
 * @template TSchema - The object schema type.
 * @template TSpec - The transform spec type.
 * @param schema - The schema or builder to transform.
 * @param transforms - Per-field transform callbacks.
 * @returns A builder wrapping a transform schema.
 */
export function transform<TSchema extends AnyTypeSchema, const TSpec extends TransformSpec<InferSchema<TSchema>>>(
  schema: SchemaInput<TSchema>,
  transforms: TSpec
): Builder<TransformSchema<TSchema, TSpec>> {
  return /* @__PURE__ */ createBuilder(Transform.transform(unwrapSchema(schema), transforms));
}

/**
 * Creates a refine schema builder.
 *
 * @template TSchema - The refined schema type.
 * @param schema - The schema or builder to refine.
 * @param predicate - The predicate checked by compiled pipelines.
 * @returns A builder wrapping a refine schema.
 */
export function refine<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  predicate: (value: InferSchema<TSchema>) => boolean
): Builder<RefineSchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(Transform.refine(unwrapSchema(schema), predicate));
}

/**
 * Creates a coerce schema builder from a custom callback.
 *
 * @template TSchema - The target schema type.
 * @param schema - The schema or builder after coercion.
 * @param coercer - The input coercion callback.
 * @returns A builder wrapping a coerce schema.
 */
function coerceWith<TSchema extends AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  coercer: (value: unknown) => InferSchema<TSchema>
): Builder<CoerceSchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(Transform.coerce(unwrapSchema(schema), coercer));
}

/**
 * Input coercion, two shapes:
 * - `JIT.coerce(schema, fn)` — custom callback (runtime-only binding);
 * - `JIT.coerce.number()` / `.string()` / `.boolean()` / `.bigint()` /
 *   `.date()` — zod-style native coercions, emitted inline
 *   (`Number(v)`, `new Date(v)`, ...) and therefore AOT-safe.
 */
export const coerce = Object.assign(coerceWith, nativeCoercions);
