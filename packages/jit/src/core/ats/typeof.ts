import type * as ATS from "./type-schema.js";
import type { AnyTypeSchema, OptionalSchema, ReadonlySchema, SchemaShape } from "./type-schema.js";

/** Resolves the output represented by a schema or builder. */
export type Typeof<TSchemaLike> = ResolveTypeofSchemaLike<TSchemaLike>;

export type SchemaLike<TSchema extends AnyTypeSchema = AnyTypeSchema> = TSchema | { readonly schema: TSchema };

export type TypeofSchemaLike<TSchemaLike extends SchemaLike> = ResolveTypeofSchemaLike<TSchemaLike>;

/**
 * Public, schema-directed output resolution.
 *
 * The compiler keeps `_type` as a cheap phantom for its internal contracts.
 * This resolver is the public display boundary: structural nodes are rebuilt
 * from their children while runtime classes, functions and special values stay
 * atomic.  In particular, it never recursively simplifies an arbitrary
 * object, which would expand Date/Map/Set/functions and lose brands.
 */
export type ResolveTypeofSchema<TSchema extends AnyTypeSchema> = TSchema extends {
  readonly type: "runtimeType";
  readonly _type: infer TInstance;
}
  ? TInstance
  : TSchema extends { readonly type: "readonly"; readonly _type: infer TOutput }
    ? TOutput
    : TSchema extends ATS.ObjectSchema<infer TShape, infer TUnknownKeys, infer TCatchall>
      ? ResolveObjectOutput<TShape, TUnknownKeys, TCatchall>
      : TSchema extends ATS.ArraySchema<infer TElement>
        ? ResolveTypeofSchema<TElement>[]
        : TSchema extends ATS.SetSchema<infer TElement>
          ? Set<ResolveTypeofSchema<TElement>>
          : TSchema extends ATS.MapSchema<infer TKey, infer TValue>
            ? Map<ResolveTypeofSchema<TKey>, ResolveTypeofSchema<TValue>>
            : TSchema extends ATS.RecordSchema<infer TKey, infer TValue>
              ? Record<Extract<ResolveTypeofSchema<TKey>, PropertyKey>, ResolveTypeofSchema<TValue>>
              : TSchema extends ATS.TupleSchema<infer TItems, infer TRest>
                ? ResolveTuple<TItems, TRest>
                : TSchema extends ATS.UnionSchema<infer TOptions> | ATS.XorSchema<infer TOptions>
                  ? ResolveTypeofSchema<TOptions[number]>
                  : TSchema extends ATS.IntersectionSchema<infer TOptions>
                    ? ResolveIntersection<TOptions>
                    : TSchema extends ATS.DiscriminatedUnionSchema<infer TOptions>
                      ? ResolveTypeofSchema<TOptions[number]>
                      : TSchema extends ATS.OptionalSchema<infer TInner>
                        ? ResolveTypeofSchema<TInner> | undefined
                        : TSchema extends ATS.NullableSchema<infer TInner>
                          ? ResolveTypeofSchema<TInner> | null
                          : TSchema extends ATS.NullishSchema<infer TInner>
                            ? ResolveTypeofSchema<TInner> | null | undefined
                            : TSchema extends ATS.ReadonlySchema<infer TInner>
                              ? ATS.ReadonlyOutput<ResolveTypeofSchema<TInner>>
                              : TSchema extends ATS.PromiseSchema<infer TInner>
                                ? Promise<ResolveTypeofSchema<TInner>>
                                : TSchema extends ATS.DefaultSchema<infer TInner>
                                  ? ResolveTypeofSchema<TInner>
                                  : TSchema extends ATS.BrandSchema<infer TInner, infer TBrand>
                                    ? ATS.Brand<ResolveTypeofSchema<TInner>, TBrand>
                                    : TSchema extends ATS.TransformSchema<infer TInner, infer TSpec>
                                      ? ResolveTransformOutput<ResolveTypeofSchema<TInner>, TSpec>
                                      : TSchema extends ATS.PipeSchema<AnyTypeSchema, infer TOutput>
                                        ? TOutput
                                        : TSchema extends ATS.CodecSchema<AnyTypeSchema, infer TOutput>
                                          ? ResolveTypeofSchema<TOutput>
                                          : TSchema extends ATS.LazySchema<infer TInner>
                                            ? ResolveTypeofSchema<TInner>
                                            : TSchema extends ATS.WhenSchema<infer TThen, infer TOtherwise>
                                              ? ResolveTypeofSchema<TThen> | ResolveTypeofSchema<TOtherwise>
                                              : TSchema["_type"];

type ResolveTypeofSchemaLike<TSchemaLike> = TSchemaLike extends abstract new (
  ...args: never[]
) => infer TInstance
  ? PublicRuntimeInstance<TInstance>
  : TSchemaLike extends {
        readonly schema: infer TSchema extends AnyTypeSchema;
      }
    ? ResolveTypeofSchema<TSchema>
    : TSchemaLike extends AnyTypeSchema
      ? ResolveTypeofSchema<TSchemaLike>
      : never;

/**
 * A Runtime Class constructor is an atomic public boundary.  Mapping its
 * public keys drops protected/private implementation members such as a DDD
 * carrier without recursively expanding the values of Date, functions, or
 * nested Runtime Types.
 */
type PublicRuntimeInstance<TInstance> = TInstance extends { readonly "~event": unknown }
  ? TInstance
  : { [TKey in keyof TInstance]: TInstance[TKey] };

type ResolveObjectOutput<
  TShape extends SchemaShape,
  TUnknownKeys extends ATS.ObjectUnknownKeys,
  TCatchall extends AnyTypeSchema | undefined,
> = {
  -readonly [TKey in keyof TShape]: ResolveTypeofSchema<TShape[TKey]>;
} & (TCatchall extends AnyTypeSchema
  ? Record<string, ResolveTypeofSchema<TCatchall> | ResolveObjectKnownValue<TShape>>
  : TUnknownKeys extends "passthrough"
    ? Record<string, unknown>
    : unknown);

type ResolveObjectKnownValue<TShape extends SchemaShape> = {
  -readonly [TKey in keyof TShape]: ResolveTypeofSchema<TShape[TKey]>;
}[keyof TShape];

type ResolveTuple<
  TItems extends readonly AnyTypeSchema[],
  TRest extends AnyTypeSchema | undefined,
> = TRest extends AnyTypeSchema
  ? [...ResolveTupleItems<TItems>, ...ResolveTypeofSchema<TRest>[]]
  : ResolveTupleItems<TItems>;

type ResolveTupleItems<TItems extends readonly AnyTypeSchema[]> = TItems extends readonly []
  ? []
  : TItems extends readonly [infer THead extends AnyTypeSchema, ...infer TTail extends readonly AnyTypeSchema[]]
    ? [ResolveTypeofSchema<THead>, ...ResolveTupleItems<TTail>]
    : ResolveTypeofSchema<TItems[number]>[];

type ResolveIntersection<TOptions extends readonly AnyTypeSchema[]> = TOptions extends readonly [
  infer THead extends AnyTypeSchema,
  ...infer TTail extends readonly AnyTypeSchema[],
]
  ? ResolveTypeofSchema<THead> & ResolveIntersection<TTail>
  : unknown;

type ResolveTransformOutput<TInput, TSpec> =
  TSpec extends ATS.TransformSpec<TInput> ? ATS.TransformOutput<TInput, TSpec> : TInput;

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
