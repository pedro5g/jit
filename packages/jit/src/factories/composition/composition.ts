import {
  type AnyTypeSchema,
  createSchema,
  type DiscriminatedUnionSchema,
  type IntersectionSchema,
  type NotSchema,
  TypeName,
  type UnionSchema,
  type XorSchema,
} from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder, type SchemaInput, unwrapSchema } from "../../core/builder/index.js";

/**
 * Creates a union schema builder.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Identifier = JIT.union(JIT.string(), JIT.number());
 * JIT.validate.parse(Identifier)("user-1");
 * ```
 *
 * @template TOptions - The option schema inputs.
 * @param options - The schemas or builders accepted by the union.
 * @returns A builder wrapping a union schema.
 */
export function union<const TOptions extends readonly SchemaInput[]>(
  ...options: TOptions
): Builder<UnionSchema<UnwrapOptions<TOptions>>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.union, {
      options: options.map(unwrapSchema) as unknown as UnwrapOptions<TOptions>,
    })
  );
}

/**
 * Creates an exclusive-union schema builder; exactly one option must match.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Value = JIT.xor(JIT.string(), JIT.number());
 * JIT.validate.is(Value)(42); // true
 * ```
 */
export function xor<const TOptions extends readonly SchemaInput[]>(
  ...options: TOptions
): Builder<XorSchema<UnwrapOptions<TOptions>>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.xor, {
      options: options.map(unwrapSchema) as unknown as UnwrapOptions<TOptions>,
    })
  );
}

/**
 * Creates a schema that accepts values rejected by the inner schema.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const NotEmpty = JIT.not(JIT.literal(""));
 * JIT.validate.is(NotEmpty)("jit"); // true
 * ```
 */
export function not<TSchema extends AnyTypeSchema>(schema: SchemaInput<TSchema>): Builder<NotSchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.not, {
      innerType: unwrapSchema(schema),
    })
  );
}

/**
 * Creates an intersection schema builder.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Named = JIT.intersection(
 *   JIT.object({ id: JIT.number() }),
 *   JIT.object({ name: JIT.string() })
 * );
 * JIT.validate.is(Named)({ id: 1, name: "Ada" }); // true
 * ```
 *
 * @template TOptions - The option schema inputs.
 * @param options - The schemas or builders intersected by the schema.
 * @returns A builder wrapping an intersection schema.
 */
export function intersection<const TOptions extends readonly SchemaInput[]>(
  ...options: TOptions
): Builder<IntersectionSchema<UnwrapOptions<TOptions>>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.intersection, {
      options: options.map(unwrapSchema) as unknown as UnwrapOptions<TOptions>,
    })
  );
}

/**
 * Creates a discriminated-union schema builder.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Event = JIT.discriminatedUnion("kind", [
 *   JIT.object({ kind: JIT.literal("created"), id: JIT.number() }),
 *   JIT.object({ kind: JIT.literal("deleted"), id: JIT.number() }),
 * ]);
 * JIT.validate.is(Event)({ kind: "created", id: 1 }); // true
 * ```
 *
 * @template TDiscriminator - The discriminator property name.
 * @template TOptions - The option schema inputs.
 * @param discriminator - The property used to discriminate options.
 * @param options - The schemas or builders accepted by the union.
 * @returns A builder wrapping a discriminated-union schema.
 */
export function discriminatedUnion<const TDiscriminator extends string, const TOptions extends readonly SchemaInput[]>(
  discriminator: TDiscriminator,
  options: TOptions
): Builder<DiscriminatedUnionSchema<UnwrapOptions<TOptions>>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.discriminatedUnion, {
      discriminator,
      options: options.map(unwrapSchema) as unknown as UnwrapOptions<TOptions>,
    })
  );
}

type UnwrapOptions<TOptions extends readonly SchemaInput[]> = {
  readonly [TKey in keyof TOptions]: TOptions[TKey] extends SchemaInput<infer TSchema extends AnyTypeSchema>
    ? TSchema
    : never;
};
