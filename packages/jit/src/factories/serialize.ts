import { type CodecCompileOptions, type CompiledCodec, compileCodec } from "../compiler/codec.js";
import { compileSerialize, type Serialize } from "../compiler/serialize.js";
import { compileValidator } from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import type { Builder, SchemaInput } from "../core/builder/index.js";
import { createBuilder, unwrapSchema } from "../core/builder/index.js";
import type { CompileCacheOptions } from "../runtime/cache/compile-cache.js";

/**
 * A compiled JSON boundary for one schema: shape-specialized `stringify`
 * plus a `parse` that validates (and transforms) after `JSON.parse`.
 */
export interface CompiledSerializer<T> {
  readonly stringify: (value: T) => string;
  readonly parse: (json: string) => T;
}

/**
 * Compiles the JSON boundary for a schema.
 *
 * @example
 * ```ts
 * const Users = JIT.serializer(User);
 *
 * res.end(Users.stringify(user));      // static keys, no reflection
 * const user = Users.parse(rawBody);   // JSON.parse + compiled validation
 * ```
 */
export function serializer<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: CompileCacheOptions
): CompiledSerializer<ATS.InferSchema<TSchema>> {
  const unwrapped = unwrapSchema(schema);
  const stringify: Serialize<ATS.InferSchema<TSchema>> = compileSerialize(unwrapped, options);
  const validate = compileValidator(unwrapped, options);

  return {
    stringify,
    parse: (json) => validate.parse(JSON.parse(json)),
  };
}

/**
 * Compiles a schema-driven binary codec (`encode` / `encodeInto` / `decode`).
 *
 * @example
 * ```ts
 * const Events = JIT.codec(Event, { version: 2 });
 *
 * socket.send(Events.encode(event));           // compact, no field names
 * const written = Events.encodeInto(event, scratchBuffer);
 * const event = Events.decode(message.data);   // exact reconstruction
 * ```
 */
export interface ValueCodecOptions<TInput extends ATS.AnyTypeSchema, TOutput extends ATS.AnyTypeSchema> {
  readonly decode: (value: ATS.InferSchema<TInput>) => ATS.InferSchema<TOutput>;
  readonly encode: (value: ATS.InferSchema<TOutput>) => ATS.InferSchema<TInput>;
}

export function codec<TInput extends ATS.AnyTypeSchema, TOutput extends ATS.AnyTypeSchema>(
  input: SchemaInput<TInput>,
  output: SchemaInput<TOutput>,
  options: ValueCodecOptions<TInput, TOutput>
): Builder<ATS.CodecSchema<TInput, TOutput>>;

export function codec<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: CodecCompileOptions
): CompiledCodec<ATS.InferSchema<TSchema>>;

export function codec<TSchema extends ATS.AnyTypeSchema, TOutput extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  outputOrOptions?: SchemaInput<TOutput> | CodecCompileOptions,
  valueCodecOptions?: ValueCodecOptions<TSchema, TOutput>
): CompiledCodec<ATS.InferSchema<TSchema>> | Builder<ATS.CodecSchema<TSchema, TOutput>> {
  if (valueCodecOptions !== undefined && outputOrOptions !== undefined && isSchemaInput(outputOrOptions)) {
    const input = unwrapSchema(schema);
    const output = unwrapSchema(outputOrOptions);

    return createBuilder(
      createSchema(TypeName.codec, {
        input,
        output,
        decode: valueCodecOptions.decode,
        encode: valueCodecOptions.encode,
      }) as ATS.CodecSchema<TSchema, TOutput>
    );
  }

  return compileCodec(unwrapSchema(schema), outputOrOptions as CodecCompileOptions | undefined);
}

function isSchemaInput(value: unknown): value is SchemaInput {
  return typeof value === "object" && value !== null && ("schema" in value || "type" in value);
}
