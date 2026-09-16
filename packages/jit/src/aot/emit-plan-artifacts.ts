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
import type { SkippedOperation } from "./generate.js";

interface EmittedBinding {
  readonly binding: string;
  readonly type: string;
}

export interface PlanArtifactEmitterContext {
  readonly js: string[];
  readonly skipped: SkippedOperation[];
  readonly mark: (
    flag: "runtimeGetIndex" | "runtimeCachedIndex" | "hashHelpers" | "hashCache" | "jsonPatchHelpers"
  ) => void;
  readonly internalIdentifier: (preferred: string) => string;
  readonly asExpression: (source: string, entry: string) => string;
  readonly indentBlock: (source: string) => string[];
  readonly tryEmit: <TValue>(
    schema: string,
    operation: string,
    skipped: SkippedOperation[],
    emit: () => TValue
  ) => TValue | undefined;
}

/** Creates the emitters shared by indexed, changed, patch, and reconcile artifacts. */
export function createPlanArtifactEmitters(context: PlanArtifactEmitterContext) {
  const { js, skipped, mark, internalIdentifier, asExpression, indentBlock, tryEmit } = context;

  function emitSortPlanArtifact(
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "sort-plan" }>,
    type: string
  ): EmittedBinding {
    js.push(`${declaration} /*#__PURE__*/ ${emitSortSource(artifact.descriptor)};`);
    return { binding, type };
  }

  function emitIndexPlanArtifact(
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "index-plan" }>,
    type: string
  ): EmittedBinding {
    mark("runtimeCachedIndex");
    js.push(
      `${declaration} /*#__PURE__*/ ${emitIndexPlanSource(artifact.descriptor, indexCacheKey(artifact.descriptor))}(__cachedIndex);`
    );
    return { binding, type };
  }

  /**
   * A lookup lowers to the access path its facts chose. Only the index path
   * needs the shared per-array cache; a binary search or a scan carries
   * nothing at all.
   */
  function emitLookupPlanArtifact(
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "lookup-plan" }>,
    type: string
  ): EmittedBinding {
    if (artifact.lookup.choice.strategy === "CachedIndexLookup") mark("runtimeCachedIndex");
    js.push(`${declaration} /*#__PURE__*/ ${emitLookupSource(artifact.lookup)};`);
    return { binding, type };
  }

  /** A projection is one object literal; nothing else has to travel with it. */
  function emitProjectPlanArtifact(
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "project-plan" }>,
    type: string
  ): EmittedBinding {
    js.push(`${declaration} /*#__PURE__*/ ${asExpression(emitProjectSource(artifact.tree), "project")};`);
    return { binding, type };
  }

  /**
   * A change mask lowers to the comparison and its bit assignments, plus a
   * `has` that closes over the field order. No descriptor and no field-name
   * table travel with it beyond the names `has` needs.
   */
  function emitChangedPlanArtifact(
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "changed-plan" }>,
    type: string
  ): EmittedBinding {
    const paths = artifact.descriptor.fields.map((field) => field.path);
    const bigint = artifact.descriptor.representation === "bigint";

    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    for (const equal of changedEqualBindings(artifact.descriptor)) {
      js.push(`  const ${equal.name} = ${asExpression(equal.source, "equal")};`);
    }
    js.push(...indentBlock(emitChangedSource(artifact.descriptor)));
    js.push(`  const __bits = new Map(${JSON.stringify(paths)}.map((path, index) => [path, index]));`);
    js.push('  Object.defineProperty(changed, "fields", { value: Object.freeze(' + JSON.stringify(paths) + ") });");
    js.push('  Object.defineProperty(changed, "has", {');
    js.push("    value: (mask, path) => {");
    js.push("      const bit = __bits.get(path);");
    js.push("      if (bit === undefined) return false;");
    js.push(bigint ? "      return (mask & (1n << BigInt(bit))) !== 0n;" : "      return (mask & (1 << bit)) !== 0;");
    js.push("    },");
    js.push("  });");
    js.push("  return changed;");
    js.push("})();");
    return { binding, type };
  }

  /**
   * A merge patch lowers to its specialized functions. A JSON Patch carries its
   * pointer helpers, because a pointer is data and has to be walked at run
   * time; the helpers are emitted once per module rather than per artifact.
   */
  function emitPatchPlanArtifact(
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "patch-plan" }>,
    type: string
  ): EmittedBinding {
    if (artifact.mode === "merge") {
      js.push(`${declaration} /*#__PURE__*/ ${emitMergePatchProgram(artifact.schema)};`);
      return { binding, type };
    }
    mark("jsonPatchHelpers");
    js.push(`${declaration} /*#__PURE__*/ ${asExpression(emitJsonPatchSource(artifact.schema), "patch")};`);
    return { binding, type };
  }

  /**
   * A cache key lowers to the concatenation or the combination, plus the schema
   * hashes any structural field needs. The hash helpers are module-level, so
   * several keys in one module share them.
   */
  function emitCacheKeyPlanArtifact(
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "cache-key-plan" }>,
    type: string
  ): EmittedBinding {
    const hashes = cacheKeyHashBindings(artifact.descriptor);

    if (hashes.length > 0 || artifact.descriptor.form === "hash") mark("hashHelpers");

    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    for (const hash of hashes) js.push(`  const ${hash.name} = ${asExpression(hash.source, "hash")};`);
    js.push(...indentBlock(emitCacheKeySource(artifact.descriptor)));
    js.push("  return cacheKey;");
    js.push("})();");
    return { binding, type };
  }

  /** Lowers a class descriptor into a plain class expression with no engine dependency. */

  function emitHashBinding(
    binding: string,
    schema: ATS.AnyTypeSchema,
    reportName: string,
    cache = true
  ): string | undefined {
    const source = tryEmit(reportName, "hash", skipped, () => emitHashSource(schema));

    if (!source) return undefined;

    mark("hashHelpers");
    if (!cache) {
      js.push(`const ${binding} = ${asExpression(source, "hash")};`);
      return binding;
    }
    mark("hashCache");
    js.push(`const ${binding} = /*#__PURE__*/ (() => {`);
    js.push(...indentBlock(`const compute = (${source});`));
    js.push("  return (value) => {");
    js.push('    if ((typeof value === "object" && value !== null) || typeof value === "function") {');
    js.push("      const cached = __hashCache.get(value);");
    js.push("      if (cached !== undefined) return cached;");
    js.push("      const hash = compute(value);");
    js.push("      __hashCache.set(value, hash);");
    js.push("      return hash;");
    js.push("    }");
    js.push("    return compute(value);");
    js.push("  };");
    js.push("})();");
    return binding;
  }

  function emitEqualBinding(binding: string, schema: ATS.AnyTypeSchema, reportName: string): string | undefined {
    const source = tryEmit(reportName, "equal", skipped, () => emitEqualSource(schema));
    if (!source) return undefined;
    if (source.includes("__getIndex")) mark("runtimeGetIndex");
    if (source.includes("__hash")) {
      const hashBinding = internalIdentifier(`${binding}_hash`);
      if (!emitHashBinding(hashBinding, schema, reportName)) return undefined;
      js.push(`const ${binding} = /*#__PURE__*/ ((__hash) => ${asExpression(source, "equal")})(${hashBinding});`);
    } else {
      js.push(`const ${binding} = ${asExpression(source, "equal")};`);
    }
    return binding;
  }

  /**
   * A reconciliation lowers to the loop plus the two functions it actually
   * calls: the specialized equality, and the diff only when the declaration
   * asked for one. No engine, no descriptor, no channel switches — the
   * channels were already resolved into the emitted body.
   */
  function emitReconcilePlanArtifact(
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "reconcile-plan" }>,
    reportName: string,
    type: string
  ): EmittedBinding | undefined {
    // The row, not the collection: reconcile compares two rows that share an
    // identity, so it needs `equal(User)` and never `equal(Users)`.
    const object = resolveRowObjectSchema(artifact.schema, "reconcile");
    const source = tryEmit(reportName, "reconcile", skipped, () => emitReconcileSource(artifact.descriptor));

    if (!source) return undefined;

    // The emitted body already resolved the channels, so a comparison the
    // declaration cannot reach is not generated — not merely left uncalled.
    const prelude: string[] = [];

    if (source.includes("__reconcileEqual")) {
      const equalBinding = internalIdentifier(`${binding}_equal`);

      if (!emitEqualBinding(equalBinding, object, reportName)) return undefined;
      prelude.push(`  const __reconcileEqual = ${equalBinding};`);
    }

    if (source.includes("__reconcileDiff")) {
      const diffSource = tryEmit(reportName, "reconcile.diff", skipped, () => emitDiffSource(object));

      if (!diffSource) return undefined;

      const diffBinding = internalIdentifier(`${binding}_diff`);

      js.push(`const ${diffBinding} = ${asExpression(diffSource, "diff")};`);
      prelude.push(`  const __reconcileDiff = ${diffBinding};`);
    }

    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...prelude);
    js.push(...indentBlock(source));
    js.push("  return reconcile;");
    js.push("})();");
    return { binding, type };
  }

  return {
    emitSortPlanArtifact,
    emitIndexPlanArtifact,
    emitLookupPlanArtifact,
    emitProjectPlanArtifact,
    emitChangedPlanArtifact,
    emitPatchPlanArtifact,
    emitCacheKeyPlanArtifact,
    emitHashBinding,
    emitEqualBinding,
    emitReconcilePlanArtifact,
  };
}
