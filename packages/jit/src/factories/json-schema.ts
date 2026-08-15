import {
  compileJsonSchema,
  compileSchemaFromJson,
  type FromJsonSchemaOptions,
  type InferJsonSchema,
  type JsonSchemaDocument,
  type JsonSchemaNode,
  type ToJsonSchemaOptions,
} from "../compiler/json-schema/index.js";
import type * as ATS from "../core/ats/index.js";
import type { Builder, SchemaInput } from "../core/builder/index.js";
import { createBuilder, unwrapSchema } from "../core/builder/index.js";

/**
 * A schema built from a JSON Schema document. The document literal already
 * states the shape, so the builder is typed without repeating it.
 */
export type JsonSchemaBuilder<TNode> = Builder<ATS.TypeSchema<InferJsonSchema<TNode>>>;

export interface JsonSchemaNamespace {
  /**
   * Describes a schema as a JSON Schema document — what OpenAPI, form
   * builders and structured-output APIs consume.
   *
   * The document reports only what the compiled validator enforces; a type
   * with no JSON form is refused rather than approximated.
   *
   * @example
   * ```ts
   * JIT.jsonSchema.to(User);
   * JIT.jsonSchema.to(User, { target: "openapi-3.0", io: "input" });
   * ```
   */
  to<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: ToJsonSchemaOptions
  ): JsonSchemaDocument;
  /**
   * Builds a schema from a JSON Schema document, so a contract that arrives
   * as data becomes a first-class schema every compiled operation understands.
   *
   * Pass the document `as const` and the resulting schema is fully typed from
   * the literal — no duplicate type declaration.
   *
   * @example
   * ```ts
   * const User = JIT.jsonSchema.from({
   *   type: "object",
   *   properties: { name: { type: "string" }, age: { type: "number" } },
   *   required: ["name", "age"],
   * } as const);
   *
   * const isUser = JIT.validate.is(User); // (value) => value is { name: string; age: number }
   * ```
   */
  from<const TNode extends JsonSchemaNode>(document: TNode, options?: FromJsonSchemaOptions): JsonSchemaBuilder<TNode>;
}

/**
 * Both directions of the JSON Schema bridge. `to` is static data computed
 * once and inlined by AOT; `from` resolves at generation time, so the
 * document never reaches the bundle — only the specialized functions.
 */
export const jsonSchema: JsonSchemaNamespace = Object.freeze({
  to<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>, options?: ToJsonSchemaOptions) {
    return compileJsonSchema(unwrapSchema(schema), options);
  },
  from<const TNode extends JsonSchemaNode>(document: TNode, options?: FromJsonSchemaOptions) {
    return createBuilder(compileSchemaFromJson(document, options)) as unknown as JsonSchemaBuilder<TNode>;
  },
});
