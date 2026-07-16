import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { buildUpdateIR } from "./update/build-update-ir.js";
import { emitUpdate, emitUpdateBody } from "./update/emit-update.js";

/**
 * The deep-partial patch shape accepted by a compiled update function.
 *
 * Arrays are patched positionally (sparse entries mean "unchanged"); Dates,
 * Sets, and Maps are replaced wholesale rather than merged.
 *
 * @template T - The value type being patched.
 */
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

/**
 * A compiled immutable update function: returns a new value with the patch
 * applied, sharing unchanged substructure with the input.
 *
 * @template T - The value type described by the schema the update was compiled from.
 * @param value - The value to update.
 * @param patch - The structural patch to apply.
 * @returns The updated value, sharing unchanged substructure with `value`.
 */
export type Update<T = unknown> = (value: T, patch: UpdatePatch<T>) => T;

/**
 * Emits the JavaScript source of a schema-aware immutable update function.
 *
 * @param schema - The schema used to build the update IR.
 * @returns The complete JavaScript source for the generated update function.
 *
 * @throws JITError with code `READONLY_FIELD` when the schema (or any nested
 * schema) is marked readonly.
 */
export function emitUpdateSource(schema: ATS.AnyTypeSchema): string {
  assertUpdateable(schema);
  return emitUpdate(buildUpdateIR(schema));
}

/**
 * Compiles a schema-aware immutable update function (structural sharing, like
 * Immer's `produce`, but without proxies or draft bookkeeping).
 *
 * @template TSchema - The schema driving both codegen and the inferred value type.
 * @param schema - The schema used to compile the update function.
 * @returns A specialized immutable update function for values inferred from `schema`.
 *
 * @throws JITError with code `READONLY_FIELD` when the schema (or any nested
 * schema) is marked readonly.
 *
 * @example
 * ```ts
 * const update = compileUpdate(User.schema);
 * const next = update(user, { profile: { score: 10 } });
 * next !== user;                 // changed path is new
 * next.other === user.other;     // untouched paths keep identity
 * ```
 */
export function compileUpdate<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options?: CompileCacheOptions
): Update<ATS.TypeofSchema<TSchema>> {
  assertUpdateable(schema);
  return getCompileCached(
    schema,
    "update",
    () => {
      const program = buildUpdateIR(schema);
      const body = emitUpdateBody(program);

      return globalThis.Function(`return function update(value, patch) {\n${body}\n};`)() as Update<
        ATS.TypeofSchema<TSchema>
      >;
    },
    options
  );
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
