import type * as ATS from "../core/ats/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { buildDiffIR } from "./diff/build-diff-ir.js";
import { emitDiff, emitDiffBody } from "./diff/emit-diff.js";

/**
 * A single structural change reported by a compiled diff function.
 *
 * @template T - The type of the changed value at `path`.
 */
export type DiffChange<T = unknown> =
  | { readonly type: "add"; readonly path: readonly PropertyKey[]; readonly value: T }
  | { readonly type: "remove"; readonly path: readonly PropertyKey[] }
  | { readonly type: "update"; readonly path: readonly PropertyKey[]; readonly value: T };

/**
 * A compiled structural diff function.
 *
 * @template T - The value type described by the schema the diff was compiled from.
 * @param left - The previous value.
 * @param right - The next value.
 * @returns The structural changes needed to transform `left` into `right`.
 */
export type Diff<T = unknown> = (left: T, right: T) => DiffChange[];

/**
 * Emits the JavaScript source of a schema-aware diff function.
 *
 * @param schema - The schema used to build the diff IR.
 * @returns The complete JavaScript source for the generated diff function.
 */
export function emitDiffSource(schema: ATS.AnyTypeSchema): string {
  return emitDiff(buildDiffIR(schema));
}

/**
 * Compiles a schema-aware structural diff function.
 *
 * Returns the changes needed to turn `left` into `right`, visiting only the
 * paths the schema declares, with no generic reflection at runtime.
 *
 * @template TSchema - The schema driving both codegen and the inferred value type.
 * @param schema - The schema used to compile the diff function.
 * @returns A specialized diff function for values inferred from `schema`.
 *
 * @example
 * ```ts
 * const diff = compileDiff(User.schema);
 * diff(before, after); // [{ type: "update", path: ["name"], value: "Grace" }]
 * ```
 */
export function compileDiff<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  options?: CompileCacheOptions
): Diff<ATS.Infer<TSchema>> {
  return getCompileCached(
    schema,
    "diff",
    () => {
      const program = buildDiffIR(schema);
      const body = emitDiffBody(program);

      const compiled = globalThis.Function(`return function diff(left, right) {\n${body}\n};`)() as Diff<
        ATS.Infer<TSchema>
      >;

      registerArtifact(compiled as object, { kind: "operation", schema, op: "diff" });
      return compiled;
    },
    options
  );
}
