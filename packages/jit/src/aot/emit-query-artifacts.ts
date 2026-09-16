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

/** Creates emitters for query, join, and CQRS boundary artifacts. */
export function createQueryArtifactEmitters(context: QueryArtifactEmitterContext) {
  const { js, skipped, internalIdentifier, inlineBindings, indentBlock, tryEmit, mark, planEmitters } = context;

  function emitQueryPlanArtifact(
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "query-plan" }>,
    reportName: string,
    type: string
  ): EmittedBinding | undefined {
    const program = artifact.program as QueryProgram & LazyQueryProgram;
    const source = tryEmit(reportName, "query", skipped, () =>
      emitQueryPlanSource(artifact.schema, program, artifact.mode)
    );

    if (!source) return undefined;
    // A keyed access path reaches rows through the shared per-array cache.
    if (source.includes("__cachedIndex")) mark("runtimeCachedIndex");

    const inlined = inlineBindings(
      program.bindings.map((_, index) => `__q${index}`),
      program.bindings
    );

    if (inlined === undefined) {
      skipped.push({
        schema: reportName,
        operation: "query",
        reason: "query bindings hold callbacks that cannot be serialized ahead of time",
      });
      return undefined;
    }

    let distinctHash: string | undefined;
    let distinctEqual: string | undefined;
    if (source.includes("__distinctHash")) {
      const objectSchema = expectCollectionObjectSchema(artifact.schema, "AOT distinct").objectSchema;
      distinctHash = internalIdentifier(`${binding}_distinct_hash`);
      distinctEqual = internalIdentifier(`${binding}_distinct_equal`);
      if (!planEmitters.emitHashBinding(distinctHash, objectSchema, reportName, false)) return undefined;
      if (!planEmitters.emitEqualBinding(distinctEqual, objectSchema, reportName)) return undefined;
    }

    const standard = artifact.standard === undefined ? undefined : JSON.stringify(artifact.standard);
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...inlined.map((line) => `  ${line}`));
    if (distinctHash && distinctEqual) {
      js.push(`  const __distinctHash = ${distinctHash};`);
      js.push(`  const __distinctEqual = ${distinctEqual};`);
    }
    js.push(
      ...indentBlock(
        standard === undefined
          ? `return (${source});`
          : `const query = (${source}); Object.defineProperty(query, "~query", { value: ${standard} }); return query;`
      )
    );
    js.push("})();");
    return { binding, type };
  }

  function emitJoinPlanArtifact(
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "join-plan" }>,
    reportName: string,
    type: string
  ): EmittedBinding | undefined {
    const source = tryEmit(reportName, "join", skipped, () => emitJoinSource(artifact.plan));
    if (!source) return undefined;
    if (source.includes("__cachedIndex")) mark("runtimeCachedIndex");

    const bindings = artifact.plan.leftProgram.bindings;
    const inlined = inlineBindings(
      bindings.map((_, index) => `__q${index}`),
      bindings
    );
    if (inlined === undefined) {
      skipped.push({
        schema: reportName,
        operation: "join",
        reason: "join bindings hold callbacks that cannot be serialized ahead of time",
      });
      return undefined;
    }

    const standard = artifact.standard === undefined ? undefined : JSON.stringify(artifact.standard);
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...inlined.map((line) => `  ${line}`));
    js.push(
      ...indentBlock(
        standard === undefined
          ? `return (${source});`
          : `const join = (${source}); Object.defineProperty(join, "~query", { value: ${standard} }); return join;`
      )
    );
    js.push("})();");
    return { binding, type };
  }

  function emitCqrsInputArtifact(
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "cqrs-input" }>,
    reportName: string,
    type: string
  ): EmittedBinding | undefined {
    const definition = JSON.stringify(artifact.definition);
    if (definition === undefined) {
      skipped.push({
        schema: reportName,
        operation: "cqrs-input",
        reason: "CQRS definition cannot be serialized",
      });
      return undefined;
    }
    const explanation = JSON.stringify(artifact.explanation);
    if (explanation === undefined) {
      skipped.push({
        schema: reportName,
        operation: "cqrs-input",
        reason: "CQRS boundary explanation cannot be serialized",
      });
      return undefined;
    }
    const parserSource = artifact.source.replace("return function parse", "const parse = function parse");
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...indentBlock(parserSource));
    js.push(`  const explanation = Object.freeze(${explanation});`);
    js.push(
      `  return Object.freeze({ "~query": Object.freeze({ version: 1, definition: ${definition} }), parse, explain: () => explanation });`
    );
    js.push("})();");
    return { binding, type };
  }

  function emitCqrsAuthorizedParserArtifact(
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "cqrs-authorized-parser" }>,
    reportName: string,
    type: string
  ): EmittedBinding | undefined {
    const inlined = inlineBindings(artifact.bindingNames, artifact.bindingValues);
    if (inlined === undefined) {
      skipped.push({
        schema: reportName,
        operation: "cqrs-authorize",
        reason: "an access rule value cannot be serialized ahead of time",
      });
      return undefined;
    }
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...inlined.map((line) => `  ${line}`));
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
    js.push(...indentBlock(artifact.source));
    js.push("})();");
    return { binding, type };
  }

  function emitCqrsParserArtifact(
    binding: string,
    declaration: string,
    artifact: Extract<CompiledArtifact, { readonly kind: "cqrs-parser" }>,
    reportName: string,
    type: string
  ): EmittedBinding | undefined {
    if (JSON.stringify(artifact.definition) === undefined) {
      skipped.push({
        schema: reportName,
        operation: "cqrs-parser",
        reason: "CQRS definition cannot be serialized",
      });
      return undefined;
    }
    js.push(`${declaration} /*#__PURE__*/ (() => {`);
    js.push(...indentBlock(artifact.source));
    js.push("})();");
    return { binding, type };
  }
  return {
    emitQueryPlanArtifact,
    emitJoinPlanArtifact,
    emitCqrsInputArtifact,
    emitCqrsAuthorizedParserArtifact,
    emitCqrsParserArtifact,
  };
}
