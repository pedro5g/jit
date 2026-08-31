import {
  type AnyTypeSchema,
  type ArraySchema,
  createSchema,
  type MapSchema,
  type RecordSchema,
  type SetSchema,
  type TupleSchema,
  TypeName,
} from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder, type SchemaInput, unwrapSchema } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";

/**
 * Creates an array schema builder.
 *
 * @template TElement - The element schema type.
 * @param element - The schema or builder for each array element.
 * @returns A builder wrapping an array schema.
 */
export function array<TElement extends AnyTypeSchema>(
  element: SchemaInput<TElement>,
  message?: ValidationMessage
): Builder<ArraySchema<TElement>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(
      TypeName.array,
      withValidationMessage({ element: unwrapSchema(element) }, message)
    ) as ArraySchema<TElement>
  );
}

/**
 * Creates a Set schema builder.
 *
 * @template TElement - The element schema type.
 * @param element - The schema or builder for each Set element.
 * @returns A builder wrapping a Set schema.
 */
export function set<TElement extends AnyTypeSchema>(
  element: SchemaInput<TElement>,
  message?: ValidationMessage
): Builder<SetSchema<TElement>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.set, withValidationMessage({ element: unwrapSchema(element) }, message))
  );
}

/**
 * Creates a Map schema builder.
 *
 * @template TKey - The key schema type.
 * @template TValue - The value schema type.
 * @param key - The schema or builder for Map keys.
 * @param value - The schema or builder for Map values.
 * @returns A builder wrapping a Map schema.
 */
export function map<TKey extends AnyTypeSchema, TValue extends AnyTypeSchema>(
  key: SchemaInput<TKey>,
  value: SchemaInput<TValue>,
  message?: ValidationMessage
): Builder<MapSchema<TKey, TValue>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.map, withValidationMessage({ key: unwrapSchema(key), value: unwrapSchema(value) }, message))
  );
}

/**
 * Creates a record schema builder.
 *
 * @template TKey - The key schema type.
 * @template TValue - The value schema type.
 * @param key - The schema or builder for record keys.
 * @param value - The schema or builder for record values.
 * @returns A builder wrapping a record schema.
 */
export function record<TKey extends AnyTypeSchema, TValue extends AnyTypeSchema>(
  key: SchemaInput<TKey>,
  value: SchemaInput<TValue>,
  message?: ValidationMessage
): Builder<RecordSchema<TKey, TValue>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(
      TypeName.record,
      withValidationMessage({ key: unwrapSchema(key), value: unwrapSchema(value) }, message)
    )
  );
}

/**
 * Creates a tuple schema builder.
 *
 * @template TItems - The tuple item schema inputs.
 * @param items - The tuple item schemas or builders.
 * @returns A builder wrapping a tuple schema.
 */
export function tuple<const TItems extends readonly SchemaInput[]>(
  ...items: TItems
): Builder<TupleSchema<UnwrapTupleItems<TItems>>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.tuple, {
      items: items.map(unwrapSchema) as unknown as UnwrapTupleItems<TItems>,
      rest: undefined,
    })
  );
}

type UnwrapTupleItems<TItems extends readonly SchemaInput[]> = {
  readonly [TKey in keyof TItems]: TItems[TKey] extends SchemaInput<infer TSchema extends AnyTypeSchema>
    ? TSchema
    : never;
};
