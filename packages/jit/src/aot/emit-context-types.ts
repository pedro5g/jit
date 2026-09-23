import type { TargetProfile } from "../compiler/target/target-profile.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import type { SkippedOperation } from "./generate.js";

/** Result of emitting one binding declaration into an AOT module. */
export interface EmittedBinding {
  readonly binding: string;
  readonly type: string;
}

/** Feature flags shared by every AOT artifact emitter. */
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

/** Common source-writing services used by artifact emitters. */
export interface ArtifactEmissionContext<TFlag extends string = string> {
  readonly js: string[];
  readonly skipped: SkippedOperation[];
  readonly mark: (flag: TFlag) => void;
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

/** Complete context shared by the top-level AOT artifact emitters. */
export interface ArtifactEmitterBaseContext extends ArtifactEmissionContext<ArtifactEmitterFlag> {
  readonly ts: boolean;
  /** Target selected by the AOT request; emitters must not inspect the build runtime. */
  readonly target: TargetProfile;
  readonly classBindings: ReadonlyMap<unknown, string>;
  readonly classArtifacts: ReadonlyMap<unknown, Extract<CompiledArtifact, { readonly kind: "class" }>>;
  readonly assertionBindings: ReadonlyMap<unknown, string>;
  readonly inlineBindings: (names: readonly string[], values: readonly unknown[]) => string[] | undefined;
  readonly inlineCodecBindings: (names: readonly string[], values: readonly unknown[]) => string[] | undefined;
  readonly serializeBindingValue: (value: unknown) => string | undefined;
  readonly serializeStaticData: (value: unknown) => string | undefined;
}
