import { type AnyTypeSchema, createSchema, type SchemaShape, TypeName } from "../../core/ats/index.js";
import type { ObjectBuilder } from "../../core/builder/index.js";
import { createBuilder, type SchemaInput, unwrapSchema } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";

type BuilderShape<TShape extends Record<string, SchemaInput>> = {
  readonly [TKey in keyof TShape]: TShape[TKey] extends { readonly schema: infer TSchema extends AnyTypeSchema }
    ? TSchema
    : TShape[TKey] extends AnyTypeSchema
      ? TShape[TKey]
      : never;
};

/**
 * Creates an object schema builder from a property shape.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const User = JIT.object({ id: JIT.int(), name: JIT.string().min(1) });
 * const parseUser = JIT.validate.parse(User);
 * parseUser({ id: 1, name: "Ada" });
 * ```
 *
 * @template TShape - The schema-input shape used to infer object properties.
 * @param shape - Object properties mapped to schemas or builders.
 * @param message - Optional default message for failures in this schema.
 * @returns A builder wrapping an object schema.
 */
export function object<const TShape extends Record<string, SchemaInput>>(
  shape: TShape,
  message?: ValidationMessage
): ObjectBuilder<BuilderShape<TShape>> {
  const props: Record<string, AnyTypeSchema> = {};

  for (const key in shape) {
    props[key] = unwrapSchema(shape[key]);
  }

  return /* @__PURE__ */ createBuilder(
    createSchema(
      TypeName.object,
      withValidationMessage(
        {
          props: props as BuilderShape<TShape> & SchemaShape,
          unknownKeys: undefined,
          catchall: undefined,
          checks: [],
        },
        message
      )
    )
  ) as ObjectBuilder<BuilderShape<TShape>>;
}
