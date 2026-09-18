import type * as ATS from "../core/ats/index.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import type { ArtifactTypeContext } from "./artifact-type-context.js";
import type { ClassArtifactEmitContext } from "./emit-class-types.js";
import type { ArtifactEmitterBaseContext } from "./emit-context-types.js";
import type { ValidatorBindingSelection } from "./emit-validator-binding.js";

export interface ArtifactDispatchContext extends ArtifactEmitterBaseContext {
  readonly artifactTypeContext: ArtifactTypeContext;
  readonly classArtifactContext: ClassArtifactEmitContext;
  readonly planEmitters: ReturnType<typeof import("./emit-plan-artifacts.js").createPlanArtifactEmitters>;
  readonly queryEmitters: ReturnType<typeof import("./emit-query-artifacts.js").createQueryArtifactEmitters>;
  readonly operationEmitters: ReturnType<typeof import("./emit-operation-artifacts.js").createOperationArtifactEmitter>;
  readonly validatorEmitters: ReturnType<typeof import("./emit-validator-artifact.js").createValidatorArtifactEmitter>;
  readonly executionEmitters: ReturnType<typeof import("./emit-execution-artifact.js").createExecutionArtifactEmitter>;
  readonly emitValidatorBinding: (
    binding: string,
    schema: ATS.AnyTypeSchema,
    reportName: string,
    operation: string,
    selection: ValidatorBindingSelection
  ) => string | undefined;
}

export interface ArtifactEmissionArgs {
  readonly binding: string;
  readonly artifact: CompiledArtifact;
  readonly reportName: string;
  readonly importedType: string | undefined;
  readonly annotate: boolean;
  readonly declaration: string;
  readonly type: string;
  readonly assertedClassType: string | undefined;
}

export interface GenericSourceArtifact {
  readonly source: string;
  readonly bindingNames: readonly string[];
  readonly bindingValues: readonly unknown[];
}
