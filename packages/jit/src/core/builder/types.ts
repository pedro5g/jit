import type {
  AnyTypeSchema,
  BrandSchema,
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
  RequiredShape,
  SchemaShape,
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

export type ObjectBuilder<TShape extends SchemaShape> = BuilderCore<ObjectSchema<TShape>> & ObjectOperators<TShape>;

export type Builder<TSchema extends AnyTypeSchema> =
  TSchema extends ObjectSchema<infer TShape> ? ObjectBuilder<TShape> : BaseBuilder<TSchema>;

export type AnyBuilder = Builder<AnyTypeSchema>;
