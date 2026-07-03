import type * as ATS from "../core/ats/index.js";
import { buildUpdateIR } from "./update/build-update-ir.js";
import { emitUpdate, emitUpdateBody } from "./update/emit-update.js";

export type UpdatePatch<T> = T extends readonly (infer TItem)[]
  ? (UpdatePatch<TItem> | undefined)[]
  : T extends Date
    ? Date | undefined
    : T extends Set<unknown>
      ? T | undefined
      : T extends Map<unknown, unknown>
        ? T | undefined
        : T extends object
          ? { readonly [TKey in keyof T]?: UpdatePatch<T[TKey]> }
          : T | undefined;

export type Update<T = unknown> = (value: T, patch: UpdatePatch<T>) => T;

export function emitUpdateSource(schema: ATS.AnyTypeSchema): string {
  return emitUpdate(buildUpdateIR(schema));
}

export function compileUpdate<TSchema extends ATS.AnyTypeSchema>(schema: TSchema): Update<ATS.Infer<TSchema>> {
  const program = buildUpdateIR(schema);
  const body = emitUpdateBody(program);

  return globalThis.Function(`return function update(value, patch) {\n${body}\n};`)() as Update<ATS.Infer<TSchema>>;
}
