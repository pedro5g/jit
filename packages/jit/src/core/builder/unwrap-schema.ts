import type { AnyTypeSchema } from "../ats/index.js";

/** Describes the JIT schema input contract used by the public API. */
export type SchemaInput<TSchema extends AnyTypeSchema = AnyTypeSchema> = TSchema | { readonly schema: TSchema };

/** Provides the JIT unwrap schema operation for the supplied input. */
export function unwrapSchema<TSchema extends AnyTypeSchema>(schemaLike: SchemaInput<TSchema>): TSchema {
  return "schema" in schemaLike ? schemaLike.schema : schemaLike;
}
