import { type AnyTypeSchema, createSchema, type SchemaShape, TypeName } from "../../core/ats/index.js";
import type { ObjectBuilder } from "../../core/builder/index.js";
import { createBuilder, type SchemaInput, unwrapSchema } from "../../core/builder/index.js";

type BuilderShape<TShape extends Record<string, SchemaInput>> = {
  readonly [TKey in keyof TShape]: TShape[TKey] extends SchemaInput<infer TSchema extends AnyTypeSchema>
    ? TSchema
    : never;
};

/**
 * Creates an object schema builder from a property shape.
 *
 * @template TShape - The schema-input shape used to infer object properties.
 * @param shape - Object properties mapped to schemas or builders.
 * @returns A builder wrapping an object schema.
 */
export function object<const TShape extends Record<string, SchemaInput>>(
  shape: TShape
): ObjectBuilder<BuilderShape<TShape>> {
  const props: Record<string, AnyTypeSchema> = {};

  for (const key in shape) {
    props[key] = unwrapSchema(shape[key]);
  }

  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.object, {
      props: props as BuilderShape<TShape> & SchemaShape,
      unknownKeys: undefined,
      catchall: undefined,
      checks: [],
    })
  ) as ObjectBuilder<BuilderShape<TShape>>;
}
