import type * as ATS from "../core/ats/index.js";
import { buildCloneIR } from "./clone/build-clone-ir.js";
import { emitClone, emitCloneBody } from "./clone/emit-clone.js";

export type Clone<T = unknown> = (value: T) => T;

export function emitCloneSource(schema: ATS.AnyTypeSchema): string {
  return emitClone(buildCloneIR(schema));
}

export function compileClone<TSchema extends ATS.AnyTypeSchema>(schema: TSchema): Clone<ATS.Infer<TSchema>> {
  const program = buildCloneIR(schema);
  const body = emitCloneBody(program);

  return globalThis.Function(`return function clone(value) {\n${body}\n};`)() as Clone<ATS.Infer<TSchema>>;
}
