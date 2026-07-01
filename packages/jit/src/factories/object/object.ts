import { type AnyTypeSchema, createSchema, type SchemaShape, TypeName } from "../../core/ats/index.js";
import type { ObjectBuilder } from "../../core/builder/index.js";
import { createBuilder, type SchemaInput, unwrapSchema } from "../../core/builder/index.js";

type BuilderShape<TShape extends Record<string, SchemaInput>> = {
  readonly [TKey in keyof TShape]: TShape[TKey] extends SchemaInput<infer TSchema extends AnyTypeSchema>
    ? TSchema
    : never;
};

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
      checks: [],
    })
  ) as ObjectBuilder<BuilderShape<TShape>>;
}
