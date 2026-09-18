import { appendClassArtifactSource, createClassConstructionPlan } from "./emit-class-construction.js";
import { createClassStorage, emitClassMembers } from "./emit-class-members.js";
import { emitClassPolicy } from "./emit-class-policy.js";
import { prepareClassArtifact } from "./emit-class-setup.js";
import type { ClassArtifact, ClassArtifactEmitContext, EmittedBinding } from "./emit-class-types.js";

export function emitClassArtifact(
  context: ClassArtifactEmitContext,
  binding: string,
  declaration: string,
  artifact: ClassArtifact,
  reportName: string,
  type: string,
  assertedType: string | undefined
): EmittedBinding | undefined {
  const setup = prepareClassArtifact(context, binding, artifact, reportName);
  if (setup === undefined) return undefined;
  const storage = createClassStorage(context, setup, binding, reportName);
  if (storage === undefined) return undefined;
  const members = emitClassMembers(context, setup, storage, binding, reportName);
  if (members === undefined) return undefined;
  const construction = createClassConstructionPlan(context, setup, storage, members, binding, reportName);
  if (construction === undefined) return undefined;
  const policyLines =
    setup.artifact.policy === undefined ? [] : emitClassPolicy(context, setup.artifact.policy, reportName);
  if (policyLines === undefined) return undefined;
  appendClassArtifactSource(context, setup, storage, members, construction, {
    binding,
    declaration,
    assertedType,
    policyLines,
  });
  return { binding, type };
}
