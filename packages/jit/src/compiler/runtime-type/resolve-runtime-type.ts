import type * as ATS from "../../core/ats/index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";
import { findRuntimeTypeSchema } from "./find-runtime-type-schema.js";
import type { RuntimeTypeOperationDescriptor } from "./runtime-type-node.js";

/** Resolves transparent wrappers up to (but not through) a Runtime Type. */
export function resolveRuntimeTypeOperation(schema: ATS.AnyTypeSchema): RuntimeTypeOperationDescriptor | undefined {
  const runtime = findRuntimeTypeSchema(schema);
  if (runtime === undefined) return undefined;
  const artifact = getArtifact(runtime.def.materialize);
  const trusted = (runtime.def.materialize as { readonly __jitMaterialize?: unknown }).__jitMaterialize;

  return {
    schema: runtime,
    innerType: runtime.def.innerType,
    representation: runtime.def.representation,
    identifier: runtime.def.identifier,
    materialize: runtime.def.materialize,
    trustedMaterialize: typeof trusted === "function" ? trusted : undefined,
    immutable: artifact?.kind === "class" ? artifact.frozen : runtime.def.representation === "value",
  };
}
