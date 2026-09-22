import { emitAccessMutationGuardSource, emitAccessSource } from "../compiler/access.js";
import { emitCanonicalSource } from "../compiler/canonical.js";
import { emitCsvSource } from "../compiler/csv.js";
import { emitMatchSource } from "../compiler/match.js";
import { emitMigrationSource } from "../compiler/migration.js";
import { emitNdjsonSource } from "../compiler/ndjson.js";
import { emitAuthorizedProjectSource } from "../compiler/project.js";
import { emitRulesSinkSource, type RulesSink } from "../compiler/rules.js";
import { emitUpdateSource } from "../compiler/update.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import type { ArtifactDispatchContext, ArtifactEmissionArgs } from "./emit-artifact-dispatch-types.js";
import { emitDerivedArtifact, emitGenericArtifact } from "./emit-artifact-fallback.js";
import { artifactType } from "./emit-artifact-type.js";
import type { EmittedBinding } from "./emit-artifacts.js";
import { emitClassArtifact } from "./emit-class.js";

type ArtifactEmitter = (context: ArtifactDispatchContext, args: ArtifactEmissionArgs) => EmittedBinding | undefined;
type ArtifactKind = CompiledArtifact["kind"];

const RULES_OUTCOME_SINKS: ReadonlySet<RulesSink> = new Set<RulesSink>([
  "plan",
  "run",
  "visitor",
  "iterator",
  "many",
  "many-visitor",
  "many-iterator",
]);

const ARTIFACT_EMITTERS: Partial<Record<ArtifactKind, ArtifactEmitter>> = {
  validator: (context, args) =>
    context.validatorEmitters.emitValidatorArtifact(
      args.binding,
      args.declaration,
      artifactOf(args, "validator"),
      args.reportName,
      args.type
    ),
  operation: (context, args) =>
    context.operationEmitters.emitOperationArtifact(
      args.binding,
      args.declaration,
      artifactOf(args, "operation"),
      args.reportName,
      args.type
    ),
  execution: (context, args) =>
    context.executionEmitters.emitExecutionArtifact(
      args.binding,
      args.declaration,
      artifactOf(args, "execution").plan,
      args.reportName,
      args.type
    ),
  "query-plan": (context, args) =>
    context.queryEmitters.emitQueryPlanArtifact(
      args.binding,
      args.declaration,
      artifactOf(args, "query-plan"),
      args.reportName,
      args.type
    ),
  "join-plan": (context, args) =>
    context.queryEmitters.emitJoinPlanArtifact(
      args.binding,
      args.declaration,
      artifactOf(args, "join-plan"),
      args.reportName,
      args.type
    ),
  "cqrs-input": (context, args) =>
    context.queryEmitters.emitCqrsInputArtifact(
      args.binding,
      args.declaration,
      artifactOf(args, "cqrs-input"),
      args.reportName,
      args.type
    ),
  "cqrs-parser": (context, args) =>
    context.queryEmitters.emitCqrsParserArtifact(
      args.binding,
      args.declaration,
      artifactOf(args, "cqrs-parser"),
      args.reportName,
      args.type
    ),
  "cqrs-authorized-parser": (context, args) =>
    context.queryEmitters.emitCqrsAuthorizedParserArtifact(
      args.binding,
      args.declaration,
      artifactOf(args, "cqrs-authorized-parser"),
      args.reportName,
      args.type
    ),
  "collection-mutation-plan": emitCollectionMutation,
  "mutation-plan": emitMutation,
  "sort-plan": (context, args) =>
    context.planEmitters.emitSortPlanArtifact(args.binding, args.declaration, artifactOf(args, "sort-plan"), args.type),
  "index-plan": (context, args) =>
    context.planEmitters.emitIndexPlanArtifact(
      args.binding,
      args.declaration,
      artifactOf(args, "index-plan"),
      args.type
    ),
  "lookup-plan": (context, args) =>
    context.planEmitters.emitLookupPlanArtifact(
      args.binding,
      args.declaration,
      artifactOf(args, "lookup-plan"),
      args.type
    ),
  "project-plan": (context, args) =>
    context.planEmitters.emitProjectPlanArtifact(
      args.binding,
      args.declaration,
      artifactOf(args, "project-plan"),
      args.type
    ),
  "authorized-project-plan": emitAuthorizedProject,
  "authorized-update-plan": emitAuthorizedUpdate,
  "changed-plan": (context, args) =>
    context.planEmitters.emitChangedPlanArtifact(
      args.binding,
      args.declaration,
      artifactOf(args, "changed-plan"),
      args.type
    ),
  "patch-plan": (context, args) =>
    context.planEmitters.emitPatchPlanArtifact(
      args.binding,
      args.declaration,
      artifactOf(args, "patch-plan"),
      args.type
    ),
  "cache-key-plan": (context, args) =>
    context.planEmitters.emitCacheKeyPlanArtifact(
      args.binding,
      args.declaration,
      artifactOf(args, "cache-key-plan"),
      args.type
    ),
  "match-plan": emitMatch,
  "migration-plan": emitMigration,
  "csv-plan": emitCsv,
  "ndjson-plan": emitNdjson,
  "access-plan": emitAccess,
  "rules-plan": emitRules,
  "canonical-plan": emitCanonical,
  "reconcile-plan": (context, args) =>
    context.planEmitters.emitReconcilePlanArtifact(
      args.binding,
      args.declaration,
      artifactOf(args, "reconcile-plan"),
      args.reportName,
      args.type
    ),
  class: (context, args) =>
    emitClassArtifact(
      context.classArtifactContext,
      args.binding,
      args.declaration,
      artifactOf(args, "class"),
      args.reportName,
      args.type,
      args.assertedClassType
    ),
  "derived-plan": emitDerivedArtifact,
};

