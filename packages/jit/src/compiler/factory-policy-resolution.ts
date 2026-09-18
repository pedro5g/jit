import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import {
  type FactoryPolicyCandidate,
  type FactoryReturnMode,
  selectFactoryPolicyCandidate,
} from "../core/factory-policy.js";
import { schemaChildren } from "./schema-recursion.js";

/** Resolves the highest-priority nested Runtime Class factory policy. */
export function resolveNestedFactoryPolicy(schema: ATS.AnyTypeSchema): FactoryPolicyCandidate | undefined {
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
