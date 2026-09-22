import { cacheKeyHashBindings, emitCacheKeySource } from "../compiler/cache-key.js";
import { changedEqualBindings, emitChangedSource } from "../compiler/changed.js";
import { emitDiffSource } from "../compiler/diff.js";
import { emitEqualSource } from "../compiler/equal.js";
import { emitHashSource } from "../compiler/hash.js";
import { emitIndexPlanSource, indexCacheKey } from "../compiler/indexing.js";
import { emitLookupSource } from "../compiler/lookup.js";
import { emitJsonPatchSource, emitMergePatchProgram } from "../compiler/patch.js";
import { emitProjectSource } from "../compiler/project.js";
import { emitReconcileSource } from "../compiler/reconcile.js";
import { resolveRowObjectSchema } from "../compiler/row-keys.js";
import { emitSortSource } from "../compiler/sort.js";
import type * as ATS from "../core/ats/index.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import type { ArtifactEmissionContext, EmittedBinding } from "./emit-context-types.js";

type PlanArtifactArguments<TFunction> = TFunction extends (
  context: PlanArtifactEmitterContext,
  ...args: infer Arguments
) => unknown
  ? Arguments
  : never;

export interface PlanArtifactEmitterContext
  extends ArtifactEmissionContext<
    "runtimeGetIndex" | "runtimeCachedIndex" | "hashHelpers" | "hashCache" | "jsonPatchHelpers"
  > {
  readonly ts: boolean;
}

export interface PlanArtifactEmitters {
  readonly emitSortPlanArtifact: (
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "sort-plan" }>,
    type: string
  ) => EmittedBinding;
  readonly emitIndexPlanArtifact: (
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "index-plan" }>,
    type: string
  ) => EmittedBinding;
  readonly emitLookupPlanArtifact: (
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "lookup-plan" }>,
    type: string
  ) => EmittedBinding;
  readonly emitProjectPlanArtifact: (
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "project-plan" }>,
    type: string
  ) => EmittedBinding;
  readonly emitChangedPlanArtifact: (
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "changed-plan" }>,
    type: string
  ) => EmittedBinding;
  readonly emitPatchPlanArtifact: (
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "patch-plan" }>,
    type: string
  ) => EmittedBinding;
  readonly emitCacheKeyPlanArtifact: (
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "cache-key-plan" }>,
    type: string
  ) => EmittedBinding;
  readonly emitHashBinding: (
    binding: string,
    schema: ATS.AnyTypeSchema,
    reportName: string,
    cache?: boolean
  ) => string | undefined;
  readonly emitEqualBinding: (binding: string, schema: ATS.AnyTypeSchema, reportName: string) => string | undefined;
  readonly emitReconcilePlanArtifact: (
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "reconcile-plan" }>,
    reportName: string,
    type: string
  ) => EmittedBinding | undefined;
}

/** Creates the emitters shared by indexed, changed, patch, and reconcile artifacts. */
export function createPlanArtifactEmitters(context: PlanArtifactEmitterContext): PlanArtifactEmitters {
  return {
    emitSortPlanArtifact: (...args: PlanArtifactArguments<typeof emitSortPlanArtifact>) =>
      emitSortPlanArtifact(
        context,
        args[0],
        args[1],
        args[2] as Extract<CompiledArtifact, { readonly kind: "sort-plan" }>,
        args[3]
      ),
    emitIndexPlanArtifact: (...args: PlanArtifactArguments<typeof emitIndexPlanArtifact>) =>
      emitIndexPlanArtifact(
        context,
        args[0],
        args[1],
        args[2] as Extract<CompiledArtifact, { readonly kind: "index-plan" }>,
        args[3]
      ),
    emitLookupPlanArtifact: (...args: PlanArtifactArguments<typeof emitLookupPlanArtifact>) =>
      emitLookupPlanArtifact(
        context,
        args[0],
        args[1],
        args[2] as Extract<CompiledArtifact, { readonly kind: "lookup-plan" }>,
        args[3]
      ),
    emitProjectPlanArtifact: (...args: PlanArtifactArguments<typeof emitProjectPlanArtifact>) =>
      emitProjectPlanArtifact(
        context,
        args[0],
        args[1],
        args[2] as Extract<CompiledArtifact, { readonly kind: "project-plan" }>,
        args[3]
      ),
    emitChangedPlanArtifact: (...args: PlanArtifactArguments<typeof emitChangedPlanArtifact>) =>
      emitChangedPlanArtifact(
        context,
        args[0],
        args[1],
        args[2] as Extract<CompiledArtifact, { readonly kind: "changed-plan" }>,
        args[3]
      ),
    emitPatchPlanArtifact: (...args: PlanArtifactArguments<typeof emitPatchPlanArtifact>) =>
      emitPatchPlanArtifact(
        context,
        args[0],
        args[1],
        args[2] as Extract<CompiledArtifact, { readonly kind: "patch-plan" }>,
        args[3]
      ),
    emitCacheKeyPlanArtifact: (...args: PlanArtifactArguments<typeof emitCacheKeyPlanArtifact>) =>
      emitCacheKeyPlanArtifact(
        context,
        args[0],
        args[1],
        args[2] as Extract<CompiledArtifact, { readonly kind: "cache-key-plan" }>,
        args[3]
      ),
    emitHashBinding: (...args: PlanArtifactArguments<typeof emitHashBinding>) => emitHashBinding(context, ...args),
    emitEqualBinding: (...args: PlanArtifactArguments<typeof emitEqualBinding>) => emitEqualBinding(context, ...args),
    emitReconcilePlanArtifact: (...args: PlanArtifactArguments<typeof emitReconcilePlanArtifact>) =>
      emitReconcilePlanArtifact(
        context,
        args[0],
        args[1],
        args[2] as Extract<CompiledArtifact, { readonly kind: "reconcile-plan" }>,
        args[3],
        args[4]
      ),
  };
}

