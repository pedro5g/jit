import type { LifecycleDefinition } from "./effective-schema.js";

/** Serializable lifecycle metadata shared by runtime and define artifacts. */
export interface LifecycleArtifact {
  readonly updatedAt?: string;
  readonly touchAt?: string;
  readonly version?: string;
  readonly deletedAt?: string;
  readonly timestampClock?: unknown;
  readonly deletionClock?: unknown;
  readonly touchMethod?: string;
  readonly deleteMethod?: string;
  readonly restoreMethod?: string;
  readonly isDeletedMember?: string;
}

/** Converts one lifecycle definition to its reconstructive artifact metadata. */
export function lifecycleArtifact(lifecycle: LifecycleDefinition): LifecycleArtifact | undefined {
  const timestamps = lifecycle.timestamps;
  const deletion = lifecycle.softDelete;
  const versioned = lifecycle.versioned;
  if (timestamps === undefined && deletion === undefined && versioned === undefined) return undefined;
  return {
    ...(timestamps?.touch === "manual" || timestamps === undefined ? {} : { updatedAt: timestamps.updatedAt }),
    ...(timestamps === undefined ? {} : { touchAt: timestamps.updatedAt, touchMethod: timestamps.touchMethod }),
    ...(versioned === undefined ? {} : { version: versioned.field }),
    ...(deletion === undefined
      ? {}
      : {
          deletedAt: deletion.field,
          deleteMethod: deletion.deleteMethod,
          restoreMethod: deletion.restoreMethod,
          isDeletedMember: deletion.isDeletedMember,
        }),
    ...(timestamps?.clock === undefined ? {} : { timestampClock: timestamps.clock }),
    ...(deletion?.clock === undefined ? {} : { deletionClock: deletion.clock }),
  };
}
