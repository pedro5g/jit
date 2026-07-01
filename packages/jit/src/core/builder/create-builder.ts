import * as Transform from "../../transforms/index.js";
import { type AnyTypeSchema, type ObjectSchema, type SchemaShape, TypeName } from "../ats/index.js";
import type { AnyBuilder, Builder, ObjectBuilder } from "./types.js";
import { type SchemaInput, unwrapSchema } from "./unwrap-schema.js";

type RuntimeBuilder = {
  schema: AnyTypeSchema;
};

const baseBuilderPrototype = {
  optional(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.optional(this.schema));
  },

  nullable(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.nullable(this.schema));
  },

  nullish(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.nullish(this.schema));
  },

  readonly(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.readonly(this.schema));
  },

  promise(this: RuntimeBuilder): AnyBuilder {
    return createBuilder(Transform.promise(this.schema));
  },

  default(this: RuntimeBuilder, defaultValue: unknown): AnyBuilder {
    return createBuilder(Transform.default(this.schema, defaultValue));
  },

  brand(this: RuntimeBuilder, brandName: string): AnyBuilder {
    return createBuilder(Transform.brand(this.schema, brandName));
  },

  pipe(this: RuntimeBuilder, transform: (value: unknown) => unknown): AnyBuilder {
    return createBuilder(Transform.pipe(this.schema, transform));
  },
};

const objectBuilderPrototype = {
  ...baseBuilderPrototype,

  partial(this: RuntimeBuilder): ObjectBuilder<SchemaShape> {
    return createBuilder(Transform.partial(this.schema as ObjectSchema<SchemaShape>));
  },

  required(this: RuntimeBuilder): ObjectBuilder<SchemaShape> {
    return createBuilder(Transform.required(this.schema as ObjectSchema<SchemaShape>));
  },

  pick(this: RuntimeBuilder, keys: readonly string[]): ObjectBuilder<SchemaShape> {
    return createBuilder(Transform.pick(this.schema as ObjectSchema<SchemaShape>, keys));
  },

  omit(this: RuntimeBuilder, keys: readonly string[]): ObjectBuilder<SchemaShape> {
    return createBuilder(Transform.omit(this.schema as ObjectSchema<SchemaShape>, keys));
  },

  extend(this: RuntimeBuilder, extension: Record<string, SchemaInput>): ObjectBuilder<SchemaShape> {
    const props: Record<string, AnyTypeSchema> = {};

    for (const key in extension) {
      props[key] = unwrapSchema(extension[key]);
    }

    return createBuilder(Transform.extend(this.schema as ObjectSchema<SchemaShape>, props));
  },

  merge(
    this: RuntimeBuilder,
    right: ObjectBuilder<SchemaShape> | ObjectSchema<SchemaShape>
  ): ObjectBuilder<SchemaShape> {
    return createBuilder(Transform.merge(this.schema as ObjectSchema<SchemaShape>, unwrapSchema(right)));
  },
};

export function createBuilder<TSchema extends AnyTypeSchema>(schema: TSchema): Builder<TSchema> {
  const prototype = schema.type === TypeName.object ? objectBuilderPrototype : baseBuilderPrototype;
  const builder = Object.create(prototype) as RuntimeBuilder;
  builder.schema = schema;
  return builder as Builder<TSchema>;
}
