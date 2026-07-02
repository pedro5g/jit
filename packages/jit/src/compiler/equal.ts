import type * as ATS from "../core/ats/index.js";
import type { Equal } from "../shared/index.js";
import { emitEqual, emitEqualBody } from "./emitter/emit-equal.js";
import { buildEqualIR } from "./ir/builders/build-equal-ir.js";
import { optimizeIR } from "./ir/optimizer/optimize-ir.js";
import { resolveEqualStrategy } from "./strategy/resolve-strategy.js";

export function emitEqualSource(schema: ATS.AnyTypeSchema): string {
  const strategy = resolveEqualStrategy(schema);
  return emitEqual(optimizeIR(buildEqualIR(schema, strategy)));
}

export function compileEqual<TSchema extends ATS.AnyTypeSchema>(schema: TSchema): Equal<ATS.Infer<TSchema>> {
  const strategy = resolveEqualStrategy(schema);
  const program = optimizeIR(buildEqualIR(schema, strategy));
  const body = emitEqualBody(program);

  return globalThis.Function("l", "r", body) as Equal<ATS.Infer<TSchema>>;
}
