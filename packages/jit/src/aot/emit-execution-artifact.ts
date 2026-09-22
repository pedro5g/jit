import type { ExecutionPlan } from "../compiler/execution-plan.js";
import { emitStringifyChunksSource } from "../compiler/json-chunks.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import { type AotExecutionHost, emitExecutionArtifact as emitExecutionArtifactModule } from "./emit-execution.js";
import type { SkippedOperation } from "./generate.js";

interface EmittedBinding {
  readonly binding: string;
  readonly type: string;
}

export interface ExecutionArtifactEmitterContext {
  readonly js: string[];
  readonly ts: boolean;
  readonly skipped: SkippedOperation[];
  readonly classBindings: ReadonlyMap<unknown, string>;
  readonly classArtifacts: ReadonlyMap<unknown, Extract<CompiledArtifact, { readonly kind: "class" }>>;
  readonly mark: (flag: "validationError") => void;
  readonly internalIdentifier: (preferred: string) => string;
  readonly tryEmit: AotExecutionHost["tryEmit"];
  readonly inlineBindings: AotExecutionHost["inlineBindings"];
  readonly inlineCodecBindings: AotExecutionHost["inlineCodecBindings"];
  readonly serializeStaticData: AotExecutionHost["serializeStaticData"];
  readonly asExpression: AotExecutionHost["asExpression"];
  readonly indentBlock: AotExecutionHost["indentBlock"];
  readonly emitValidatorBinding: AotExecutionHost["emitValidatorBinding"];
  readonly emitOperationArtifact: AotExecutionHost["emitOperationArtifact"];
}

/** Adapts module-level generation state to the execution-plan emitter. */
export function createExecutionArtifactEmitter(context: ExecutionArtifactEmitterContext) {
  const {
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
    emitOperationArtifact,
  } = context;

  function emitExecutionArtifact(
    binding: string,
    declaration: string,
    plan: ExecutionPlan,
    reportName: string,
    type: string
  ): EmittedBinding | undefined {
    return emitExecutionArtifactModule(
      {
        js,
        typescript: context.ts,
        skipped,
        classBindings,
        classArtifacts,
        markValidationError: () => {
          mark("validationError");
        },
        internalIdentifier,
        tryEmit,
        inlineBindings,
        inlineCodecBindings,
        serializeStaticData,
        asExpression,
        indentBlock,
        emitStringifyChunks: (schema, options) =>
          tryEmit(reportName, "json.stringifyChunks", skipped, () => emitStringifyChunksSource(schema, options)),
        emitValidatorBinding,
        emitOperationArtifact,
      },
      binding,
      declaration,
      plan,
      reportName,
      type
    );
  }
  return { emitExecutionArtifact };
}
