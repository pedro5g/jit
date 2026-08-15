/**
 * Type-level JSON Schema reader.
 *
 * A JSON Schema literal already states the exact shape it describes, so
 * `jsonSchema.from(document)` can hand back a fully typed schema without the
 * caller writing the type twice. These conditional types walk the same
 * keywords the runtime builder reads, in the same order, which is what keeps
 * the inferred type and the compiled validator in agreement.
 *
 * Adding a keyword to the runtime builder means adding it here too; the pair
 * is the contract. Anything unread degrades to `unknown`, never to `any`.
 */

/** Widens a `readonly` literal document so `as const` inputs stay precise. */
export type InferJsonSchema<TNode> = TNode extends { readonly $ref: string }
  ? unknown
  : TNode extends { readonly const: infer TConst }
    ? TConst
    : TNode extends { readonly enum: readonly (infer TMember)[] }
      ? TMember
      : TNode extends { readonly anyOf: readonly (infer TOption)[] }
        ? InferJsonSchema<TOption>
        : TNode extends { readonly oneOf: readonly (infer TOption)[] }
          ? InferJsonSchema<TOption>
          : TNode extends { readonly allOf: readonly (infer TOption)[] }
            ? UnionToIntersection<InferJsonSchema<TOption>>
            : TNode extends { readonly nullable: true }
              ? InferJsonSchema<Omit<TNode, "nullable">> | null
              : TNode extends { readonly type: readonly (infer TType extends string)[] }
                ? InferPrimitiveUnion<TType, TNode>
                : TNode extends { readonly type: infer TType extends string }
                  ? InferPrimitive<TType, TNode>
                  : unknown;

type InferPrimitiveUnion<TType extends string, TNode> = TType extends string ? InferPrimitive<TType, TNode> : never;

type InferPrimitive<TType extends string, TNode> = TType extends "string"
  ? string
  : TType extends "number" | "integer"
    ? number
    : TType extends "boolean"
      ? boolean
      : TType extends "null"
        ? null
        : TType extends "array"
          ? InferArray<TNode>
          : TType extends "object"
            ? InferObject<TNode>
            : unknown;

type InferArray<TNode> = TNode extends { readonly prefixItems: readonly [...infer TItems] }
  ? InferTuple<TItems>
  : TNode extends { readonly items: readonly [...infer TItems] }
    ? InferTuple<TItems>
    : TNode extends { readonly items: infer TItem }
      ? InferJsonSchema<TItem>[]
      : unknown[];

type InferTuple<TItems extends readonly unknown[]> = {
  -readonly [TIndex in keyof TItems]: InferJsonSchema<TItems[TIndex]>;
};

type InferObject<TNode> = TNode extends { readonly properties: infer TProperties }
  ? Simplify<
      {
        -readonly [TKey in keyof TProperties as TKey extends RequiredKeys<TNode> ? TKey : never]: InferJsonSchema<
          TProperties[TKey]
        >;
      } & {
        -readonly [TKey in keyof TProperties as TKey extends RequiredKeys<TNode> ? never : TKey]?: InferJsonSchema<
          TProperties[TKey]
        >;
      }
    >
  : TNode extends { readonly additionalProperties: infer TValue }
    ? TValue extends boolean
      ? Record<string, unknown>
      : Record<string, InferJsonSchema<TValue>>
    : Record<string, unknown>;

/** `required: []` and a missing `required` both mean "nothing is required". */
type RequiredKeys<TNode> = TNode extends { readonly required: readonly (infer TKey)[] } ? TKey : never;

type UnionToIntersection<TUnion> = (TUnion extends unknown ? (value: TUnion) => void : never) extends (
  value: infer TIntersection
) => void
  ? TIntersection
  : never;

/** Flattens the required/optional halves into one readable object type. */
type Simplify<TValue> = { [TKey in keyof TValue]: TValue[TKey] } & {};
