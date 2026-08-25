import type { AnyTypeSchema, RuntimeTypeSchema, TypeofSchema } from "./type-schema.js";

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

/** Complete persisted state used by `RuntimeClass.hydrate()`. */
export type Hydrate<TSchemaLike> =
  SchemaOf<TSchemaLike> extends RuntimeTypeSchema<infer TInner>
    ? TypeofSchema<TInner>
    : TypeofSchema<SchemaOf<TSchemaLike>>;

/** Boundary representation. Runtime Types will lower to their underlying schema wire value. */
export type Wire<TSchemaLike> =
  SchemaOf<TSchemaLike> extends RuntimeTypeSchema<infer TInner>
    ? TypeofSchema<TInner>
    : TypeofSchema<SchemaOf<TSchemaLike>>;

/** Materialized in-memory representation, including generated Runtime Class instances. */
export type Runtime<TSchemaLike> = [RuntimeInstance<TSchemaLike>] extends [never]
  ? TypeofSchema<SchemaOf<TSchemaLike>>
  : RuntimeInstance<TSchemaLike>;
