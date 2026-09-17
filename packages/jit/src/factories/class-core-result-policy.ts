import { schemaChildren } from "../compiler/schema-recursion.js";
import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import {
  type FactoryPolicyCandidate,
  type FactoryReturnMode,
  selectFactoryPolicyCandidate,
} from "../core/factory-policy.js";
import type { ClassDefinitionState } from "./class-core-state.js";
import type { FactoryPolicyState } from "./class-policy.js";
import { collectNestedErrorCandidates } from "./class-policy.js";

export function resolveRuntimeClassPolicy(state: ClassDefinitionState): FactoryPolicyState {
  const policy = state.policy;
  policy.nestedErrors = collectNestedErrorCandidates(state.schema);
  if (policy.validationConfigured) return policy;
  const nestedPolicy = resolveNestedResultPolicy(state.schema);
  if (nestedPolicy === undefined) return clearInheritedPolicy(policy);
  policy.configured = true;
  policy.mode = nestedPolicy.mode;
  policy.modePriority = nestedPolicy.priority;
  policy.inheritedResultMode = true;
  policy.resultModeExplicit = false;
  return policy;
}

function clearInheritedPolicy(policy: FactoryPolicyState): FactoryPolicyState {
  if (!policy.inheritedResultMode) return policy;
  policy.configured = false;
  policy.mode = "throw";
  policy.inheritedResultMode = false;
  policy.resultModeExplicit = false;
  return policy;
}

function resolveNestedResultPolicy(schema: ATS.AnyTypeSchema): FactoryPolicyCandidate | undefined {
  const candidates: FactoryPolicyCandidate[] = [];
  const active = new Set<ATS.AnyTypeSchema>();
  const visit = (current: ATS.AnyTypeSchema, depth: number): void => {
    if (active.has(current)) return;
    active.add(current);
    if (current.type === TypeName.runtimeType) {
      addRuntimePolicyCandidate(candidates, current as ATS.RuntimeTypeSchema, depth);
      active.delete(current);
      return;
    }
    const children =
      current.type === TypeName.object
        ? Object.values((current as ATS.ObjectSchema).def.props)
        : schemaChildren(current);
    for (const child of children) visit(child, depth + 1);
    active.delete(current);
  };
  visit(schema, 0);
  return selectFactoryPolicyCandidate(candidates);
}

function addRuntimePolicyCandidate(
  candidates: FactoryPolicyCandidate[],
  runtime: ATS.RuntimeTypeSchema,
  depth: number
): void {
  const traits = runtime.def.traits.factoryPolicy;
  if (!traits.configured || (!traits.resultModeExplicit && !traits.resultModeInherited)) return;
  candidates.push({
    mode: traits.resultMode as FactoryReturnMode,
    priority: traits.priority,
    explicitMode: traits.resultModeExplicit,
    depth,
    source: String(candidates.length),
  });
}
