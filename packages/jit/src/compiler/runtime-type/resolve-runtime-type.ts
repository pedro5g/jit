import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { getArtifact } from "../../runtime/artifact-registry.js";
import type { RuntimeTypeOperationDescriptor } from "./runtime-type-node.js";

/** Resolves transparent wrappers up to (but not through) a Runtime Type. */
export function resolveRuntimeTypeOperation(schema: ATS.AnyTypeSchema): RuntimeTypeOperationDescriptor | undefined {
  let current = schema;

  while (true) {
    if (current.type === TypeName.runtimeType) {
      const runtime = current as ATS.RuntimeTypeSchema;
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

    if (
      current.type === TypeName.optional ||
      current.type === TypeName.nullable ||
      current.type === TypeName.nullish ||
      current.type === TypeName.default ||
      current.type === TypeName.brand ||
      current.type === TypeName.readonly ||
      current.type === TypeName.refine ||
      current.type === TypeName.coerce ||
      current.type === TypeName.pipe ||
      current.type === TypeName.transform
    ) {
      current = (current.def as ATS.InnerTypeDef<ATS.AnyTypeSchema>).innerType;
      continue;
    }

    if (current.type === TypeName.lazy) {
      current = (current.def as ATS.LazyDef<ATS.AnyTypeSchema>).getter();
      continue;
    }

    return undefined;
  }
}
