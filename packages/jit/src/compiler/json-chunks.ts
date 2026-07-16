import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitSerializeSource } from "./serialize.js";

export interface JsonChunksOptions {
  /** Approximate UTF-16 code-unit budget per emitted chunk. Defaults to 16 KiB. */
  readonly chunkBytes?: number;
}

export type StringifyChunks<T> = (value: T) => IterableIterator<string>;

export function emitStringifyChunksSource(schema: ATS.AnyTypeSchema, options: JsonChunksOptions = {}): string {
  const array = resolveWrappers(schema).base;

  if (array.type !== TypeName.array) {
    throw new JITError("UNSUPPORTED_SCHEMA", "json.stringifyChunks currently expects an array schema");
  }
  const chunkBytes = options.chunkBytes ?? 16 * 1024;
  if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) {
    throw new JITError("INVALID_OPERATION", "json.stringifyChunks chunkBytes must be a positive integer");
  }
  const stringifyElement = emitSerializeSource((array as ATS.ArraySchema).def.element);

  return `(function () {
const stringifyElement = ${stringifyElement};
function* stringifyChunks(value) {
  let chunk = "[";
  for (let i = 0, len = value.length; i < len; i++) {
    const part = (i === 0 ? "" : ",") + stringifyElement(value[i]);
    if (chunk.length !== 0 && chunk.length + part.length > ${chunkBytes}) {
      yield chunk;
      chunk = part;
    } else {
      chunk += part;
    }
  }
  chunk += "]";
  yield chunk;
}
return stringifyChunks;
})()`;
}

export function compileStringifyChunks<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  chunks: JsonChunksOptions = {},
  cache?: CompileCacheOptions
): StringifyChunks<ATS.TypeofSchema<TSchema>> {
  const chunkBytes = chunks.chunkBytes ?? 16 * 1024;

  return getCompileCached(
    schema,
    `stringifyChunks:${chunkBytes}`,
    () => {
      const source = emitStringifyChunksSource(schema, chunks);
      const compiled = globalThis.Function(`return ${source};`)() as StringifyChunks<ATS.TypeofSchema<TSchema>>;

      registerArtifact(compiled as object, {
        kind: "query",
        source,
        bindingNames: [],
        bindingValues: [],
      });
      return compiled;
    },
    cache
  );
}
