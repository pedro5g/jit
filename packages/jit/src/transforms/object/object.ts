import type { OptionalSchema, SchemaShape } from "../../core/ats/index.js";
import {
  type AnyTypeSchema,
  createSchema,
  type EnumSchema,
  type ExtendShape,
  type MergeShape,
  type ObjectSchema,
  type ObjectUnknownKeys,
  type OmitShape,
  type PartialShape,
  type PickShape,
  type RequiredShape,
  TypeName,
} from "../../core/ats/index.js";
import { optional } from "../wrappers/index.js";

function isOptionalSchema(schema: AnyTypeSchema): schema is OptionalSchema<AnyTypeSchema> {
  return schema.type === TypeName.optional;
}

/**
 * Returns a new object schema with every prop wrapped in `optional`.
 * The input schema is not mutated.
 *
 * @template TShape - The object schema's property shape.
 * @param schema - The object schema to transform.
 * @returns A new object schema with every property wrapped in `optional`.
 */
export function partial<
  TShape extends SchemaShape,
  TUnknownKeys extends ObjectUnknownKeys,
  TCatchall extends AnyTypeSchema | undefined,
>(schema: ObjectSchema<TShape, TUnknownKeys, TCatchall>): ObjectSchema<PartialShape<TShape>, TUnknownKeys, TCatchall> {
  const props: Record<string, AnyTypeSchema> = {};

  for (const key in schema.def.props) {
    props[key] = optional(schema.def.props[key]);
  }

  return /* @__PURE__ */ createSchema(
    TypeName.object,
    {
      props: props as PartialShape<TShape>,
      unknownKeys: schema.def.unknownKeys,
      catchall: schema.def.catchall,
      checks: schema.def.checks,
    },
    schema.annotations
  );
}

/**
 * Returns a new object schema keeping only the selected props. Prop schemas
 * are reused by reference; the input schema is not mutated.
 *
 * @template TShape - The object schema's property shape.
 * @template TKeys - The keys to keep.
 * @param schema - The object schema to transform.
 * @param keys - The property keys to keep.
 * @returns A new object schema containing only `keys`.
 */
export function pick<
  TShape extends SchemaShape,
  TUnknownKeys extends ObjectUnknownKeys,
  TCatchall extends AnyTypeSchema | undefined,
  const TKeys extends readonly (keyof TShape)[],
>(
  schema: ObjectSchema<TShape, TUnknownKeys, TCatchall>,
  keys: TKeys
): ObjectSchema<PickShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall> {
  const props: Record<string, AnyTypeSchema> = {};

  for (const key of keys) {
    props[key as string] = schema.def.props[key];
  }

  return /* @__PURE__ */ createSchema(
    TypeName.object,
    {
      props: props as PickShape<TShape, TKeys[number]>,
      unknownKeys: schema.def.unknownKeys,
      catchall: schema.def.catchall,
      checks: schema.def.checks,
    },
    schema.annotations
  );
}

/**
 * Returns a new object schema without the selected props.
 * The input schema is not mutated.
 *
 * @template TShape - The object schema's property shape.
 * @template TKeys - The keys to drop.
 * @param schema - The object schema to transform.
 * @param keys - The property keys to drop.
 * @returns A new object schema without `keys`.
 */
export function omit<
  TShape extends SchemaShape,
  TUnknownKeys extends ObjectUnknownKeys,
  TCatchall extends AnyTypeSchema | undefined,
  const TKeys extends readonly (keyof TShape)[],
>(
  schema: ObjectSchema<TShape, TUnknownKeys, TCatchall>,
  keys: TKeys
): ObjectSchema<OmitShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall> {
  const props: Record<string, AnyTypeSchema> = {};
  const omitted = new Set<PropertyKey>(keys);

  for (const key in schema.def.props) {
    if (!omitted.has(key)) {
      props[key] = schema.def.props[key];
    }
  }

  return /* @__PURE__ */ createSchema(
    TypeName.object,
    {
      props: props as OmitShape<TShape, TKeys[number]>,
      unknownKeys: schema.def.unknownKeys,
      catchall: schema.def.catchall,
      checks: schema.def.checks,
    },
    schema.annotations
  );
}

/**
 * Returns a new object schema with the extension's props added; colliding
 * keys are overridden by the extension.
 *
 * @template TShape - The base object schema's property shape.
 * @template TExtension - The props being added.
 * @param schema - The object schema to extend.
 * @param extension - The props to add or override.
 * @returns A new object schema with the extension applied.
 */
export function extend<
  TShape extends SchemaShape,
  TUnknownKeys extends ObjectUnknownKeys,
  TCatchall extends AnyTypeSchema | undefined,
  TExtension extends SchemaShape,
>(
  schema: ObjectSchema<TShape, TUnknownKeys, TCatchall>,
  extension: TExtension
): ObjectSchema<ExtendShape<TShape, TExtension>, TUnknownKeys, TCatchall> {
  return /* @__PURE__ */ createSchema(
    TypeName.object,
    {
      props: {
        ...schema.def.props,
        ...extension,
      } as ExtendShape<TShape, TExtension>,
      unknownKeys: schema.def.unknownKeys,
      catchall: schema.def.catchall,
      checks: schema.def.checks,
    },
    schema.annotations
  );
}

/**
 * Merges two object schemas: right-hand props/unknownKeys/annotations win,
 * checks are concatenated.
 *
 * @template TLeft - The left object schema's shape.
 * @template TRight - The right object schema's shape (wins on collision).
 * @param left - The base object schema.
 * @param right - The object schema whose props win on collision.
 * @returns A new merged object schema.
 */
