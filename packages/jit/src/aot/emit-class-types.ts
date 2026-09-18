import type * as ATS from "../core/ats/index.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import type { SkippedOperation } from "./generate.js";

export interface EmittedBinding {
  readonly binding: string;
  readonly type: string;
}

type ClassArtifactFlag =
  | "validationError"
  | "assertionError"
  | "runtimeGetIndex"
  | "hashHelpers"
  | "hashCache"
  | "jsonPatchHelpers"
  | "aggregateType"
  | "domainStateType"
  | "domainEventType";

interface ValidatorSelection {
  readonly is: boolean;
  readonly safeParse: boolean;
  readonly parse?: boolean;
  readonly resolveDefaults?: boolean;
  readonly materializeRuntimeTypes?: boolean;
  readonly validateChecks?: boolean;
  readonly maxIssues?: number;
}

export interface ClassArtifactEmitContext {
  readonly js: string[];
  readonly skipped: SkippedOperation[];
  readonly mark: (flag: ClassArtifactFlag) => void;
  readonly internalIdentifier: (preferred: string) => string;
  readonly classMemberName: (name: string) => string;
  readonly inlineBindings: (names: readonly string[], values: readonly unknown[]) => string[] | undefined;
  readonly serializeBindingValue: (value: unknown) => string | undefined;
  readonly indentBlock: (source: string) => string[];
  readonly asExpression: (source: string, entry: string) => string;
  readonly tryEmit: <TValue>(
    schema: string,
    operation: string,
    skipped: SkippedOperation[],
    emit: () => TValue
  ) => TValue | undefined;
  readonly emitValidatorBinding: (
    binding: string,
    schema: ATS.AnyTypeSchema,
    reportName: string,
    operation: string,
    selection: ValidatorSelection
  ) => string | undefined;
  readonly emitHashBinding: (
    binding: string,
    schema: ATS.AnyTypeSchema,
    reportName: string,
    cache?: boolean
  ) => string | undefined;
  readonly classBindings: ReadonlyMap<unknown, string>;
  readonly assertionBindings: ReadonlyMap<unknown, string>;
  readonly hasNestedValidation: (schema: ATS.AnyTypeSchema, seen?: Set<ATS.AnyTypeSchema>) => boolean;
}

export type ClassArtifact = Extract<CompiledArtifact, { readonly kind: "class" }>;
