import type { AnyTypeSchema } from "../ats/index.js";

export type SchemaInput<TSchema extends AnyTypeSchema = AnyTypeSchema> = TSchema | { readonly schema: TSchema };

export function unwrapSchema<TSchema extends AnyTypeSchema>(schemaLike: SchemaInput<TSchema>): TSchema {
  return "schema" in schemaLike ? schemaLike.schema : schemaLike;
}