/** Creates the single artifact dispatcher used by one generated AOT module. */
export function createArtifactDispatcher(context: ArtifactDispatchContext) {
  return (
    binding: string,
    artifact: CompiledArtifact,
    reportName: string,
    importedType: string | undefined,
    annotate: boolean
  ) => {
    const type = importedType ?? artifactType(context.artifactTypeContext, artifact);
    const assertedClassType = artifact.kind === "class" && annotate && context.ts ? type : undefined;
    const declaration = `const ${binding}${annotate && context.ts && assertedClassType === undefined ? `: ${type}` : ""} =`;
    if (importedType?.startsWith("__JitCall<")) context.mark("callHelper");
    const args = { binding, artifact, reportName, importedType, annotate, declaration, type, assertedClassType };
    const emitter = ARTIFACT_EMITTERS[artifact.kind];
    return emitter === undefined ? emitGenericArtifact(context, args) : emitter(context, args);
  };
}

function artifactOf<TKind extends ArtifactKind>(
  args: ArtifactEmissionArgs,
  _kind: TKind
): Extract<CompiledArtifact, { readonly kind: TKind }> {
  return args.artifact as Extract<CompiledArtifact, { readonly kind: TKind }>;
}

function emitCollectionMutation(
  context: ArtifactDispatchContext,
  args: ArtifactEmissionArgs
): EmittedBinding | undefined {
  const artifact = artifactOf(args, "collection-mutation-plan");
  const inlined = context.inlineBindings(artifact.bindingNames, artifact.bindingValues);
  if (inlined === undefined) {
    context.skipped.push({
      schema: args.reportName,
      operation: "state.collection",
      reason: "a declared patch value cannot be serialized ahead of time",
    });
    return undefined;
  }
  if (artifact.source.includes("__cachedIndex")) context.mark("runtimeCachedIndex");
  context.js.push(`${args.declaration} /*#__PURE__*/ (() => {`, ...inlined.map((line) => `  ${line}`));
  if (artifact.equalSource !== undefined) {
    context.js.push(`  const __equal = ${context.asExpression(artifact.equalSource, "equal")};`);
  }
  context.js.push(`  return ${artifact.source};`, "})();");
  return { binding: args.binding, type: args.type };
}

function emitMutation(context: ArtifactDispatchContext, args: ArtifactEmissionArgs): EmittedBinding | undefined {
  const artifact = artifactOf(args, "mutation-plan");
  const inlined = context.inlineBindings(artifact.bindingNames, artifact.bindingValues);
  if (inlined === undefined) {
    context.skipped.push({
      schema: args.reportName,
      operation: "state.update.patch",
      reason: "a declared patch value cannot be serialized ahead of time",
    });
    return undefined;
  }
  context.js.push(`${args.declaration} /*#__PURE__*/ (() => {`, ...inlined.map((line) => `  ${line}`));
  context.js.push(
    ...(artifact.layout === undefined
      ? context.indentBlock(artifact.source)
      : [
          ...context.indentBlock(artifact.source.replace("return function mutate", "const mutate = function mutate")),
          `  const __layout = Object.freeze(${JSON.stringify(artifact.layout)});`,
          '  Object.defineProperty(mutate, "layout", { value: () => __layout });',
          "  return mutate;",
        ]),
    "})();"
  );
  return { binding: args.binding, type: args.type };
}

