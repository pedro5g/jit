import type { AnyTypeSchema, InferSchema, OptionalSchema, ReadonlySchema, SchemaShape } from "./type-schema.js";

export type Infer<TSchemaLike> = TSchemaLike extends { readonly schema: infer TSchema extends AnyTypeSchema }
  ? InferSchema<TSchema>
  : TSchemaLike extends AnyTypeSchema
    ? InferSchema<TSchemaLike>
    : never;

export type SchemaLike<TSchema extends AnyTypeSchema = AnyTypeSchema> = TSchema | { readonly schema: TSchema };

export type InferSchemaLike<TSchemaLike extends SchemaLike> = TSchemaLike extends {
  readonly schema: infer TSchema extends AnyTypeSchema;
}
  ? InferSchema<TSchema>
  : TSchemaLike extends AnyTypeSchema
    ? InferSchema<TSchemaLike>
    : never;

export type OptionalShape<TShape extends SchemaShape> = {
  readonly [TKey in keyof TShape]: TShape[TKey] extends OptionalSchema ? TShape[TKey] : OptionalSchema<TShape[TKey]>;
};

export type RequiredShape<TShape extends SchemaShape> = {
  readonly [TKey in keyof TShape]: TShape[TKey] extends OptionalSchema<infer TInner> ? TInner : TShape[TKey];
};

export type PartialShape<TShape extends SchemaShape> = OptionalShape<TShape>;

export type ReadonlyShape<TShape extends SchemaShape> = {
  readonly [TKey in keyof TShape]: ReadonlySchema<TShape[TKey]>;
};

export type PickShape<TShape extends SchemaShape, TKeys extends keyof TShape> = {
  readonly [TKey in TKeys]: TShape[TKey];
};

export type OmitShape<TShape extends SchemaShape, TKeys extends keyof TShape> = {
  readonly [TKey in Exclude<keyof TShape, TKeys>]: TShape[TKey];
};

export type ExtendShape<TShape extends SchemaShape, TExtension extends SchemaShape> = OmitShape<
  TShape,
  Extract<keyof TShape, keyof TExtension>
> &
  TExtension;

export type MergeShape<TLeft extends SchemaShape, TRight extends SchemaShape> = ExtendShape<TLeft, TRight>;

export type DeepPartialShape<TShape extends SchemaShape> = {
  readonly [TKey in keyof TShape]: OptionalSchema<TShape[TKey]>;
};

export type DeepRequiredShape<TShape extends SchemaShape> = RequiredShape<TShape>;

export type DeepReadonlyShape<TShape extends SchemaShape> = {
  readonly [TKey in keyof TShape]: ReadonlySchema<TShape[TKey]>;
};

export type AnySchemaLike = AnyTypeSchema | { readonly schema: AnyTypeSchema };
