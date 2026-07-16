import type * as ATS from "../core/ats/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { emitSerialize } from "./serialize/emit-serialize.js";

/**
 * A compiled shape-specialized JSON serializer.
 *
 * @template T - The value type described by the schema.
 * @param value - The value to serialize.
 * @returns The JSON string.
 */
export type Serialize<T = unknown> = (value: T) => string;

/**
 * Emits the JavaScript source of a compiled JSON serializer.
 *
 * @param schema - The schema driving the emitted shape.
 * @returns The generated serializer source.
 */
export function emitSerializeSource(schema: ATS.AnyTypeSchema): string {
  return emitSerialize(schema);
}

/**
 * Compiles a shape-specialized `stringify` for a schema.
 *
 * JSON keys and structural punctuation are baked into the source as static
 * string fragments; only leaf values are read at runtime, and native
 * `JSON.stringify` is used solely for string escaping. Undefined optional
 * fields are omitted exactly like `JSON.stringify`.
 *
 * @throws JITError with code `UNSUPPORTED_SCHEMA` for schemas JSON cannot
 * represent (bigint, symbol, Map, Set, ...).
 */
export function compileSerialize<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options?: CompileCacheOptions
): Serialize<ATS.TypeofSchema<TSchema>> {
  return getCompileCached(
    schema,
    "serialize",
    () => {
      const compiled = globalThis.Function(`return ${emitSerialize(schema)};`)() as Serialize<
        ATS.TypeofSchema<TSchema>
      >;

      registerArtifact(compiled as object, {
        kind: "operation",
        schema,
        op: "stringify",
      });
      return compiled;
    },
    options
  );
}