function emitAuthorizedProject(
  context: ArtifactDispatchContext,
  args: ArtifactEmissionArgs
): EmittedBinding | undefined {
  const artifact = artifactOf(args, "authorized-project-plan");
  const actor = context.serializeStaticData(artifact.actor);
  if (actor === undefined) {
    context.skipped.push({
      schema: args.reportName,
      operation: "project.authorize",
      reason: "the bound actor cannot be serialized ahead of time",
    });
    return undefined;
  }
  context.js.push(
    `${args.declaration} /*#__PURE__*/ (() => {`,
    `  const __actor = ${actor};`,
    `  return ${context.asExpression(emitAuthorizedProjectSource(artifact, artifact.action), "project")};`,
    "})();"
  );
  return { binding: args.binding, type: args.type };
}

function emitAuthorizedUpdate(
  context: ArtifactDispatchContext,
  args: ArtifactEmissionArgs
): EmittedBinding | undefined {
  const artifact = artifactOf(args, "authorized-update-plan");
  const actor = context.serializeStaticData(artifact.actor);
  if (actor === undefined) {
    context.skipped.push({
      schema: args.reportName,
      operation: "update.authorize",
      reason: "the bound actor cannot be serialized ahead of time",
    });
    return undefined;
  }
  context.js.push(
    `${args.declaration} /*#__PURE__*/ (() => {`,
    `  const actor = ${actor};`,
    "  class __AccessDeniedError extends Error {",
    "    constructor(action, field, reason) {",
    '      super("Access denied for action " + JSON.stringify(action));',
    '      this.name = "AccessDeniedError";',
    '      this.code = "ACCESS_DENIED";',
    "      this.action = action;",
    "      this.field = field;",
    "      this.reason = reason;",
    "    }",
    "  }",
    `  const update = ${context.asExpression(emitUpdateSource(artifact.schema), "update")};`,
    ...context.indentBlock(emitAccessMutationGuardSource(artifact.descriptor, artifact.action)),
    "  return function authorizedUpdate(value, patch) {",
    "    authorizeMutation(value, patch);",
    "    return update(value, patch);",
    "  };",
    "})();"
  );
  return { binding: args.binding, type: args.type };
}

function emitMatch(context: ArtifactDispatchContext, args: ArtifactEmissionArgs): EmittedBinding | undefined {
  const artifact = artifactOf(args, "match-plan");
  const inlined = context.inlineBindings(artifact.bindingNames, artifact.bindingValues);
  if (inlined === undefined) {
    context.skipped.push({
      schema: args.reportName,
      operation: "match",
      reason: "match handlers contain native, bound, or closure-dependent callbacks",
    });
    return undefined;
  }
  context.js.push(
    `${args.declaration} /*#__PURE__*/ (() => {`,
    ...inlined.map((line) => `  ${line}`),
    `  return ${context.asExpression(emitMatchSource(artifact.descriptor), "match")};`,
    "})();"
  );
  return { binding: args.binding, type: args.type };
}

function emitMigration(context: ArtifactDispatchContext, args: ArtifactEmissionArgs): EmittedBinding | undefined {
  const artifact = artifactOf(args, "migration-plan");
  const inlined = context.inlineBindings(artifact.descriptor.bindingNames, artifact.descriptor.bindingValues);
  if (inlined === undefined) {
    context.skipped.push({
      schema: args.reportName,
      operation: "migrate",
      reason: "migration mappings contain native, bound, or closure-dependent callbacks",
    });
    return undefined;
  }
  context.js.push(
    `${args.declaration} /*#__PURE__*/ (() => {`,
    ...inlined.map((line) => `  ${line}`),
    `  return ${emitMigrationSource(artifact.descriptor)};`,
    "})();"
  );
  return { binding: args.binding, type: args.type };
}

