import type * as ATS from "../core/ats/index.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { emitCodec } from "./codec/emit-codec.js";

/**
 * A compiled schema-specialized binary codec.
 *
 * @template T - The value type described by the schema.
 */
export interface CompiledCodec<T> {
  /** Serializes the value into a compact schema-driven binary layout. */
  readonly encode: (value: T) => Uint8Array;
  /** Reconstructs the value from bytes produced by `encode`. */
  readonly decode: (bytes: Uint8Array | ArrayBuffer) => T;
}

/**
 * Emits the JavaScript source of a compiled binary codec.
 *
 * @param schema - The schema defining the wire layout.
 * @returns The generated codec source (`encode` + `decode`).
 */
export function emitCodecSource(schema: ATS.AnyTypeSchema): string {
  return emitCodec(schema).source;
}

/**
 * Compiles a binary codec for a schema — gRPC-style wire speed in plain
 * JavaScript.
 *
 * Both sides share the schema, so the wire carries no field names or tags:
 * numbers/dates are float64 LE, booleans and enums one byte, strings a u32
 * byte length plus UTF-8, optional/nullable one presence byte, arrays a u32
 * count plus elements, objects field-by-field in schema order, literals zero
 * bytes. Encoding sizes the buffer exactly in one pass and writes in a
 * second — no growth reallocations.
 *
 * @throws JITError with code `UNSUPPORTED_SCHEMA` for schema kinds outside
 * the v1 wire format (unions, records, Map/Set, bigint, ...).
 */
export function compileCodec<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options?: CompileCacheOptions
): CompiledCodec<ATS.InferSchema<TSchema>> {
  return getCompileCached(
    schema,
    "codec",
    () => {
      const emitted = emitCodec(schema);

      return globalThis.Function(...emitted.bindingNames, emitted.source)(...emitted.bindingValues) as CompiledCodec<
        ATS.InferSchema<TSchema>
      >;
    },
    options
  );
}
