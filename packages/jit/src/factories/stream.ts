import { type CompiledStream, compileStream, type StreamOptions } from "../compiler/stream.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import type { CompileCacheOptions } from "../runtime/cache/compile-cache.js";

type ArrayItem<TValue> = TValue extends readonly (infer TItem)[] ? TItem : never;

type JsonStreamOptions<TItem> = Omit<StreamOptions<TItem>, "format"> & CompileCacheOptions;

export interface StreamNamespace {
  <TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options: StreamOptions<ATS.TypeofSchema<TSchema>> & CompileCacheOptions & { readonly format: "ndjson" }
  ): CompiledStream<ATS.TypeofSchema<TSchema>[], ATS.TypeofSchema<TSchema>>;
  <TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: StreamOptions<ArrayItem<ATS.TypeofSchema<TSchema>>> & CompileCacheOptions & { readonly format?: "json" }
  ): CompiledStream<ATS.TypeofSchema<TSchema>, ArrayItem<ATS.TypeofSchema<TSchema>>>;
  json<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: JsonStreamOptions<ArrayItem<ATS.TypeofSchema<TSchema>>>
  ): CompiledStream<ATS.TypeofSchema<TSchema>, ArrayItem<ATS.TypeofSchema<TSchema>>>;
  ndjson<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: JsonStreamOptions<ATS.TypeofSchema<TSchema>>
  ): CompiledStream<ATS.TypeofSchema<TSchema>[], ATS.TypeofSchema<TSchema>>;
}

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
function streamFactory<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: StreamOptions & CompileCacheOptions
): CompiledStream<unknown> {
  return compileStream(unwrapSchema(schema), options as never);
}

/** Callable for compatibility, with explicit JSON and NDJSON transport specializations. */
export const stream = Object.assign(streamFactory, {
  json<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: JsonStreamOptions<ArrayItem<ATS.TypeofSchema<TSchema>>>
  ) {
    return compileStream(unwrapSchema(schema), { ...options, format: "json" });
  },
  ndjson<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: JsonStreamOptions<ATS.TypeofSchema<TSchema>>
  ) {
    return compileStream(unwrapSchema(schema), { ...options, format: "ndjson" });
  },
}) as unknown as StreamNamespace;