export function merge<
  TLeft extends SchemaShape,
  TRight extends SchemaShape,
  TLeftUnknownKeys extends ObjectUnknownKeys,
  TRightUnknownKeys extends ObjectUnknownKeys,
  TLeftCatchall extends AnyTypeSchema | undefined,
  TRightCatchall extends AnyTypeSchema | undefined,
>(
  left: ObjectSchema<TLeft, TLeftUnknownKeys, TLeftCatchall>,
  right: ObjectSchema<TRight, TRightUnknownKeys, TRightCatchall>
): ObjectSchema<
  MergeShape<TLeft, TRight>,
  MergeUnknownKeys<TLeftUnknownKeys, TRightUnknownKeys>,
  MergeCatchall<TLeftCatchall, TRightCatchall>
> {
  const unknownKeys = (right.def.unknownKeys ?? left.def.unknownKeys) as MergeUnknownKeys<
    TLeftUnknownKeys,
    TRightUnknownKeys
  >;
  const catchall = (right.def.catchall ?? left.def.catchall) as MergeCatchall<TLeftCatchall, TRightCatchall>;

  return /* @__PURE__ */ createSchema(
    TypeName.object,
    {
      props: {
        ...left.def.props,
        ...right.def.props,
      } as MergeShape<TLeft, TRight>,
      unknownKeys,
      catchall,
      checks: [...left.def.checks, ...right.def.checks],
    },
    right.annotations ?? left.annotations
  );
}

/**
 * Returns a new object schema with `optional` wrappers unwrapped; props that
 * are already required are reused by reference.
 *
 * @template TShape - The object schema's property shape.
 * @param schema - The object schema to transform.
 * @returns A new object schema with top-level `optional` wrappers removed.
 */
export function required<
  TShape extends SchemaShape,
  TUnknownKeys extends ObjectUnknownKeys,
  TCatchall extends AnyTypeSchema | undefined,
>(schema: ObjectSchema<TShape, TUnknownKeys, TCatchall>): ObjectSchema<RequiredShape<TShape>, TUnknownKeys, TCatchall> {
  const props: Record<string, AnyTypeSchema> = {};

  for (const key in schema.def.props) {
    const prop = schema.def.props[key];
    props[key] = isOptionalSchema(prop) ? prop.def.innerType : prop;
  }

  return /* @__PURE__ */ createSchema(
    TypeName.object,
    {
      props: props as RequiredShape<TShape>,
      unknownKeys: schema.def.unknownKeys,
      catchall: schema.def.catchall,
      checks: schema.def.checks,
    },
    schema.annotations
  );
}

export function strict<TShape extends SchemaShape, TCatchall extends AnyTypeSchema | undefined>(
  schema: ObjectSchema<TShape, ObjectUnknownKeys, TCatchall>
): ObjectSchema<TShape, "strict", TCatchall> {
  return withUnknownKeys(schema, "strict");
}

export function loose<TShape extends SchemaShape, TCatchall extends AnyTypeSchema | undefined>(
  schema: ObjectSchema<TShape, ObjectUnknownKeys, TCatchall>
): ObjectSchema<TShape, "passthrough", TCatchall> {
  return withUnknownKeys(schema, "passthrough");
}

export function catchall<TShape extends SchemaShape, TCatchall extends AnyTypeSchema>(
  schema: ObjectSchema<TShape, ObjectUnknownKeys, AnyTypeSchema | undefined>,
  catchallSchema: TCatchall
): ObjectSchema<TShape, "passthrough", TCatchall> {
  return /* @__PURE__ */ createSchema(
    TypeName.object,
    {
      props: schema.def.props,
      unknownKeys: "passthrough",
      catchall: catchallSchema,
      checks: schema.def.checks,
    },
    schema.annotations
  );
}

function keyOf<TShape extends SchemaShape>(
  schema: ObjectSchema<TShape, ObjectUnknownKeys, AnyTypeSchema | undefined>
): EnumSchema<KeyOfValues<TShape>> {
  const values: Record<string, string> = {};

  for (const key in schema.def.props) {
    values[key] = key;
  }

  return /* @__PURE__ */ createSchema(TypeName.enum, {
    values: values as KeyOfValues<TShape>,
  });
}

export { keyOf as keyof };

type KeyOfValues<TShape extends SchemaShape> = {
  readonly [TKey in Extract<keyof TShape, string>]: TKey;
};

type MergeUnknownKeys<
  TLeftUnknownKeys extends ObjectUnknownKeys,
  TRightUnknownKeys extends ObjectUnknownKeys,
> = TRightUnknownKeys extends undefined ? TLeftUnknownKeys : TRightUnknownKeys;

type MergeCatchall<
  TLeftCatchall extends AnyTypeSchema | undefined,
  TRightCatchall extends AnyTypeSchema | undefined,
> = TRightCatchall extends undefined ? TLeftCatchall : TRightCatchall;

function withUnknownKeys<
  TShape extends SchemaShape,
  TCatchall extends AnyTypeSchema | undefined,
  TUnknownKeys extends Exclude<ObjectUnknownKeys, undefined>,
>(
  schema: ObjectSchema<TShape, ObjectUnknownKeys, TCatchall>,
  unknownKeys: TUnknownKeys
): ObjectSchema<TShape, TUnknownKeys, TCatchall> {
  return /* @__PURE__ */ createSchema(
    TypeName.object,
    {
      props: schema.def.props,
      unknownKeys,
      catchall: schema.def.catchall,
      checks: schema.def.checks,
    },
    schema.annotations
  );
}
