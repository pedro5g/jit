import { type CacheKeyForm, compileCacheKey, resolveCacheKeyDescriptor } from "../compiler/cache-key.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { combineHash } from "../runtime/hash/hash-combine.js";
import { hashBigInt, hashBoolean, hashNumber, hashString, hashUnknown } from "../runtime/hash/hash-primitives.js";
import type { ProjectablePath } from "./project.js";

/** The helpers a compiled hash body calls, bound the way `compileUncachedHash` binds them. */
const HASH_HELPERS = Object.freeze({
  __combineHash: combineHash,
  __hashNumber: hashNumber,
  __hashString: hashString,
  __hashBoolean: hashBoolean,
  __hashBigInt: hashBigInt,
  __hashUnknown: hashUnknown,
});

export interface CacheKeyBuilder<TValue, TKey> {
  /** Builds the key from the named fields, in the order given. */
  select<const TPaths extends readonly ProjectablePath<TValue>[]>(...paths: TPaths): (value: TValue) => TKey;
}

/**
 * Builds a cache key from a few identifying fields.
 *
 * The usual answer is `JSON.stringify({ tenantId, id, version })`, which walks
 * the value, quotes and escapes every string, and allocates an intermediate
 * object to describe a selection that was already known. Reading the named
 * fields directly skips all three.
 *
 * `string` produces a readable, stable key; `hash` produces a 32-bit integer
 * and never builds a string at all.
 */
export const cacheKey = Object.assign(
  <TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): CacheKeyBuilder<ATS.TypeofSchema<TSchema>, string> => builder(schema, "string"),
  {
    string: <TSchema extends ATS.AnyTypeSchema>(
      schema: SchemaInput<TSchema>
    ): CacheKeyBuilder<ATS.TypeofSchema<TSchema>, string> => builder(schema, "string"),
    hash: <TSchema extends ATS.AnyTypeSchema>(
      schema: SchemaInput<TSchema>
    ): CacheKeyBuilder<ATS.TypeofSchema<TSchema>, number> => builder(schema, "hash"),
  }
);

function builder<TValue, TKey>(
  schema: SchemaInput<ATS.AnyTypeSchema>,
  form: CacheKeyForm
): CacheKeyBuilder<TValue, TKey> {
  const unwrapped = unwrapSchema(schema);

  return Object.freeze({
    select: (...paths: string[]) =>
      compileCacheKey<TValue, TKey>(unwrapped, resolveCacheKeyDescriptor(unwrapped, paths, form), HASH_HELPERS),
  }) as CacheKeyBuilder<TValue, TKey>;
}
