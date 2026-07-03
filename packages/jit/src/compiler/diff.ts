import type * as ATS from "../core/ats/index.js";
import { buildDiffIR } from "./diff/build-diff-ir.js";
import { emitDiff, emitDiffBody } from "./diff/emit-diff.js";

export type DiffChange<T = unknown> =
  | { readonly type: "add"; readonly path: readonly PropertyKey[]; readonly value: T }
  | { readonly type: "remove"; readonly path: readonly PropertyKey[] }
  | { readonly type: "update"; readonly path: readonly PropertyKey[]; readonly value: T };

export type Diff<T = unknown> = (left: T, right: T) => DiffChange[];

export function emitDiffSource(schema: ATS.AnyTypeSchema): string {
  return emitDiff(buildDiffIR(schema));
}

export function compileDiff<TSchema extends ATS.AnyTypeSchema>(schema: TSchema): Diff<ATS.Infer<TSchema>> {
  const program = buildDiffIR(schema);
  const body = emitDiffBody(program);

  return globalThis.Function(`return function diff(left, right) {\n${body}\n};`)() as Diff<ATS.Infer<TSchema>>;
}
