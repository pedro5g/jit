import type * as ATS from "../core/ats/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { buildProjectionTree, emitProjectionLiteral, type ProjectionTree, projectionCacheKey } from "./projection.js";

/**
 * Emits a projection as one object literal over static keys.
 *
 * There is no key loop and no `Object.keys`: the selection is known, so the
 * result is built in a single expression the engine can shape-specialize.
 */
export function emitProjectSource(tree: ProjectionTree): string {
  return `function project(value) {\n  return ${emitProjectionLiteral(tree, "value")};\n}`;
}

export function compileProject<TInput, TOutput>(
  schema: ATS.AnyTypeSchema,
  paths: readonly string[],
  options?: CompileCacheOptions
): (value: TInput) => TOutput {
  const tree = buildProjectionTree(schema, paths, "JIT.project()");
  const template = getCompileCached(
    schema,
    `project:${projectionCacheKey(tree)}`,
    () => {
      const source = emitProjectSource(tree);
      return { source, create: globalThis.Function(`return ${source};`) };
    },
    options
  );
  const compiled = template.create() as (value: TInput) => TOutput;

  registerArtifact(compiled as object, { kind: "project-plan", schema, tree });
  return compiled;
}
