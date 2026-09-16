import { emitAccessMutationGuardSource, emitAccessSource } from "../compiler/access.js";
import { emitCanonicalSource } from "../compiler/canonical.js";
import { emitCsvSource } from "../compiler/csv.js";
import { emitMatchSource } from "../compiler/match.js";
import { emitMigrationSource } from "../compiler/migration.js";
import { emitNdjsonSource } from "../compiler/ndjson.js";
import { emitAuthorizedProjectSource } from "../compiler/project.js";
import { emitRulesSinkSource, type RulesSink } from "../compiler/rules.js";
import { emitUpdateSource } from "../compiler/update.js";
import { emitValidator } from "../compiler/validate/emit-validate.js";
import type * as ATS from "../core/ats/index.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import { type ArtifactTypeContext, artifactType } from "./emit-artifact-type.js";
import { type ClassArtifactEmitContext, emitClassArtifact } from "./emit-class.js";
import { createExecutionArtifactEmitter } from "./emit-execution-artifact.js";
import { createOperationArtifactEmitter } from "./emit-operation-artifacts.js";
import { createPlanArtifactEmitters } from "./emit-plan-artifacts.js";
import { createQueryArtifactEmitters } from "./emit-query-artifacts.js";
import { createValidatorArtifactEmitter } from "./emit-validator-artifact.js";
import type { SkippedOperation } from "./generate.js";

export interface EmittedBinding {
  readonly binding: string;
  readonly type: string;
}

export type ArtifactEmitterFlag =
  | "runtimeGetIndex"
  | "runtimeCachedIndex"
  | "validationError"
  | "assertionError"
  | "hashHelpers"
  | "hashCache"
  | "jsonPatchHelpers"
  | "mockHelpers"
  | "callHelper"
  | "aggregateType"
  | "domainStateType"
  | "domainEventType";

export interface ArtifactEmitterContext {
  readonly js: string[];
  readonly skipped: SkippedOperation[];
  readonly ts: boolean;
  readonly artifactTypeContext: ArtifactTypeContext;
  readonly classArtifactContext: Omit<ClassArtifactEmitContext, "emitValidatorBinding" | "emitHashBinding">;
  readonly classBindings: ReadonlyMap<unknown, string>;
  readonly classArtifacts: ReadonlyMap<unknown, Extract<CompiledArtifact, { readonly kind: "class" }>>;
  readonly assertionBindings: ReadonlyMap<unknown, string>;
  readonly mark: (flag: ArtifactEmitterFlag) => void;
  readonly internalIdentifier: (preferred: string) => string;
  readonly inlineBindings: (names: readonly string[], values: readonly unknown[]) => string[] | undefined;
  readonly inlineCodecBindings: (names: readonly string[], values: readonly unknown[]) => string[] | undefined;
  readonly serializeBindingValue: (value: unknown) => string | undefined;
  readonly serializeStaticData: (value: unknown) => string | undefined;
  readonly asExpression: (source: string, entry: string) => string;
  readonly indentBlock: (source: string) => string[];
  readonly tryEmit: <TValue>(
    schema: string,
    operation: string,
    skipped: SkippedOperation[],
    emit: () => TValue
  ) => TValue | undefined;
}

