import { resolveNestedFactoryPolicy } from "../compiler/factory-policy-resolution.js";
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

const resolveNestedResultPolicy = resolveNestedFactoryPolicy;