function emitSortPlanArtifact(
  context: PlanArtifactEmitterContext,
  binding: string,
  declaration: string,
  artifact: Extract<CompiledArtifact, { readonly kind: "sort-plan" }>,
  type: string
): EmittedBinding {
  context.js.push(`${declaration} /*#__PURE__*/ ${emitSortSource(artifact.descriptor)};`);
  return { binding, type };
}

function emitIndexPlanArtifact(
  context: PlanArtifactEmitterContext,
  binding: string,
  declaration: string,
  artifact: Extract<CompiledArtifact, { readonly kind: "index-plan" }>,
  type: string
): EmittedBinding {
  context.mark("runtimeCachedIndex");
  context.js.push(
    `${declaration} /*#__PURE__*/ ${emitIndexPlanSource(artifact.descriptor, indexCacheKey(artifact.descriptor))}(__cachedIndex);`
  );
  return { binding, type };
}

function emitLookupPlanArtifact(
  context: PlanArtifactEmitterContext,
  binding: string,
  declaration: string,
  artifact: Extract<CompiledArtifact, { readonly kind: "lookup-plan" }>,
  type: string
): EmittedBinding {
  if (artifact.lookup.choice.strategy === "CachedIndexLookup") context.mark("runtimeCachedIndex");
  context.js.push(`${declaration} /*#__PURE__*/ ${emitLookupSource(artifact.lookup)};`);
  return { binding, type };
}

function emitProjectPlanArtifact(
  context: PlanArtifactEmitterContext,
  binding: string,
  declaration: string,
  artifact: Extract<CompiledArtifact, { readonly kind: "project-plan" }>,
  type: string
): EmittedBinding {
  context.js.push(`${declaration} /*#__PURE__*/ ${context.asExpression(emitProjectSource(artifact.tree), "project")};`);
  return { binding, type };
}

function emitChangedPlanArtifact(
  context: PlanArtifactEmitterContext,
  binding: string,
  declaration: string,
  artifact: Extract<CompiledArtifact, { readonly kind: "changed-plan" }>,
  type: string
): EmittedBinding {
  const paths = artifact.descriptor.fields.map((field) => field.path);
  const bigint = artifact.descriptor.representation === "bigint";
  const { js } = context;

  js.push(`${declaration} /*#__PURE__*/ (() => {`);
  for (const equal of changedEqualBindings(artifact.descriptor)) {
    js.push(`  const ${equal.name} = ${context.asExpression(equal.source, "equal")};`);
  }
  js.push(...context.indentBlock(emitChangedSource(artifact.descriptor)));
  js.push(`  const __bits = new Map(${JSON.stringify(paths)}.map((path, index) => [path, index]));`);
  js.push('  Object.defineProperty(changed, "fields", { value: Object.freeze(' + JSON.stringify(paths) + ") });");
  js.push('  Object.defineProperty(changed, "has", {');
  js.push("    value: (mask, path) => {");
  js.push("      const bit = __bits.get(path);");
  js.push("      if (bit === undefined) return false;");
  js.push(bigint ? "      return (mask & (1n << BigInt(bit))) !== 0n;" : "      return (mask & (1 << bit)) !== 0;");
  js.push("    },", "  });", "  return changed;", "})();");
  return { binding, type };
}

function emitPatchPlanArtifact(
  context: PlanArtifactEmitterContext,
  binding: string,
  declaration: string,
  artifact: Extract<CompiledArtifact, { readonly kind: "patch-plan" }>,
  type: string
): EmittedBinding {
  if (artifact.mode === "merge") {
    context.js.push(`${declaration} /*#__PURE__*/ ${emitMergePatchProgram(artifact.schema)};`);
    return { binding, type };
  }
  context.mark("jsonPatchHelpers");
  context.js.push(
    `${declaration} /*#__PURE__*/ ${context.asExpression(emitJsonPatchSource(artifact.schema), "patch")};`
  );
  return { binding, type };
}

