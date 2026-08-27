import { compileJsonPatch, compileMergePatch } from "../compiler/patch.js";
import type { Update } from "../compiler/update.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { update } from "./update.js";

/** One RFC 6902 operation. `from` is required by `move` and `copy`. */
export type JsonPatchOperation =
  | { readonly op: "add" | "replace" | "test"; readonly path: string; readonly value: unknown }
  | { readonly op: "remove"; readonly path: string }
  | { readonly op: "move" | "copy"; readonly path: string; readonly from: string };

/**
 * An RFC 7396 merge patch. `null` removes a member, which is the one place
 * merge-patch semantics differ from an ordinary partial assignment.
 */
export type MergePatch<TValue> = TValue extends object
  ? { readonly [K in keyof TValue]?: MergePatch<TValue[K]> | null } | null
  : TValue | null;

/**
 * Patch semantics, grouped.
 *
 * These are three different contracts over the same idea, and the difference
 * between them is exactly the kind of thing that goes wrong when they share a
 * name: `apply` takes a deep partial where `undefined` means "leave alone",
 * `merge` follows RFC 7396 where `null` means "remove", and `json` follows
 * RFC 6902 where the patch is a list of operations against pointers.
 */
export const patch = Object.freeze({
  /**
   * A deep partial patch, applied immutably. This is `JIT.update` under the
   * patch namespace — the same plan, not a second engine.
   */
  apply<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): Update<ATS.TypeofSchema<TSchema>> {
    // Literally `JIT.update`, so it registers the same artifact and AOT emits
    // it through the same path. A second entry point, not a second engine.
    return update(schema) as Update<ATS.TypeofSchema<TSchema>>;
  },

  /** RFC 7396 JSON Merge Patch: `null` removes, objects merge, everything else replaces. */
  merge<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): (value: ATS.TypeofSchema<TSchema>, patch: MergePatch<ATS.TypeofSchema<TSchema>>) => ATS.TypeofSchema<TSchema> {
    return compileMergePatch<ATS.TypeofSchema<TSchema>>(unwrapSchema(schema)) as never;
  },

  /** RFC 6902 JSON Patch: a list of operations applied in order, immutably. */
  json<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): (value: ATS.TypeofSchema<TSchema>, operations: readonly JsonPatchOperation[]) => ATS.TypeofSchema<TSchema> {
    return compileJsonPatch<ATS.TypeofSchema<TSchema>>(unwrapSchema(schema)) as never;
  },
});
