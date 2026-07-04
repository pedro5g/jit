import type * as ATS from "../core/ats/index.js";
import { getIndex } from "../runtime/index/index.js";
import type { Equal } from "../shared/index.js";
import { emitEqual, emitEqualBody } from "./emitter/emit-equal.js";
import { compileHash } from "./hash.js";
import { buildEqualIR } from "./ir/builders/build-equal-ir.js";
import { optimizeIR } from "./ir/optimizer/optimize-ir.js";
import { resolveEqualStrategy } from "./strategy/resolve-strategy.js";

/**
 * Emits the optimized JavaScript source for a schema-aware equality function.
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
 */
export function compileEqual<TSchema extends ATS.AnyTypeSchema>(schema: TSchema): Equal<ATS.Infer<TSchema>> {
  const strategy = resolveEqualStrategy(schema);
  const program = optimizeIR(buildEqualIR(schema, strategy));
  const body = emitEqualBody(program);
  const hash = strategy.hash.type === "hash-short-circuit" ? compileHash(schema) : undefined;

  return globalThis.Function(
    "__hash",
    "__getIndex",
    `return function equal(l, r) {\n${body}\n};`
  )(hash, getIndex) as Equal<ATS.Infer<TSchema>>;
}

/**
 * Public ergonomic alias for `compileEqual`.
 */
export const equal = compileEqual;
