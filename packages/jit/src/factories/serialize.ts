import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import type { Builder, SchemaInput } from "../core/builder/index.js";
import { createBuilder, unwrapSchema } from "../core/builder/index.js";

/**
 * Describes the JIT value codec options contract used by the public API.
 *
 * @example
 * ```ts
 * const Input = JIT.string();
 * const Output = JIT.date();
 * const options: JIT.ValueCodecOptions<typeof Input.schema, typeof Output.schema> = {
 *   decode: (value) => new Date(value),
 *   encode: (value) => value.toISOString(),
 * };
 * ```
 */
export interface ValueCodecOptions<TInput extends ATS.AnyTypeSchema, TOutput extends ATS.AnyTypeSchema> {
  readonly decode: (value: ATS.TypeofSchema<TInput>) => ATS.TypeofSchema<TOutput>;
  readonly encode: (value: ATS.TypeofSchema<TOutput>) => ATS.TypeofSchema<TInput>;
}

/**
 * Declares a two-way value conversion as part of the schema: the wire type
 * stays `input`, application code sees `output`. Binary transport is a
 * separate capability — `JIT.binary.encode` / `.decode` / `.codec`.
 *
 * @example
 * ```ts
 * const Timestamp = JIT.codec(JIT.iso.datetime(), JIT.date(), {
 *   decode: (text) => new Date(text),
 *   encode: (date) => date.toISOString(),
 * });
 * ```
 */
export function codec<TInput extends ATS.AnyTypeSchema, TOutput extends ATS.AnyTypeSchema>(
  input: SchemaInput<TInput>,
  output: SchemaInput<TOutput>,
  options: ValueCodecOptions<TInput, TOutput>
): Builder<ATS.CodecSchema<TInput, TOutput>> {
  return createBuilder(
    createSchema(TypeName.codec, {
      input: unwrapSchema(input),
      output: unwrapSchema(output),
      decode: options.decode,
      encode: options.encode,
    }) as ATS.CodecSchema<TInput, TOutput>
  );
}
