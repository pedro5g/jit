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

/**
 * Wraps a schema so `undefined` is also accepted (`T | undefined`).
 *
 * @template TSchema - The schema being wrapped.
 * @param schema - The schema to wrap.
 * @returns A new optional schema.
 */
export function optional<TSchema extends AnyTypeSchema>(schema: TSchema): OptionalSchema<TSchema> {
  return /* @__PURE__ */ createSchema(
    TypeName.optional,
    {
      innerType: schema,
    },
    schema.annotations
  );
}

/**
 * Wraps a schema so `null` is also accepted (`T | null`).
 *
 * @template TSchema - The schema being wrapped.
 * @param schema - The schema to wrap.
 * @returns A new nullable schema.
 */
export function nullable<TSchema extends AnyTypeSchema>(schema: TSchema): NullableSchema<TSchema> {
  return /* @__PURE__ */ createSchema(
    TypeName.nullable,
    {
      innerType: schema,
    },
    schema.annotations
  );
}

/**
 * Wraps a schema so both `null` and `undefined` are accepted
 * (`T | null | undefined`).
 *
 * @template TSchema - The schema being wrapped.
 * @param schema - The schema to wrap.
 * @returns A new nullish schema.
 */
export function nullish<TSchema extends AnyTypeSchema>(schema: TSchema): NullishSchema<TSchema> {
  return /* @__PURE__ */ createSchema(
    TypeName.nullish,
    {
      innerType: schema,
    },
    schema.annotations
  );
}

/**
 * Marks the schema's inferred type as `Readonly<T>`. Compilers treat readonly
 * schemas as non-updatable.
 *
 * @template TSchema - The schema being wrapped.
 * @param schema - The schema to wrap.
 * @returns A new readonly schema.
 */
export function readonly<TSchema extends AnyTypeSchema>(schema: TSchema): ReadonlySchema<TSchema> {
  return /* @__PURE__ */ createSchema(
    TypeName.readonly,
    {
      innerType: schema,
    },
    schema.annotations
  );
}

/**
 * Wraps a schema in a `Promise<T>` type.
 *
 * @template TSchema - The resolved value's schema.
 * @param schema - The resolved value schema.
 * @returns A new promise schema.
 */
export function promise<TSchema extends AnyTypeSchema>(schema: TSchema): PromiseSchema<TSchema> {
  return /* @__PURE__ */ createSchema(
    TypeName.promise,
    {
      innerType: schema,
    },
    schema.annotations
  );
}

/**
 * Attaches a default value (or lazy factory) used when the input is
 * `undefined`. Exported as `default`.
 *
 * @template TSchema - The schema being wrapped.
 * @param schema - The schema to wrap.
 * @param defaultValue - The value or lazy factory used for `undefined` input.
 * @returns A new default schema.
 */
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

/**
 * Brands the schema's inferred type for nominal typing. Purely a type-level
 * marker - no runtime behavior.
 *
 * @template TSchema - The schema being branded.
 * @template TBrand - The brand's string literal name.
 * @param schema - The schema to brand.
 * @param brandName - The brand name.
 * @returns A new branded schema.
 */
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

/**
 * Appends an output transform step: the compiled pipeline maps the schema's
 * value through `transform`. The callback is stored as an external binding.
 *
 * @template TSchema - The input schema.
 * @template TOutput - The transform's output type.
 * @param schema - The schema to pipe from.
 * @param transform - The output transform callback.
 * @returns A new pipe schema.
 */
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

/**
 * Attaches per-field transform callbacks to an object schema.
 *
 * @template TSchema - The object schema being wrapped.
 * @template TSpec - The per-field callback spec.
 * @param schema - The object schema to transform.
 * @param transforms - Per-field transform callbacks.
 * @returns A new transform schema.
 */
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

/**
 * Attaches a predicate; compiled pipelines throw `JITError("REFINE_FAILED")`
 * when it rejects a value.
 *
 * @template TSchema - The schema being refined.
 * @param schema - The schema to refine.
 * @param predicate - The predicate checked by compiled pipelines.
 * @returns A new refine schema.
 */
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

/**
 * Attaches an input coercion step that runs before the schema's other steps.
 *
 * @template TSchema - The target schema after coercion.
 * @param schema - The target schema after coercion.
 * @param coercer - The input coercion callback.
 * @returns A new coerce schema.
 */
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
