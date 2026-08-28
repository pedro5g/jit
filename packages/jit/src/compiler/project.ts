import type * as ATS from "../core/ats/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { type AccessAbilityContext, emitAccessActionExpression } from "./access.js";
import {
  buildProjectionTree,
  emitProjectionLiteral,
  expectProjectionObject,
  type ProjectionTree,
  projectionCacheKey,
} from "./projection.js";
import { emitPropertyAccess } from "./source/access.js";

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

/** Emits a sparse authorized projection with static property access and no key iteration. */
export function emitAuthorizedProjectSource(context: AccessAbilityContext, action: string): string {
  const object = expectProjectionObject(context.descriptor.subject, "JIT.project().authorize()");
  const lines = ["function project(value) {", "  const out = {};"];

  for (const field of Object.keys(object.def.props)) {
    const check = emitAccessActionExpression(context.descriptor, action, "value", JSON.stringify(field), "__actor");
    if (check === "false") continue;
    const assignment = `out${emitPropertyAccess("", field)} = ${emitPropertyAccess("value", field)};`;
    lines.push(check === "true" ? `  ${assignment}` : `  if (${check}) ${assignment}`);
  }
  lines.push("  return out;", "}");
  return lines.join("\n");
}

export function compileAuthorizedProject<TValue>(
  context: AccessAbilityContext,
  action: string
): (value: TValue) => Partial<TValue> {
  const source = emitAuthorizedProjectSource(context, action);
  const compiled = globalThis.Function("__actor", `return ${source};`)(context.actor) as (
    value: TValue
  ) => Partial<TValue>;
  registerArtifact(compiled as object, {
    kind: "authorized-project-plan",
    schema: context.descriptor.subject,
    descriptor: context.descriptor,
    actor: context.actor,
    action,
  });
  return compiled;
}
