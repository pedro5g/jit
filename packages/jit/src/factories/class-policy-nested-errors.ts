import { schemaChildren } from "../compiler/schema-recursion.js";
import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { DomainAssertionError, type ValidationIssue } from "../errors/index.js";
import { type CompiledArtifact, getArtifact } from "../runtime/artifact-registry.js";

export interface NestedErrorCandidate {
  readonly priority: number;
  readonly depth: number;
  readonly order: number;
  readonly path: readonly (string | number)[];
  readonly factory: (issues: readonly ValidationIssue[]) => unknown;
  /** True when the candidate closes over an application callback. */
  readonly runtimeBinding: boolean;
  /** Reconstructive metadata for the built-in assertion error. */
  readonly assertion?: {
    readonly rule: string | undefined;
    readonly field: string | undefined;
    readonly message: string;
  };
}

interface NestedErrorWalk {
  readonly candidates: NestedErrorCandidate[];
  readonly active: Set<ATS.AnyTypeSchema>;
  order: number;
}

export function collectNestedErrorCandidates(schema: ATS.AnyTypeSchema): readonly NestedErrorCandidate[] {
  const walk: NestedErrorWalk = { candidates: [], active: new Set<ATS.AnyTypeSchema>(), order: 0 };
  visitNestedSchema(schema, [], 0, walk);
  return walk.candidates;
}

function visitNestedSchema(
  current: ATS.AnyTypeSchema,
  path: readonly (string | number)[],
  depth: number,
  walk: NestedErrorWalk
): void {
  if (walk.active.has(current)) return;
  walk.active.add(current);
  appendRuntimeTypeCandidates(current, path, depth, walk);
  visitNestedChildren(current, path, depth, walk);
  walk.active.delete(current);
}

function appendRuntimeTypeCandidates(
  current: ATS.AnyTypeSchema,
  path: readonly (string | number)[],
  depth: number,
  walk: NestedErrorWalk
): void {
  if (current.type !== TypeName.runtimeType) return;
  const nested = getArtifact((current as ATS.RuntimeTypeSchema).def.materialize);
  if (nested?.kind !== "class") return;
  appendNestedPolicyError(nested, path, depth, walk);
  appendNestedAssertions(nested, path, depth, walk);
}

function appendNestedPolicyError(
  nested: Extract<CompiledArtifact, { readonly kind: "class" }>,
  path: readonly (string | number)[],
  depth: number,
  walk: NestedErrorWalk
): void {
  const policy = nested.policy;
  if (typeof policy?.error !== "function") return;
  walk.candidates.push({
    priority: policy.errorPriorityExplicit ? (policy.errorPriority ?? 800) : 800,
    depth,
    order: walk.order++,
    path,
    factory: policy.error as (issues: readonly ValidationIssue[]) => unknown,
    runtimeBinding: true,
  });
}

function appendNestedAssertions(
  nested: Extract<CompiledArtifact, { readonly kind: "class" }>,
  path: readonly (string | number)[],
  depth: number,
  walk: NestedErrorWalk
): void {
  for (const failure of nested.policy?.assertions?.failures ?? []) {
    const assertionPath = failure.field === undefined ? path : [...path, failure.field];
    const runtimeBinding = typeof failure.error === "function";
    walk.candidates.push({
      priority: failure.priority,
      depth: depth + 1,
      order: walk.order++,
      path: assertionPath,
      runtimeBinding,
      ...(runtimeBinding
        ? {}
        : {
            assertion: {
              rule: failure.rule,
              field: failure.field,
              message: failure.message,
            },
          }),
      factory: runtimeBinding
        ? () => (failure.error as (value: unknown, descriptor: unknown) => unknown)(undefined, failure.descriptor)
        : (issues) =>
            new DomainAssertionError(failure.message, {
              ...(failure.rule === undefined ? {} : { rule: failure.rule }),
              ...(failure.field === undefined ? {} : { field: failure.field }),
              issues,
            }),
    });
  }
}

function visitNestedChildren(
  current: ATS.AnyTypeSchema,
  path: readonly (string | number)[],
  depth: number,
  walk: NestedErrorWalk
): void {
  if (current.type === TypeName.object) {
    for (const [key, child] of Object.entries((current as ATS.ObjectSchema).def.props)) {
      visitNestedSchema(child, [...path, key], depth + 1, walk);
    }
    return;
  }
  if (current.type === TypeName.array || current.type === TypeName.set) {
    visitNestedSchema(
      (current as ATS.ArraySchema<ATS.AnyTypeSchema> | ATS.SetSchema<ATS.AnyTypeSchema>).def.element,
      path,
      depth + 1,
      walk
    );
    return;
  }
  for (const child of schemaChildren(current)) visitNestedSchema(child, path, depth + 1, walk);
}
