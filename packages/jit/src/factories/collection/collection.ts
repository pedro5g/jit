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

export function array<TElement extends AnyTypeSchema>(element: SchemaInput<TElement>): Builder<ArraySchema<TElement>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.array, {
      element: unwrapSchema(element),
    })
  );
}

export function set<TElement extends AnyTypeSchema>(element: SchemaInput<TElement>): Builder<SetSchema<TElement>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.set, {
      element: unwrapSchema(element),
    })
  );
}

export function map<TKey extends AnyTypeSchema, TValue extends AnyTypeSchema>(
  key: SchemaInput<TKey>,
  value: SchemaInput<TValue>
): Builder<MapSchema<TKey, TValue>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.map, {
      key: unwrapSchema(key),
      value: unwrapSchema(value),
    })
  );
}

export function record<TKey extends AnyTypeSchema, TValue extends AnyTypeSchema>(
  key: SchemaInput<TKey>,
  value: SchemaInput<TValue>
): Builder<RecordSchema<TKey, TValue>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.record, {
      key: unwrapSchema(key),
      value: unwrapSchema(value),
    })
  );
}

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
