import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
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
  assertUpdateable(schema);
  return emitUpdate(buildUpdateIR(schema));
}

export function compileUpdate<TSchema extends ATS.AnyTypeSchema>(schema: TSchema): Update<ATS.InferSchema<TSchema>> {
  assertUpdateable(schema);
  const program = buildUpdateIR(schema);
  const body = emitUpdateBody(program);

  return globalThis.Function(`return function update(value, patch) {\n${body}\n};`)() as Update<
    ATS.InferSchema<TSchema>
  >;
}

function assertUpdateable(schema: ATS.AnyTypeSchema): void {
  if (schema.type === TypeName.readonly) {
    throw new JITError("READONLY_FIELD", "Cannot compile updates for readonly schemas");
  }

  if (schema.type === TypeName.lazy) {
    assertUpdateable((schema.def as ATS.LazyDef<ATS.AnyTypeSchema>).getter());
    return;
  }

  if (hasInnerType(schema)) {
    assertUpdateable((schema.def as ATS.InnerTypeDef<ATS.AnyTypeSchema>).innerType);
    return;
  }

  if (schema.type === TypeName.object) {
    const objectSchema = schema as ATS.ObjectSchema<ATS.SchemaShape>;

    for (const child of Object.values(objectSchema.def.props)) {
      assertUpdateable(child);
    }
  }
}

function hasInnerType(schema: ATS.AnyTypeSchema): boolean {
  return (
    schema.type === TypeName.optional ||
    schema.type === TypeName.nullable ||
    schema.type === TypeName.nullish ||
    schema.type === TypeName.default ||
    schema.type === TypeName.brand ||
    schema.type === TypeName.transform ||
    schema.type === TypeName.pipe ||
    schema.type === TypeName.refine ||
    schema.type === TypeName.coerce ||
    schema.type === TypeName.promise
  );
}