function emitCsv(context: ArtifactDispatchContext, args: ArtifactEmissionArgs): EmittedBinding | undefined {
  const artifact = artifactOf(args, "csv-plan");
  if (artifact.descriptor.operation === "stringify") {
    context.js.push(
      `${args.declaration} /*#__PURE__*/ ${context.asExpression(emitCsvSource(artifact.descriptor), "csvStringify")};`
    );
    return { binding: args.binding, type: args.type };
  }
  const validator = context.emitValidatorBinding(
    args.binding,
    artifact.descriptor.schema,
    args.reportName,
    "csv.parse",
    {
      is: false,
      safeParse: true,
      resolveDefaults: true,
      materializeRuntimeTypes: true,
    }
  );
  if (!validator) return undefined;
  context.mark("validationError");
  context.js.push(
    `${args.declaration} /*#__PURE__*/ ${context.asExpression(emitCsvSource(artifact.descriptor, validator), "csvParse")};`
  );
  return { binding: args.binding, type: args.type };
}

function emitNdjson(context: ArtifactDispatchContext, args: ArtifactEmissionArgs): EmittedBinding | undefined {
  const artifact = artifactOf(args, "ndjson-plan");
  if (artifact.descriptor.operation === "stringify") {
    context.js.push(`${args.declaration} /*#__PURE__*/ ${emitNdjsonSource(artifact.descriptor)};`);
    return { binding: args.binding, type: args.type };
  }
  const inlined = context.inlineBindings(artifact.descriptor.bindingNames, artifact.descriptor.bindingValues);
  if (inlined === undefined) {
    context.skipped.push({
      schema: args.reportName,
      operation: "ndjson.parse",
      reason: "NDJSON filters contain native, bound, or closure-dependent values",
    });
    return undefined;
  }
  const validator = context.emitValidatorBinding(
    args.binding,
    artifact.descriptor.schema,
    args.reportName,
    "ndjson.parse",
    {
      is: false,
      safeParse: true,
      resolveDefaults: true,
      materializeRuntimeTypes: true,
    }
  );
  if (!validator) return undefined;
  context.mark("validationError");
  context.js.push(`${args.declaration} /*#__PURE__*/ (() => {`, ...inlined.map((line) => `  ${line}`));
  context.js.push(`  return ${emitNdjsonSource(artifact.descriptor, validator)};`, "})();");
  return { binding: args.binding, type: args.type };
}

function emitAccess(context: ArtifactDispatchContext, args: ArtifactEmissionArgs): EmittedBinding {
  const artifact = artifactOf(args, "access-plan");
  context.js.push(
    `${args.declaration} /*#__PURE__*/ (() => {`,
    "  class __AccessDeniedError extends Error {",
    "    constructor(action, field, reason, ruleId) {",
    '      super("Access denied for action " + JSON.stringify(action));',
    '      this.name = "AccessDeniedError";',
    '      this.code = "ACCESS_DENIED";',
    "      this.action = action;",
    "      this.field = field;",
    "      this.reason = reason;",
    "      this.ruleId = ruleId;",
    "    }",
    "  }",
    `  return ${context.asExpression(emitAccessSource(artifact.descriptor), "access")};`,
    "})();"
  );
  return { binding: args.binding, type: args.type };
}

function emitRules(context: ArtifactDispatchContext, args: ArtifactEmissionArgs): EmittedBinding | undefined {
  const artifact = artifactOf(args, "rules-plan");
  const bindingNames = new Map<string, string>();
  for (let index = 0; index < artifact.descriptor.bindingNames.length; index++) {
    const name = artifact.descriptor.bindingNames[index] as string;
    const emitted = context.classBindings.get(artifact.descriptor.bindings[index]);
    if (emitted === undefined) {
      if (RULES_OUTCOME_SINKS.has(artifact.sink)) {
        context.skipped.push({
          schema: args.reportName,
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
  const source = context.tryEmit(args.reportName, `rules.${artifact.sink}`, context.skipped, () =>
    emitRulesSinkSource(artifact.descriptor, artifact.sink, {
      bindingNames,
      ...(artifact.ruleId === undefined ? {} : { ruleId: artifact.ruleId }),
      typescript: context.ts,
    })
  );
  if (!source) return undefined;
  context.js.push(`${args.declaration} /*#__PURE__*/ ${source};`);
  return { binding: args.binding, type: args.type };
}

function emitCanonical(context: ArtifactDispatchContext, args: ArtifactEmissionArgs): EmittedBinding {
  const artifact = artifactOf(args, "canonical-plan");
  context.js.push(`${args.declaration} /*#__PURE__*/ ${emitCanonicalSource(artifact.schema)};`);
  return { binding: args.binding, type: args.type };
}
