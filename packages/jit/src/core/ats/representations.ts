import type {
  AnyTypeSchema,
  ArraySchema,
  DefaultSchema,
  NullableSchema,
  NullishSchema,
  ObjectSchema,
  OptionalSchema,
  RuntimeTypeSchema,
  SchemaShape,
  TypeofSchema,
} from "./type-schema.js";

type RuntimeInstance<TSchemaLike> = TSchemaLike extends abstract new (
  ...args: never[]
) => infer TInstance
  ? TInstance
  : never;

type SchemaOf<TSchemaLike> = TSchemaLike extends { readonly schema: infer TSchema extends AnyTypeSchema }
  ? TSchema
  : TSchemaLike extends AnyTypeSchema
    ? TSchemaLike
    : never;

type HydrateShape<TShape extends SchemaShape> = {
  -readonly [TKey in keyof TShape]: HydrateSchema<TShape[TKey]>;
};

type HydrateSchema<TSchema extends AnyTypeSchema> =
  TSchema extends RuntimeTypeSchema<infer TInner, unknown, "object" | "value", boolean>
    ? HydrateSchema<TInner>
    : TSchema extends ObjectSchema<infer TShape>
      ? HydrateShape<TShape>
      : TSchema extends ArraySchema<infer TElement>
        ? HydrateSchema<TElement>[]
        : TSchema extends OptionalSchema<infer TInner>
          ? HydrateSchema<TInner> | undefined
          : TSchema extends NullableSchema<infer TInner>
            ? HydrateSchema<TInner> | null
            : TSchema extends NullishSchema<infer TInner>
              ? HydrateSchema<TInner> | null | undefined
              : TSchema extends DefaultSchema<infer TInner>
                ? HydrateSchema<TInner>
                : TSchema extends { readonly def: { readonly innerType: infer TInner extends AnyTypeSchema } }
                  ? HydrateSchema<TInner>
                  : TypeofSchema<TSchema>;

/** Complete persisted state used by `RuntimeClass.hydrate()`. Defaults remain required. */
export type Hydrate<TSchemaLike> = HydrateSchema<SchemaOf<TSchemaLike>>;

/** Boundary representation. Runtime Types will lower to their underlying schema wire value. */
export type Wire<TSchemaLike> = HydrateSchema<SchemaOf<TSchemaLike>>;

/** Materialized in-memory representation, including generated Runtime Class instances. */
export type Runtime<TSchemaLike> = [RuntimeInstance<TSchemaLike>] extends [never]
  ? TypeofSchema<SchemaOf<TSchemaLike>>
  : RuntimeInstance<TSchemaLike>;