function emitCacheKeyPlanArtifact(
  context: PlanArtifactEmitterContext,
  binding: string,
  declaration: string,
  artifact: Extract<CompiledArtifact, { readonly kind: "cache-key-plan" }>,
  type: string
): EmittedBinding {
  const hashes = cacheKeyHashBindings(artifact.descriptor);
  const { js } = context;

  if (hashes.length > 0 || artifact.descriptor.form === "hash") context.mark("hashHelpers");
  js.push(`${declaration} /*#__PURE__*/ (() => {`);
  for (const hash of hashes) js.push(`  const ${hash.name} = ${context.asExpression(hash.source, "hash")};`);
  js.push(...context.indentBlock(emitCacheKeySource(artifact.descriptor)), "  return cacheKey;", "})();");
  return { binding, type };
}

function emitHashBinding(
  context: PlanArtifactEmitterContext,
  binding: string,
  schema: ATS.AnyTypeSchema,
  reportName: string,
  cache = true
): string | undefined {
  const source = context.tryEmit(reportName, "hash", context.skipped, () => emitHashSource(schema));

  if (!source) return undefined;
  const typedSource = context.ts
    ? source.split("function hash(value)").join("function hash(value: __JitValue)")
    : source;
  context.mark("hashHelpers");
  if (!cache) {
    context.js.push(`const ${binding} = ${context.asExpression(typedSource, "hash")};`);
    return binding;
  }
  context.mark("hashCache");
  context.js.push(`const ${binding} = /*#__PURE__*/ (() => {`);
  context.js.push(...context.indentBlock(`const compute = (${typedSource});`));
  context.js.push(
    `  return (value${context.ts ? ": __JitValue" : ""})${context.ts ? ": number" : ""} => {`,
    '    if ((typeof value === "object" && value !== null) || typeof value === "function") {',
    "      const cached = __hashCache.get(value);",
    "      if (cached !== undefined) return cached;",
    "      const hash = compute(value);",
    "      __hashCache.set(value, hash);",
    "      return hash;",
    "    }",
    "    return compute(value);",
    "  };",
    "})();"
  );
  return binding;
}

function emitEqualBinding(
  context: PlanArtifactEmitterContext,
  binding: string,
  schema: ATS.AnyTypeSchema,
  reportName: string
): string | undefined {
  const source = context.tryEmit(reportName, "equal", context.skipped, () => emitEqualSource(schema));
  if (!source) return undefined;
  if (source.includes("__getIndex")) context.mark("runtimeGetIndex");
  if (source.includes("__hash")) {
    const hashBinding = context.internalIdentifier(`${binding}_hash`);
    if (!emitHashBinding(context, hashBinding, schema, reportName)) return undefined;
    context.js.push(
      `const ${binding} = /*#__PURE__*/ ((__hash) => ${context.asExpression(source, "equal")})(${hashBinding});`
    );
  } else {
    context.js.push(`const ${binding} = ${context.asExpression(source, "equal")};`);
  }
  return binding;
}

function emitReconcilePlanArtifact(
  context: PlanArtifactEmitterContext,
  binding: string,
  declaration: string,
  artifact: Extract<CompiledArtifact, { readonly kind: "reconcile-plan" }>,
  reportName: string,
  type: string
): EmittedBinding | undefined {
  const object = resolveRowObjectSchema(artifact.schema, "reconcile");
  const source = context.tryEmit(reportName, "reconcile", context.skipped, () =>
    emitReconcileSource(artifact.descriptor)
  );

  if (!source) return undefined;
  const prelude: string[] = [];

  if (source.includes("__reconcileEqual")) {
    const equalBinding = context.internalIdentifier(`${binding}_equal`);
    if (!emitEqualBinding(context, equalBinding, object, reportName)) return undefined;
    prelude.push(`  const __reconcileEqual = ${equalBinding};`);
  }
  if (source.includes("__reconcileDiff")) {
    const diffSource = context.tryEmit(reportName, "reconcile.diff", context.skipped, () => emitDiffSource(object));
    if (!diffSource) return undefined;
    const diffBinding = context.internalIdentifier(`${binding}_diff`);
    context.js.push(`const ${diffBinding} = ${context.asExpression(diffSource, "diff")};`);
    prelude.push(`  const __reconcileDiff = ${diffBinding};`);
  }

  context.js.push(`${declaration} /*#__PURE__*/ (() => {`);
  context.js.push(...prelude, ...context.indentBlock(source), "  return reconcile;", "})();");
  return { binding, type };
}
