import type * as ATS from "../core/ats/index.js";

/** Shared context used while reconstructing AOT artifact type signatures. */
export interface ArtifactTypeContext {
  readonly typeNames: ReadonlyMap<ATS.AnyTypeSchema, string>;
  readonly classMemberName: (name: string) => string;
  readonly classUpdateType: (schema: ATS.AnyTypeSchema, seen?: Set<ATS.AnyTypeSchema>) => string;
  readonly mark: (flag: "aggregateType" | "domainStateType" | "domainEventType") => void;
}
