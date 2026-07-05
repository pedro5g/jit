import type * as ATS from "../core/ats/index.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { getIndex } from "../runtime/index/index.js";
import { emitEqual, emitEqualBody } from "./emitter/emit-equal.js";
import { compileHash } from "./hash.js";
import { buildEqualIR } from "./ir/builders/build-equal-ir.js";
import { optimizeIR } from "./ir/optimizer/optimize-ir.js";
import { resolveEqualStrategy } from "./strategy/resolve-strategy.js";

/**
 * A compiled schema-aware equality function.
 *
 * @template T - The value type described by the schema.
 * @param left - The first value to compare.
 * @param right - The second value to compare.
 * @returns `true` when both values are equal according to the compiled schema.
 */
export type Equal<T = unknown> = (left: T, right: T) => boolean;

/**
 * Emits the optimized JavaScript source for a schema-aware equality function.
 *
 * @param schema - The schema used to build and optimize the equality IR.
 * @returns The complete JavaScript source for the generated equality function.
 */
export function emitEqualSource(schema: ATS.AnyTypeSchema): string {
  const strategy = resolveEqualStrategy(schema);
  return emitEqual(optimizeIR(buildEqualIR(schema, strategy)));
}

/**
 * Compiles a schema-aware equality function.
 *
 * The returned function is specialized for the supplied schema and avoids
 * interpreting schema nodes while comparing values.
 *
 * @template TSchema - The schema driving code generation and type inference.
 * @param schema - The schema used to compile the equality function.
 * @returns A specialized equality function for values inferred from `schema`.
 */
export function compileEqual<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options?: CompileCacheOptions
): Equal<ATS.Infer<TSchema>> {
  return getCompileCached(
    schema,
    "equal",
    () => {
      const strategy = resolveEqualStrategy(schema);
      const program = optimizeIR(buildEqualIR(schema, strategy));
      const body = emitEqualBody(program);
      const hash = strategy.hash.type === "hash-short-circuit" ? compileHash(schema, options) : undefined;

      return globalThis.Function(
        "__hash",
        "__getIndex",
        `return function equal(l, r) {\n${body}\n};`
      )(hash, getIndex) as Equal<ATS.Infer<TSchema>>;
    },
    options
  );
}

/**
 * Public ergonomic alias for `compileEqual`.
 *
 * @param schema - The schema used to compile the equality function.
 * @returns A specialized equality function for values inferred from `schema`.
 */
export const equal = compileEqual;
