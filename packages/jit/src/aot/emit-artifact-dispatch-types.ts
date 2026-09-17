import type * as ATS from "../core/ats/index.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import type { ArtifactTypeContext } from "./artifact-type-context.js";
import type { ArtifactEmitterFlag } from "./emit-artifacts.js";
import type { ClassArtifactEmitContext } from "./emit-class.js";
import type { ValidatorBindingSelection } from "./emit-validator-binding.js";
import type { SkippedOperation } from "./generate.js";

export interface ArtifactDispatchContext {
  readonly js: string[];
  readonly skipped: SkippedOperation[];
  readonly ts: boolean;
  readonly artifactTypeContext: ArtifactTypeContext;
  readonly classArtifactContext: ClassArtifactEmitContext;
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
