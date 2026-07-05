import { type CompiledStream, compileStream, type StreamOptions } from "../compiler/stream.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import type { CompileCacheOptions } from "../runtime/cache/compile-cache.js";

/**
 * Creates a progressive validating stream for a schema — validation that
 * runs while the payload is still arriving.
 *
 * Chunks may cut tokens anywhere (mid-string, mid-number, even mid-UTF-8
 * sequence); an internal boundary FSM reassembles them. Array roots
 * validate element-by-element and abort on the first invalid item; object
 * roots are structurally supervised per chunk and fully validated on
 * `end()`; `format: "ndjson"` validates one document per line.
 *
 * @example
 * ```ts
 * const stream = JIT.stream(JIT.array(Event), {
 *   onItem: (event) => queue.push(event),
 * });
 *
 * socket.on("data", (chunk) => stream.write(chunk)); // throws on first bad item
 * socket.on("end", () => stream.end());
 * ```
 */
export function stream<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: StreamOptions & CompileCacheOptions
): CompiledStream<ATS.InferSchema<TSchema>> {
  return compileStream(unwrapSchema(schema), options);
}
