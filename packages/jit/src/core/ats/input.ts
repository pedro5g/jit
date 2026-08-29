import type {
  AnyTypeSchema,
  ArraySchema,
  BrandSchema,
  CoerceSchema,
  DefaultSchema,
  IntersectionSchema,
  LazySchema,
  MapSchema,
  NullableSchema,
  NullishSchema,
  ObjectSchema,
  OptionalSchema,
  PipeSchema,
  PromiseSchema,
  ReadonlySchema,
  RecordSchema,
  RefineSchema,
  RuntimeTypeSchema,
  SchemaShape,
  SetSchema,
  TransformSchema,
  TupleSchema,
  TypeofSchema,
  UnionSchema,
  WhenSchema,
  XorSchema,
} from "./type-schema.js";

type Simplify<TValue> = { [TKey in keyof TValue]: TValue[TKey] } & {};

type InputTuple<TItems extends readonly AnyTypeSchema[]> = TItems extends readonly []
  ? []
  : TItems extends readonly [infer THead extends AnyTypeSchema, ...infer TTail extends readonly AnyTypeSchema[]]
    ? [InputOfSchema<THead>, ...InputTuple<TTail>]
    : InputOfSchema<TItems[number]>[];

/** Whether a field may be omitted from an object input. */
export type AcceptsMissing<TSchema extends AnyTypeSchema> = TSchema["type"] extends "optional" | "nullish" | "default"
  ? true
  : TSchema extends RuntimeTypeSchema<infer TInner, unknown, "object" | "value", boolean>
    ? AcceptsMissing<TInner>
    : TSchema extends ReadonlySchema<infer TInner>
      ? AcceptsMissing<TInner>
      : TSchema extends BrandSchema<infer TInner>
        ? AcceptsMissing<TInner>
        : TSchema extends RefineSchema<infer TInner>
          ? AcceptsMissing<TInner>
          : false;

type InputRequiredShape<TShape extends SchemaShape> = {
  -readonly [TKey in keyof TShape as AcceptsMissing<TShape[TKey]> extends true ? never : TKey]: InputOfSchema<
    TShape[TKey]
  >;
};

type InputOptionalShape<TShape extends SchemaShape> = {
  -readonly [TKey in keyof TShape as AcceptsMissing<TShape[TKey]> extends true ? TKey : never]?: InputOfSchema<
    TShape[TKey]
  >;
};

/** Input object shape: defaults and optional/nullish wrappers make keys optional. */
export type InputShape<TShape extends SchemaShape> = Simplify<InputRequiredShape<TShape> & InputOptionalShape<TShape>>;

/**
 * The value accepted at a schema boundary before defaults and output transforms
 * are resolved. It deliberately follows schema structure instead of copying
 * the output type, so it remains correct for nested object defaults.
 */
export type InputOfSchema<TSchema extends AnyTypeSchema> =
  TSchema extends RuntimeTypeSchema<infer TInner, unknown, "object" | "value", boolean>
    ? InputOfSchema<TInner>
    : TSchema extends ObjectSchema<infer TShape>
      ? InputShape<TShape>
      : TSchema extends ArraySchema<infer TElement>
        ? InputOfSchema<TElement>[]
        : TSchema extends SetSchema<infer TElement>
          ? Set<InputOfSchema<TElement>>
          : TSchema extends MapSchema<infer TKey, infer TValue>
            ? Map<InputOfSchema<TKey>, InputOfSchema<TValue>>
            : TSchema extends RecordSchema<infer TKey, infer TValue>
              ? Record<Extract<InputOfSchema<TKey>, PropertyKey>, InputOfSchema<TValue>>
              : TSchema extends TupleSchema<infer TItems, infer TRest>
                ? TRest extends AnyTypeSchema
                  ? [...InputTuple<TItems>, ...InputOfSchema<TRest>[]]
                  : InputTuple<TItems>
                : TSchema extends OptionalSchema<infer TInner>
                  ? InputOfSchema<TInner> | undefined
                  : TSchema extends NullableSchema<infer TInner>
                    ? InputOfSchema<TInner> | null
                    : TSchema extends NullishSchema<infer TInner>
                      ? InputOfSchema<TInner> | null | undefined
                      : TSchema extends DefaultSchema<infer TInner>
                        ? InputOfSchema<TInner> | undefined
                        : TSchema extends ReadonlySchema<infer TInner>
                          ? InputOfSchema<TInner>
                          : TSchema extends BrandSchema<infer TInner>
                            ? InputOfSchema<TInner>
                            : TSchema extends TransformSchema<infer TInner>
                              ? InputOfSchema<TInner>
                              : TSchema extends PipeSchema<infer TInner>
                                ? InputOfSchema<TInner>
                                : TSchema extends RefineSchema<infer TInner>
                                  ? InputOfSchema<TInner>
                                  : TSchema extends CoerceSchema
                                    ? unknown
                                    : TSchema extends PromiseSchema<infer TInner>
                                      ? Promise<InputOfSchema<TInner>>
                                      : TSchema extends LazySchema<infer TInner>
                                        ? InputOfSchema<TInner>
                                        : TSchema extends UnionSchema<infer TOptions>
                                          ? InputOfSchema<TOptions[number]>
                                          : TSchema extends XorSchema<infer TOptions>
                                            ? InputOfSchema<TOptions[number]>
                                            : TSchema extends IntersectionSchema<infer TOptions>
                                              ? InputOfSchema<TOptions[number]>
                                              : TSchema extends WhenSchema<infer TThen, infer TOtherwise>
                                                ? InputOfSchema<TThen> | InputOfSchema<TOtherwise>
                                                : TypeofSchema<TSchema>;

/**
 * Wrapper order must not weaken update safety: both `.readonly().default()`
 * and `.default(...).readonly()` represent immutable state. All transparent
 * wrappers carry `innerType`, while object/collection definitions do not.
 */
type IsReadonlyField<TSchema extends AnyTypeSchema> = TSchema["type"] extends "readonly"
  ? true
  : TSchema extends { readonly def: { readonly innerType: infer TInner extends AnyTypeSchema } }
    ? IsReadonlyField<TInner>
    : false;

type UpdateShape<TShape extends SchemaShape> = {
  -readonly [TKey in keyof TShape as IsReadonlyField<TShape[TKey]> extends true ? never : TKey]?: UpdateOfSchema<
    TShape[TKey]
  >;
};

/**
 * The immutable patch accepted for a schema output. Object fields are always
 * optional; readonly fields are omitted entirely, including when nested.
 */
export type UpdateOfSchema<TSchema extends AnyTypeSchema> =
  TSchema extends ObjectSchema<infer TShape>
    ? Simplify<UpdateShape<TShape>>
    : TSchema extends ArraySchema<infer TElement>
      ? (UpdateOfSchema<TElement> | undefined)[]
      : TypeofSchema<TSchema>;

/** Resolves the accepted input for a schema or builder. */
export type Input<TSchemaLike> = TSchemaLike extends {
  readonly schema: infer TSchema extends AnyTypeSchema;
}
  ? InputOfSchema<TSchema>
  : TSchemaLike extends AnyTypeSchema
    ? InputOfSchema<TSchemaLike>
    : never;

/** Resolves the immutable patch type for a schema or builder. */
export type Update<TSchemaLike> = TSchemaLike extends {
  readonly schema: infer TSchema extends AnyTypeSchema;
}
  ? UpdateOfSchema<TSchema>
  : TSchemaLike extends AnyTypeSchema
    ? UpdateOfSchema<TSchemaLike>
    : never;