/** Builds the artifact-kind dispatcher used by one generated AOT module. */
export function createArtifactEmitter(context: ArtifactEmitterContext) {
  const {
    js,
    skipped,
    ts,
    artifactTypeContext,
    classBindings,
    classArtifacts,
    assertionBindings,
    mark,
    internalIdentifier,
    inlineBindings,
    inlineCodecBindings,
    serializeBindingValue,
    serializeStaticData,
    asExpression,
    indentBlock,
    tryEmit,
  } = context;
  const planEmitters = createPlanArtifactEmitters({
    js,
    skipped,
    mark,
    internalIdentifier,
    asExpression,
    indentBlock,
    tryEmit,
  });
  const queryEmitters = createQueryArtifactEmitters({
    js,
    skipped,
    internalIdentifier,
    inlineBindings,
    indentBlock,
    tryEmit,
    mark,
    planEmitters,
  });
  const operationEmitters = createOperationArtifactEmitter({
    js,
    skipped,
    mark,
    internalIdentifier,
    asExpression,
    indentBlock,
    tryEmit,
    inlineCodecBindings,
    emitValidatorBinding,
    planEmitters,
  });
  const validatorEmitters = createValidatorArtifactEmitter({
    js,
    skipped,
    mark,
    emitValidatorBinding,
  });
  const executionEmitters = createExecutionArtifactEmitter({
    js,
    skipped,
    classBindings,
    classArtifacts,
    mark,
    internalIdentifier,
    tryEmit,
    inlineBindings,
    inlineCodecBindings,
    serializeStaticData,
    asExpression,
    indentBlock,
    emitValidatorBinding,
    emitOperationArtifact: operationEmitters.emitOperationArtifact,
  });
  const classArtifactContext: ClassArtifactEmitContext = {
    ...context.classArtifactContext,
    mark,
    emitValidatorBinding,
    emitHashBinding: planEmitters.emitHashBinding,
  };

  /**
   * The rules sinks whose generated source materializes outcomes.
   */
  const RULES_OUTCOME_SINKS: ReadonlySet<RulesSink> = new Set<RulesSink>([
    "plan",
    "run",
    "visitor",
    "iterator",
    "many",
    "many-visitor",
    "many-iterator",
  ]);

  function emitArtifact(
    binding: string,
    artifact: CompiledArtifact,
    reportName: string,
    importedType: string | undefined,
    annotate: boolean
  ): EmittedBinding | undefined {
    const type = importedType ?? artifactType(artifactTypeContext, artifact);
    const assertedClassType = artifact.kind === "class" && artifact.aggregate && annotate && ts ? type : undefined;
    const declaration = `const ${binding}${annotate && ts && assertedClassType === undefined ? `: ${type}` : ""} =`;

    if (importedType?.startsWith("__JitCall<")) mark("callHelper");

    if (artifact.kind === "validator")
      return validatorEmitters.emitValidatorArtifact(binding, declaration, artifact, reportName, type);
    if (artifact.kind === "operation")
      return operationEmitters.emitOperationArtifact(binding, declaration, artifact, reportName, type);
    if (artifact.kind === "execution")
      return executionEmitters.emitExecutionArtifact(binding, declaration, artifact.plan, reportName, type);
    if (artifact.kind === "query-plan")
      return queryEmitters.emitQueryPlanArtifact(binding, declaration, artifact, reportName, type);
    if (artifact.kind === "join-plan")
      return queryEmitters.emitJoinPlanArtifact(binding, declaration, artifact, reportName, type);
    if (artifact.kind === "cqrs-input")
      return queryEmitters.emitCqrsInputArtifact(binding, declaration, artifact, reportName, type);
    if (artifact.kind === "cqrs-parser")
      return queryEmitters.emitCqrsParserArtifact(binding, declaration, artifact, reportName, type);
    if (artifact.kind === "cqrs-authorized-parser")
      return queryEmitters.emitCqrsAuthorizedParserArtifact(binding, declaration, artifact, reportName, type);
    if (artifact.kind === "collection-mutation-plan") {
      const inlined = inlineBindings(artifact.bindingNames, artifact.bindingValues);
      if (inlined === undefined) {
        skipped.push({
          schema: reportName,
          operation: "state.collection",
          reason: "a declared patch value cannot be serialized ahead of time",
        });
        return undefined;
      }
      if (artifact.source.includes("__cachedIndex")) mark("runtimeCachedIndex");
      js.push(`${declaration} /*#__PURE__*/ (() => {`);
      js.push(...inlined.map((line) => `  ${line}`));
      // The upsert no-op test is schema-specialized equality; it becomes a
      // local helper rather than a binding an import-free module cannot have.
      if (artifact.equalSource !== undefined) {
        js.push(`  const __equal = ${asExpression(artifact.equalSource, "equal")};`);
      }
      js.push(`  return ${artifact.source};`);
      js.push("})();");
      return { binding, type };
    }
    if (artifact.kind === "mutation-plan") {
      const inlined = inlineBindings(artifact.bindingNames, artifact.bindingValues);
      if (inlined === undefined) {
        skipped.push({
          schema: reportName,
          operation: "state.update.patch",
          reason: "a declared patch value cannot be serialized ahead of time",
        });
        return undefined;
      }
      js.push(`${declaration} /*#__PURE__*/ (() => {`);
      js.push(...inlined.map((line) => `  ${line}`));
      if (artifact.layout === undefined) {
        js.push(...indentBlock(artifact.source));
      } else {
        // A mask is only meaningful next to its layout, so the generated
        // mutation carries the same agreement the runtime one reports.
        js.push(...indentBlock(artifact.source.replace("return function mutate", "const mutate = function mutate")));
        js.push(`  const __layout = Object.freeze(${JSON.stringify(artifact.layout)});`);
        js.push('  Object.defineProperty(mutate, "layout", { value: () => __layout });');
        js.push("  return mutate;");
      }
      js.push("})();");
      return { binding, type };
    }
    if (artifact.kind === "sort-plan") return planEmitters.emitSortPlanArtifact(binding, declaration, artifact, type);
    if (artifact.kind === "index-plan") return planEmitters.emitIndexPlanArtifact(binding, declaration, artifact, type);
    if (artifact.kind === "lookup-plan")
      return planEmitters.emitLookupPlanArtifact(binding, declaration, artifact, type);
    if (artifact.kind === "project-plan")
      return planEmitters.emitProjectPlanArtifact(binding, declaration, artifact, type);
    if (artifact.kind === "authorized-project-plan") {
      const actor = serializeStaticData(artifact.actor);
      if (actor === undefined) {
        skipped.push({
          schema: reportName,
          operation: "project.authorize",
          reason: "the bound actor cannot be serialized ahead of time",
        });
        return undefined;
      }
      js.push(`${declaration} /*#__PURE__*/ (() => {`);
      js.push(`  const __actor = ${actor};`);
      js.push(`  return ${asExpression(emitAuthorizedProjectSource(artifact, artifact.action), "project")};`);
      js.push("})();");
      return { binding, type };
    }
    if (artifact.kind === "authorized-update-plan") {
      const actor = serializeStaticData(artifact.actor);
      if (actor === undefined) {
        skipped.push({
          schema: reportName,
          operation: "update.authorize",
          reason: "the bound actor cannot be serialized ahead of time",
        });
        return undefined;
      }
      js.push(`${declaration} /*#__PURE__*/ (() => {`);
      js.push(`  const actor = ${actor};`);
      js.push("  class __AccessDeniedError extends Error {");
      js.push("    constructor(action, field, reason) {");
      js.push('      super("Access denied for action " + JSON.stringify(action));');
      js.push('      this.name = "AccessDeniedError";');
      js.push('      this.code = "ACCESS_DENIED";');
      js.push("      this.action = action;");
      js.push("      this.field = field;");
      js.push("      this.reason = reason;");
      js.push("    }");
      js.push("  }");
      js.push(`  const update = ${asExpression(emitUpdateSource(artifact.schema), "update")};`);
      js.push(...indentBlock(emitAccessMutationGuardSource(artifact.descriptor, artifact.action)));
      js.push("  return function authorizedUpdate(value, patch) {");
      js.push("    authorizeMutation(value, patch);");
      js.push("    return update(value, patch);");
      js.push("  };");
      js.push("})();");
      return { binding, type };
    }
    if (artifact.kind === "changed-plan")
      return planEmitters.emitChangedPlanArtifact(binding, declaration, artifact, type);
    if (artifact.kind === "patch-plan") return planEmitters.emitPatchPlanArtifact(binding, declaration, artifact, type);
    if (artifact.kind === "cache-key-plan")
      return planEmitters.emitCacheKeyPlanArtifact(binding, declaration, artifact, type);
    if (artifact.kind === "match-plan") {
      const inlined = inlineBindings(artifact.bindingNames, artifact.bindingValues);

      if (inlined === undefined) {
        skipped.push({
          schema: reportName,
          operation: "match",
          reason: "match handlers contain native, bound, or closure-dependent callbacks",
        });
        return undefined;
      }

      js.push(`${declaration} /*#__PURE__*/ (() => {`);
      js.push(...inlined.map((line) => `  ${line}`));
      js.push(`  return ${asExpression(emitMatchSource(artifact.descriptor), "match")};`);
      js.push("})();");
      return { binding, type };
    }
    if (artifact.kind === "migration-plan") {
      const inlined = inlineBindings(artifact.descriptor.bindingNames, artifact.descriptor.bindingValues);

      if (inlined === undefined) {
        skipped.push({
          schema: reportName,
          operation: "migrate",
          reason: "migration mappings contain native, bound, or closure-dependent callbacks",
        });
        return undefined;
      }

      js.push(`${declaration} /*#__PURE__*/ (() => {`);
      js.push(...inlined.map((line) => `  ${line}`));
      js.push(`  return ${emitMigrationSource(artifact.descriptor)};`);
      js.push("})();");
      return { binding, type };
    }
    if (artifact.kind === "csv-plan") {
      if (artifact.descriptor.operation === "stringify") {
        js.push(`${declaration} /*#__PURE__*/ ${asExpression(emitCsvSource(artifact.descriptor), "csvStringify")};`);
        return { binding, type };
      }

      const validator = emitValidatorBinding(binding, artifact.descriptor.schema, reportName, "csv.parse", {
        is: false,
        safeParse: true,
        resolveDefaults: true,
        materializeRuntimeTypes: true,
      });

      if (!validator) return undefined;
      mark("validationError");
      js.push(
        `${declaration} /*#__PURE__*/ ${asExpression(emitCsvSource(artifact.descriptor, validator), "csvParse")};`
      );
      return { binding, type };
    }
    if (artifact.kind === "ndjson-plan") {
      if (artifact.descriptor.operation === "stringify") {
        js.push(`${declaration} /*#__PURE__*/ ${emitNdjsonSource(artifact.descriptor)};`);
        return { binding, type };
      }

      const inlined = inlineBindings(artifact.descriptor.bindingNames, artifact.descriptor.bindingValues);
      if (inlined === undefined) {
        skipped.push({
          schema: reportName,
          operation: "ndjson.parse",
          reason: "NDJSON filters contain native, bound, or closure-dependent values",
        });
        return undefined;
      }
      const validator = emitValidatorBinding(binding, artifact.descriptor.schema, reportName, "ndjson.parse", {
        is: false,
        safeParse: true,
        resolveDefaults: true,
        materializeRuntimeTypes: true,
      });
      if (!validator) return undefined;
      mark("validationError");
      js.push(`${declaration} /*#__PURE__*/ (() => {`);
      js.push(...inlined.map((line) => `  ${line}`));
      js.push(`  return ${emitNdjsonSource(artifact.descriptor, validator)};`);
      js.push("})();");
      return { binding, type };
    }
    if (artifact.kind === "access-plan") {
      js.push(`${declaration} /*#__PURE__*/ (() => {`);
      js.push("  class __AccessDeniedError extends Error {");
      js.push("    constructor(action, field, reason, ruleId) {");
      js.push('      super("Access denied for action " + JSON.stringify(action));');
      js.push('      this.name = "AccessDeniedError";');
      js.push('      this.code = "ACCESS_DENIED";');
      js.push("      this.action = action;");
      js.push("      this.field = field;");
      js.push("      this.reason = reason;");
      js.push("      this.ruleId = ruleId;");
      js.push("    }");
      js.push("  }");
      js.push(`  return ${asExpression(emitAccessSource(artifact.descriptor), "access")};`);
      js.push("})();");
      return { binding, type };
    }
    if (artifact.kind === "rules-plan") {
      // A domain-event outcome uses the Runtime Class emitted beside it, so
      // the generated module never captures a runtime constructor.
      const bindingNames = new Map<string, string>();

      for (let index = 0; index < artifact.descriptor.bindingNames.length; index++) {
        const name = artifact.descriptor.bindingNames[index] as string;
        const emitted = classBindings.get(artifact.descriptor.bindings[index]);

        if (emitted === undefined) {
          if (RULES_OUTCOME_SINKS.has(artifact.sink)) {
            skipped.push({
              schema: reportName,
              operation: `rules.${artifact.sink}`,
              reason:
                "AOT rule outcomes require exporting the domain event Runtime Class artifact alongside the rules plan",
            });
            return undefined;
          }
          continue;
        }
        bindingNames.set(name, emitted);
      }

      const source = tryEmit(reportName, `rules.${artifact.sink}`, skipped, () =>
        emitRulesSinkSource(artifact.descriptor, artifact.sink, {
          bindingNames,
          ...(artifact.ruleId === undefined ? {} : { ruleId: artifact.ruleId }),
        })
      );

      if (!source) return undefined;
      js.push(`${declaration} /*#__PURE__*/ ${source};`);
      return { binding, type };
    }
    if (artifact.kind === "canonical-plan") {
      js.push(`${declaration} /*#__PURE__*/ ${emitCanonicalSource(artifact.schema)};`);
      return { binding, type };
    }
    if (artifact.kind === "reconcile-plan")
      return planEmitters.emitReconcilePlanArtifact(binding, declaration, artifact, reportName, type);
    if (artifact.kind === "class")
      return emitClassArtifact(
        classArtifactContext,
        binding,
        declaration,
        artifact,
        reportName,
        type,
        assertedClassType
      );
    if (artifact.kind === "derived-plan") {
      js.push(`${declaration} /*#__PURE__*/ (() => {`);
      for (const equal of artifact.equalSources) {
        js.push(`  const ${equal.name} = ${asExpression(equal.source, "equal")};`);
      }
      if (artifact.memo) {
        js.push(`  const memo = ${artifact.source};`);
        js.push(`  const __layout = Object.freeze(${JSON.stringify(artifact.layout)});`);
        js.push('  Object.defineProperty(memo, "layout", { value: () => __layout });');
        js.push('  Object.defineProperty(memo, "accepts", { value: (other) => other.id === __layout.id });');
        js.push("  return memo;");
      } else {
        js.push(...indentBlock(artifact.source));
        js.push("  return select;");
      }
      js.push("})();");
      return { binding, type };
    }

    const inlined = inlineBindings(artifact.bindingNames, artifact.bindingValues);

    if (inlined === undefined) {
      skipped.push({
        schema: reportName,
        operation: artifact.kind,
        reason: `${artifact.kind} bindings hold callbacks that cannot be serialized ahead of time`,
      });
      return undefined;
    }

    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...inlined.map((line) => `  ${line}`));
    js.push(`  return (${artifact.source});`);
    js.push("})();");
    return { binding, type };
  }

  /** Lowers a class descriptor into a plain class expression with no engine dependency. */

  /** Shared validator prelude: one compiled validator object per binding. */
  function emitValidatorBinding(
    binding: string,
    schema: ATS.AnyTypeSchema,
    reportName: string,
    operation: string,
    selection: {
      readonly is: boolean;
      readonly safeParse: boolean;
      readonly parse?: boolean;
      readonly resolveDefaults?: boolean;
      readonly materializeRuntimeTypes?: boolean;
      readonly validateChecks?: boolean;
      readonly maxIssues?: number;
    }
  ): string | undefined {
    const validator = tryEmit(reportName, operation, skipped, () =>
      emitValidator(schema, {
        is: selection.is,
        safeParse: selection.safeParse,
        safeParseAsync: false,
        fastParse: selection.parse === true,
        ...(selection.resolveDefaults === undefined ? {} : { resolveDefaults: selection.resolveDefaults }),
        ...(selection.materializeRuntimeTypes === undefined
          ? {}
          : { materializeRuntimeTypes: selection.materializeRuntimeTypes }),
        ...(selection.maxIssues === undefined ? {} : { maxIssues: selection.maxIssues }),
        ...(selection.validateChecks === undefined ? {} : { validateChecks: selection.validateChecks }),
      })
    );

    if (!validator) return undefined;

    const inlined: string[] = [];
    for (let index = 0; index < validator.bindings.names.length; index++) {
      const name = validator.bindings.names[index] as string;
      const value = validator.bindings.values[index];
      const classBinding = classBindings.get(value);
      if (classBinding !== undefined) {
        inlined.push(`const ${name} = ${classBinding};`);
        continue;
      }
      const assertionBinding = assertionBindings.get(value);
      if (assertionBinding !== undefined) {
        inlined.push(`const ${name} = ${assertionBinding};`);
        continue;
      }
      const literal = serializeBindingValue(value);
      if (literal === undefined) {
        skipped.push({
          schema: reportName,
          operation,
          reason: "refine/transform/default callbacks cannot be serialized ahead of time",
        });
        return undefined;
      }
      inlined.push(`const ${name} = ${literal};`);
    }

    const validatorName = internalIdentifier(`${binding}_validator`);

    js.push(`const ${validatorName} = /*#__PURE__*/ (() => {`);
    js.push(...inlined.map((line) => `  ${line}`));
    js.push(...indentBlock(validator.source));
    js.push("})();");
    return validatorName;
  }

  return emitArtifact;
}
