import type { ArtifactTypeContext } from "./artifact-type-context.js";
import { createArtifactDispatcher } from "./emit-artifact-dispatch.js";
import type { ClassArtifactEmitContext } from "./emit-class-types.js";
import type { ArtifactEmitterBaseContext } from "./emit-context-types.js";
import { createExecutionArtifactEmitter } from "./emit-execution-artifact.js";
import { createOperationArtifactEmitter } from "./emit-operation-artifacts.js";
import { createPlanArtifactEmitters } from "./emit-plan-artifacts.js";
import { createQueryArtifactEmitters } from "./emit-query-artifacts.js";
import { createValidatorArtifactEmitter } from "./emit-validator-artifact.js";
import { createValidatorBindingEmitter } from "./emit-validator-binding.js";

export type { ArtifactEmitterFlag, EmittedBinding } from "./emit-context-types.js";

export interface ArtifactEmitterContext extends ArtifactEmitterBaseContext {
  readonly artifactTypeContext: ArtifactTypeContext;
  readonly classArtifactContext: Omit<ClassArtifactEmitContext, "emitValidatorBinding" | "emitHashBinding">;
}

/** Builds the artifact-kind dispatcher used by one generated AOT module. */
export function createArtifactEmitter(context: ArtifactEmitterContext) {
  const emitValidatorBinding = createValidatorBinding(context);
  const planEmitters = createPlanEmitters(context);
  const queryEmitters = createQueryEmitters(context, planEmitters);
  const operationEmitters = createOperationEmitters(context, planEmitters, emitValidatorBinding);
  const validatorEmitters = createValidatorEmitters(context, emitValidatorBinding);
  const executionEmitters = createExecutionEmitters(context, operationEmitters, emitValidatorBinding);
  const classArtifactContext = createClassArtifactContext(context, planEmitters, emitValidatorBinding);
  return createArtifactDispatcher({
    ...context,
    classArtifactContext,
    planEmitters,
    queryEmitters,
    operationEmitters,
    validatorEmitters,
    executionEmitters,
    emitValidatorBinding,
  });
}

function createValidatorBinding(context: ArtifactEmitterContext) {
  return createValidatorBindingEmitter({
    js: context.js,
    skipped: context.skipped,
    classBindings: context.classBindings,
    assertionBindings: context.assertionBindings,
    internalIdentifier: context.internalIdentifier,
    serializeBindingValue: context.serializeBindingValue,
    indentBlock: context.indentBlock,
    tryEmit: context.tryEmit,
  });
}

function createPlanEmitters(context: ArtifactEmitterContext) {
  return createPlanArtifactEmitters({
    js: context.js,
    skipped: context.skipped,
    mark: context.mark,
    internalIdentifier: context.internalIdentifier,
    asExpression: context.asExpression,
    indentBlock: context.indentBlock,
    tryEmit: context.tryEmit,
  });
}

function createQueryEmitters(
  context: ArtifactEmitterContext,
  planEmitters: ReturnType<typeof createPlanArtifactEmitters>
) {
  return createQueryArtifactEmitters({
    js: context.js,
    skipped: context.skipped,
    internalIdentifier: context.internalIdentifier,
    inlineBindings: context.inlineBindings,
    indentBlock: context.indentBlock,
    tryEmit: context.tryEmit,
    mark: context.mark,
    planEmitters,
  });
}

function createOperationEmitters(
  context: ArtifactEmitterContext,
  planEmitters: ReturnType<typeof createPlanArtifactEmitters>,
  emitValidatorBinding: ReturnType<typeof createValidatorBindingEmitter>
) {
  return createOperationArtifactEmitter({
    js: context.js,
    skipped: context.skipped,
    mark: context.mark,
    internalIdentifier: context.internalIdentifier,
    asExpression: context.asExpression,
    indentBlock: context.indentBlock,
    tryEmit: context.tryEmit,
    inlineCodecBindings: context.inlineCodecBindings,
    emitValidatorBinding,
    planEmitters,
  });
}

function createValidatorEmitters(
  context: ArtifactEmitterContext,
  emitValidatorBinding: ReturnType<typeof createValidatorBindingEmitter>
) {
  return createValidatorArtifactEmitter({
    js: context.js,
    skipped: context.skipped,
    mark: context.mark,
    emitValidatorBinding,
  });
}

function createExecutionEmitters(
  context: ArtifactEmitterContext,
  operationEmitters: ReturnType<typeof createOperationArtifactEmitter>,
  emitValidatorBinding: ReturnType<typeof createValidatorBindingEmitter>
) {
  return createExecutionArtifactEmitter({
    js: context.js,
    skipped: context.skipped,
    classBindings: context.classBindings,
    classArtifacts: context.classArtifacts,
    mark: context.mark,
    internalIdentifier: context.internalIdentifier,
    tryEmit: context.tryEmit,
    inlineBindings: context.inlineBindings,
    inlineCodecBindings: context.inlineCodecBindings,
    serializeStaticData: context.serializeStaticData,
    asExpression: context.asExpression,
    indentBlock: context.indentBlock,
    emitValidatorBinding,
    emitOperationArtifact: operationEmitters.emitOperationArtifact,
  });
}

function createClassArtifactContext(
  context: ArtifactEmitterContext,
  planEmitters: ReturnType<typeof createPlanArtifactEmitters>,
  emitValidatorBinding: ReturnType<typeof createValidatorBindingEmitter>
): ClassArtifactEmitContext {
  return {
    ...context.classArtifactContext,
    mark: context.mark,
    emitValidatorBinding,
    emitHashBinding: planEmitters.emitHashBinding,
  };
}
