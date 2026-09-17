import { emitJoinSource } from "../compiler/join.js";
import { emitQueryPlanSource, type LazyQueryProgram } from "../compiler/lazy-query.js";
import { expectCollectionObjectSchema, type QueryProgram } from "../compiler/query.js";
import type * as ATS from "../core/ats/index.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import type { SkippedOperation } from "./generate.js";

interface EmittedBinding {
  readonly binding: string;
  readonly type: string;
}

interface QueryArtifactPlanEmitters {
  readonly emitHashBinding: (
    binding: string,
    schema: ATS.AnyTypeSchema,
    reportName: string,
    cache?: boolean
  ) => string | undefined;
  readonly emitEqualBinding: (binding: string, schema: ATS.AnyTypeSchema, reportName: string) => string | undefined;
}

export interface QueryArtifactEmitterContext {
  readonly js: string[];
  readonly skipped: SkippedOperation[];
  readonly internalIdentifier: (preferred: string) => string;
  readonly inlineBindings: (names: readonly string[], values: readonly unknown[]) => string[] | undefined;
  readonly indentBlock: (source: string) => string[];
  readonly tryEmit: <TValue>(
    schema: string,
    operation: string,
    skipped: SkippedOperation[],
    emit: () => TValue
  ) => TValue | undefined;
  readonly mark: (flag: "runtimeCachedIndex") => void;
  readonly planEmitters: QueryArtifactPlanEmitters;
}

export interface QueryArtifactEmitters {
  readonly emitQueryPlanArtifact: (
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "query-plan" }>,
    reportName: string,
    type: string
  ) => EmittedBinding | undefined;
  readonly emitJoinPlanArtifact: (
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "join-plan" }>,
    reportName: string,
    type: string
  ) => EmittedBinding | undefined;
  readonly emitCqrsInputArtifact: (
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "cqrs-input" }>,
    reportName: string,
    type: string
  ) => EmittedBinding | undefined;
  readonly emitCqrsAuthorizedParserArtifact: (
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "cqrs-authorized-parser" }>,
    reportName: string,
    type: string
  ) => EmittedBinding | undefined;
  readonly emitCqrsParserArtifact: (
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "cqrs-parser" }>,
    reportName: string,
    type: string
  ) => EmittedBinding | undefined;
}

type QueryArtifactArguments<TFunction> = TFunction extends (
  context: QueryArtifactEmitterContext,
  ...args: infer Arguments
) => unknown
  ? Arguments
  : never;

/** Creates emitters for query, join, and CQRS boundary artifacts. */
export function createQueryArtifactEmitters(context: QueryArtifactEmitterContext): QueryArtifactEmitters {
  return {
    emitQueryPlanArtifact: (...args: QueryArtifactArguments<typeof emitQueryPlanArtifact>) =>
      emitQueryPlanArtifact(
        context,
        args[0],
        args[1],
        args[2] as Extract<CompiledArtifact, { readonly kind: "query-plan" }>,
        args[3],
        args[4]
      ),
    emitJoinPlanArtifact: (...args: QueryArtifactArguments<typeof emitJoinPlanArtifact>) =>
      emitJoinPlanArtifact(
        context,
        args[0],
        args[1],
        args[2] as Extract<CompiledArtifact, { readonly kind: "join-plan" }>,
        args[3],
        args[4]
      ),
    emitCqrsInputArtifact: (...args: QueryArtifactArguments<typeof emitCqrsInputArtifact>) =>
      emitCqrsInputArtifact(
        context,
        args[0],
        args[1],
        args[2] as Extract<CompiledArtifact, { readonly kind: "cqrs-input" }>,
        args[3],
        args[4]
      ),
    emitCqrsAuthorizedParserArtifact: (...args: QueryArtifactArguments<typeof emitCqrsAuthorizedParserArtifact>) =>
      emitCqrsAuthorizedParserArtifact(
        context,
        args[0],
        args[1],
        args[2] as Extract<CompiledArtifact, { readonly kind: "cqrs-authorized-parser" }>,
        args[3],
        args[4]
      ),
    emitCqrsParserArtifact: (...args: QueryArtifactArguments<typeof emitCqrsParserArtifact>) =>
      emitCqrsParserArtifact(
        context,
        args[0],
        args[1],
        args[2] as Extract<CompiledArtifact, { readonly kind: "cqrs-parser" }>,
        args[3],
        args[4]
      ),
  };
}

function emitQueryPlanArtifact(
  context: QueryArtifactEmitterContext,
  binding: string,
  declaration: string,
  artifact: Extract<CompiledArtifact, { readonly kind: "query-plan" }>,
  reportName: string,
  type: string
): EmittedBinding | undefined {
  const program = artifact.program as QueryProgram & LazyQueryProgram;
  const source = context.tryEmit(reportName, "query", context.skipped, () =>
    emitQueryPlanSource(artifact.schema, program, artifact.mode)
  );

  if (!source) return undefined;
  if (source.includes("__cachedIndex")) context.mark("runtimeCachedIndex");

  const inlined = context.inlineBindings(
    program.bindings.map((_, index) => `__q${index}`),
    program.bindings
  );
  if (inlined === undefined) {
    context.skipped.push({
      schema: reportName,
      operation: "query",
      reason: "query bindings hold callbacks that cannot be serialized ahead of time",
    });
    return undefined;
  }

  const distinct = emitDistinctBindings(context, binding, artifact, source, reportName);
  if (distinct === undefined) return undefined;
  const standard = artifact.standard === undefined ? undefined : JSON.stringify(artifact.standard);
  context.js.push(`${declaration} /*#__PURE__*/ (() => {`);
  context.js.push(...inlined.map((line) => `  ${line}`));
  if (distinct) {
    context.js.push(`  const __distinctHash = ${distinct.hash};`, `  const __distinctEqual = ${distinct.equal};`);
  }
  context.js.push(
    ...context.indentBlock(
      standard === undefined
        ? `return (${source});`
        : `const query = (${source}); Object.defineProperty(query, "~query", { value: ${standard} }); return query;`
    ),
    "})();"
  );
  return { binding, type };
}

