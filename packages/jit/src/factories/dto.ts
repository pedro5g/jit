import { type AnyTypeSchema, createSchema } from "../core/ats/index.js";
import type { Builder, SchemaInput } from "../core/builder/index.js";
import { createBuilder, unwrapSchema } from "../core/builder/index.js";

/**
 * Marks a schema as an application boundary without creating a second DTO
 * compiler, execution IR, or operation facade. The result is an ordinary
 * schema builder and therefore works with every capability namespace.
 */
export function dto<TSchema extends AnyTypeSchema>(schema: SchemaInput<TSchema>): Builder<TSchema> {
  const unwrapped = unwrapSchema(schema);
  const annotations = unwrapped.annotations as
    | {
        readonly hints?: unknown;
        readonly metadata?: {
          readonly title?: string;
          readonly description?: string;
          readonly deprecated?: boolean;
          readonly examples?: readonly unknown[];
          readonly tags?: readonly string[];
          readonly custom?: Readonly<Record<string, unknown>>;
        };
      }
    | undefined;

  return createBuilder(
    createSchema(unwrapped.type, unwrapped.def, {
      ...annotations,
      metadata: {
        ...annotations?.metadata,
        custom: { ...annotations?.metadata?.custom, dto: true },
      },
    }) as TSchema
  );
}
