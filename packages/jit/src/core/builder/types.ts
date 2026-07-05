import type {
  AnyTypeSchema,
  BrandSchema,
  CoerceSchema,
  DefaultSchema,
  InferSchema,
  MergeShape,
  NullableSchema,
  NullishSchema,
  ObjectSchema,
  OmitShape,
  OptionalSchema,
  PartialShape,
  PickShape,
  PipeSchema,
  PromiseSchema,
  ReadonlySchema,
  RefineSchema,
  RequiredShape,
  SchemaShape,
  TransformSchema,
  TransformSpec,
} from "../ats/index.js";
import type { EntityHint, HashStrategy, OrderDirection, PropertySelector } from "../hints/index.js";
import type { SchemaInput } from "./unwrap-schema.js";

export interface BuilderCore<TSchema extends AnyTypeSchema> {
  readonly schema: TSchema;
  optional(): Builder<OptionalSchema<TSchema>>;
  nullable(): Builder<NullableSchema<TSchema>>;
  nullish(): Builder<NullishSchema<TSchema>>;
  readonly(): Builder<ReadonlySchema<TSchema>>;
  promise(): Builder<PromiseSchema<TSchema>>;
  default(defaultValue: InferSchema<TSchema> | (() => InferSchema<TSchema>)): Builder<DefaultSchema<TSchema>>;
  brand<const TBrand extends string>(brandName: TBrand): Builder<BrandSchema<TSchema, TBrand>>;
  pipe<TOutput>(transform: (value: InferSchema<TSchema>) => TOutput): Builder<PipeSchema<TSchema, TOutput>>;
  refine(predicate: (value: InferSchema<TSchema>) => boolean): Builder<RefineSchema<TSchema>>;
  coerce(coercer: (value: unknown) => InferSchema<TSchema>): Builder<CoerceSchema<TSchema>>;
  entity(options: EntityHint<HintTarget<InferSchema<TSchema>>>): Builder<TSchema>;
  keyed(key: Extract<PropertySelector<HintTarget<InferSchema<TSchema>>>, string>): Builder<TSchema>;
  groupBy(key: Extract<PropertySelector<HintTarget<InferSchema<TSchema>>>, string>): Builder<TSchema>;
  sortBy(
    key: Extract<PropertySelector<HintTarget<InferSchema<TSchema>>>, string>,
    direction?: OrderDirection
  ): Builder<TSchema>;
  uniqueBy(key: Extract<PropertySelector<HintTarget<InferSchema<TSchema>>>, string>): Builder<TSchema>;
  indexBy(key: Extract<PropertySelector<HintTarget<InferSchema<TSchema>>>, string>): Builder<TSchema>;
  ordered(
    key: Extract<PropertySelector<HintTarget<InferSchema<TSchema>>>, string>,
    direction?: OrderDirection
  ): Builder<TSchema>;
  hash(strategy?: HashStrategy): Builder<TSchema>;
}

type HintTarget<T> = T extends readonly (infer TElement)[] ? TElement : T;

export interface ObjectOperators<TShape extends SchemaShape> {
  partial(): ObjectBuilder<PartialShape<TShape>>;
  required(): ObjectBuilder<RequiredShape<TShape>>;
  transform<const TSpec extends TransformSpec<InferSchema<ObjectSchema<TShape>>>>(
    transforms: TSpec
  ): Builder<TransformSchema<ObjectSchema<TShape>, TSpec>>;
  pick<const TKeys extends readonly (keyof TShape)[]>(keys: TKeys): ObjectBuilder<PickShape<TShape, TKeys[number]>>;
  omit<const TKeys extends readonly (keyof TShape)[]>(keys: TKeys): ObjectBuilder<OmitShape<TShape, TKeys[number]>>;
  extend<const TExtension extends Record<string, SchemaInput>>(
    extension: TExtension
  ): ObjectBuilder<MergeShape<TShape, UnwrapBuilderShape<TExtension>>>;
  merge<TRight extends SchemaShape>(
    right: ObjectBuilder<TRight> | ObjectSchema<TRight>
  ): ObjectBuilder<MergeShape<TShape, TRight>>;
}

export type UnwrapBuilderShape<TShape extends Record<string, SchemaInput>> = {
  readonly [TKey in keyof TShape]: TShape[TKey] extends SchemaInput<infer TSchema extends AnyTypeSchema>
    ? TSchema
    : never;
};

export type BaseBuilder<TSchema extends AnyTypeSchema> = BuilderCore<TSchema>;

/** String constraint methods; every call returns the same builder type. */
export interface StringCheckMethods<TSchema extends AnyTypeSchema> {
  min(length: number): Builder<TSchema>;
  max(length: number): Builder<TSchema>;
  length(length: number): Builder<TSchema>;
  regex(pattern: RegExp): Builder<TSchema>;
  email(): Builder<TSchema>;
  uuid(): Builder<TSchema>;
  url(): Builder<TSchema>;
  trim(): Builder<TSchema>;
  lowercase(): Builder<TSchema>;
  uppercase(): Builder<TSchema>;
}

/** Numeric constraint methods; every call returns the same builder type. */
export interface NumberCheckMethods<TSchema extends AnyTypeSchema> {
  min(value: number): Builder<TSchema>;
  max(value: number): Builder<TSchema>;
  positive(): Builder<TSchema>;
  negative(): Builder<TSchema>;
  multipleOf(value: number): Builder<TSchema>;
  finite(): Builder<TSchema>;
  safe(): Builder<TSchema>;
  int(): Builder<TSchema>;
}

/** Array length constraint methods; every call returns the same builder type. */
export interface ArrayCheckMethods<TSchema extends AnyTypeSchema> {
  min(length: number): Builder<TSchema>;
  max(length: number): Builder<TSchema>;
  length(length: number): Builder<TSchema>;
  nonEmpty(): Builder<TSchema>;
}

type CheckMethods<TSchema extends AnyTypeSchema> = TSchema extends { readonly type: "string" }
  ? StringCheckMethods<TSchema>
  : TSchema extends { readonly type: "number" | "int" }
    ? NumberCheckMethods<TSchema>
    : TSchema extends { readonly type: "array" }
      ? ArrayCheckMethods<TSchema>
      : unknown;

export type ObjectBuilder<TShape extends SchemaShape> = BuilderCore<ObjectSchema<TShape>> & ObjectOperators<TShape>;

export type Builder<TSchema extends AnyTypeSchema> =
  TSchema extends ObjectSchema<infer TShape> ? ObjectBuilder<TShape> : BaseBuilder<TSchema> & CheckMethods<TSchema>;

export type AnyBuilder = Builder<AnyTypeSchema>;