function emitDistinctBindings(
  context: QueryArtifactEmitterContext,
  binding: string,
  artifact: Extract<CompiledArtifact, { readonly kind: "query-plan" }>,
  source: string,
  reportName: string
): { readonly hash: string; readonly equal: string } | undefined | null {
  if (!source.includes("__distinctHash")) return null;
  const objectSchema = expectCollectionObjectSchema(artifact.schema, "AOT distinct").objectSchema;
  const hash = context.internalIdentifier(`${binding}_distinct_hash`);
  const equal = context.internalIdentifier(`${binding}_distinct_equal`);
  if (!context.planEmitters.emitHashBinding(hash, objectSchema, reportName, false)) return undefined;
  if (!context.planEmitters.emitEqualBinding(equal, objectSchema, reportName)) return undefined;
  return { hash, equal };
}

function emitJoinPlanArtifact(
  context: QueryArtifactEmitterContext,
  binding: string,
  declaration: string,
  artifact: Extract<CompiledArtifact, { readonly kind: "join-plan" }>,
  reportName: string,
  type: string
): EmittedBinding | undefined {
  const source = context.tryEmit(reportName, "join", context.skipped, () => emitJoinSource(artifact.plan));
  if (!source) return undefined;
  if (source.includes("__cachedIndex")) context.mark("runtimeCachedIndex");
  const bindings = artifact.plan.leftProgram.bindings;
  const inlined = context.inlineBindings(
    bindings.map((_, index) => `__q${index}`),
    bindings
  );
  if (inlined === undefined) {
    context.skipped.push({
      schema: reportName,
      operation: "join",
      reason: "join bindings hold callbacks that cannot be serialized ahead of time",
    });
    return undefined;
  }
  const standard = artifact.standard === undefined ? undefined : JSON.stringify(artifact.standard);
  context.js.push(`${declaration} /*#__PURE__*/ (() => {`);
  context.js.push(...inlined.map((line) => `  ${line}`));
  context.js.push(
    ...context.indentBlock(
      standard === undefined
        ? `return (${source});`
        : `const join = (${source}); Object.defineProperty(join, "~query", { value: ${standard} }); return join;`
    ),
    "})();"
  );
  return { binding, type };
}

function emitCqrsInputArtifact(
  context: QueryArtifactEmitterContext,
  binding: string,
  declaration: string,
  artifact: Extract<CompiledArtifact, { readonly kind: "cqrs-input" }>,
  reportName: string,
  type: string
): EmittedBinding | undefined {
  const definition = JSON.stringify(artifact.definition);
  if (definition === undefined) {
    context.skipped.push({
      schema: reportName,
      operation: "cqrs-input",
      reason: "CQRS definition cannot be serialized",
    });
    return undefined;
  }
  const explanation = JSON.stringify(artifact.explanation);
  if (explanation === undefined) {
    context.skipped.push({
      schema: reportName,
      operation: "cqrs-input",
      reason: "CQRS boundary explanation cannot be serialized",
    });
    return undefined;
  }
  const parserSource = artifact.source.replace("return function parse", "const parse = function parse");
  context.js.push(`${declaration} /*#__PURE__*/ (() => {`);
  context.js.push(...context.indentBlock(parserSource));
  context.js.push(
    `  const explanation = Object.freeze(${explanation});`,
    `  return Object.freeze({ "~query": Object.freeze({ version: 1, definition: ${definition} }), parse, explain: () => explanation });`,
    "})();"
  );
  return { binding, type };
}

function emitCqrsAuthorizedParserArtifact(
  context: QueryArtifactEmitterContext,
  binding: string,
  declaration: string,
  artifact: Extract<CompiledArtifact, { readonly kind: "cqrs-authorized-parser" }>,
  reportName: string,
  type: string
): EmittedBinding | undefined {
  const inlined = context.inlineBindings(artifact.bindingNames, artifact.bindingValues);
  if (inlined === undefined) {
    context.skipped.push({
      schema: reportName,
      operation: "cqrs-authorize",
      reason: "an access rule value cannot be serialized ahead of time",
    });
    return undefined;
  }
  context.js.push(
    `${declaration} /*#__PURE__*/ (() => {`,
    ...inlined.map((line) => `  ${line}`),
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
    ...context.indentBlock(artifact.source),
    "})();"
  );
  return { binding, type };
}

function emitCqrsParserArtifact(
  context: QueryArtifactEmitterContext,
  binding: string,
  declaration: string,
  artifact: Extract<CompiledArtifact, { readonly kind: "cqrs-parser" }>,
  reportName: string,
  type: string
): EmittedBinding | undefined {
  if (JSON.stringify(artifact.definition) === undefined) {
    context.skipped.push({
      schema: reportName,
      operation: "cqrs-parser",
      reason: "CQRS definition cannot be serialized",
    });
    return undefined;
  }
  context.js.push(`${declaration} /*#__PURE__*/ (() => {`, ...context.indentBlock(artifact.source), "})();");
  return { binding, type };
}
