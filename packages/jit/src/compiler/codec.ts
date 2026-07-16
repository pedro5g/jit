import type * as ATS from "../core/ats/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { type CodecEmitOptions, emitCodec } from "./codec/emit-codec.js";

/**
 * A compiled schema-specialized binary codec.
 *
 * @template T - The value type described by the schema.
 */
export interface CompiledCodec<T> {
  /** Serializes the value into a compact schema-driven binary layout. */
  readonly encode: (value: T) => Uint8Array;
  /**
   * Writes the value directly into a caller-provided buffer (starting at
   * byte 0) and returns the number of bytes written. Throws `RangeError`
   * when the buffer is too small — nothing is silently truncated.
   */
  readonly encodeInto: (value: T, target: Uint8Array) => number;
  /** Reconstructs the value from bytes produced by `encode`/`encodeInto`. */
  readonly decode: (bytes: Uint8Array | ArrayBuffer) => T;
}

/** Compile options for {@link compileCodec}: cacheability + wire version. */
export interface CodecCompileOptions extends CompileCacheOptions, CodecEmitOptions {}

/**
 * Emits the JavaScript source of a compiled binary codec.
 *
 * @param schema - The schema defining the wire layout.
 * @param options - Optional wire format version (byte 0 of every message).
 * @returns The generated codec source (`encode` + `encodeInto` + `decode`).
 */
export function emitCodecSource(schema: ATS.AnyTypeSchema, options?: CodecEmitOptions): string {
  return emitCodec(schema, options).source;
}

/**
 * Compiles a binary codec for a schema — gRPC-style wire speed in plain
 * JavaScript.
 *
 * Both sides share the schema, so the wire carries no field names or tags.
 * Byte 0 is the schema version (`options.version`, default 1): decoding a
 * buffer written under a different version fails loudly instead of
 * silently corrupting on schema drift. Numbers/dates are float64 LE, `int`
 * schemas int32 (range-checked at encode), bigints int64, booleans and
 * enums one byte, strings a u32 byte length plus UTF-8 written via
 * `TextEncoder.encodeInto`, object optionals a 2-bit-per-field bitmask,
 * collections a u32 count plus entries, unions one tag byte plus the
 * matched option, literals zero bytes.
 *
 * @throws JITError with code `UNSUPPORTED_SCHEMA` for schema kinds a rigid
 * binary layout cannot represent (`any`, `unknown`, functions, ...).
 */
export function compileCodec<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options?: CodecCompileOptions
): CompiledCodec<ATS.TypeofSchema<TSchema>> {
  const version = options?.version ?? 1;

  return getCompileCached(
    schema,
    `codec:v${version}`,
    () => {
      const emitted = emitCodec(schema, { version });

      const compiled = globalThis.Function(
        ...emitted.bindingNames,
        emitted.source
      )(...emitted.bindingValues) as CompiledCodec<ATS.TypeofSchema<TSchema>>;

      registerArtifact(compiled as object, {
        kind: "operation",
        schema,
        op: "codec",
      });
      return compiled;
    },
    options
  );
}
