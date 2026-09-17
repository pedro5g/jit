import type { LifecycleDefinition } from "./classes/effective-schema.js";
import { type AssertionDescriptor, emitAssertionSource, resolveAssertionDescriptor } from "./compiler/assertion.js";
import { resolveWrappers } from "./compiler/resolvers/resolve-wrappers.js";
import { schemaChildren } from "./compiler/schema-recursion.js";
import type { QueryConditionNode } from "./core/ast/index.js";
import type * as ATS from "./core/ats/index.js";
import { createSchema, TypeName } from "./core/ats/index.js";
import {
  type FactoryPolicyCandidate,
  type FactoryReturnMode,
  type FactoryReturnModeInput,
  selectFactoryPolicyCandidate,
} from "./core/factory-policy.js";
import type {
  DefinedClassAssertions,
  DefinedClassFieldPolicy,
  DefinedClassPolicy,
  DefinedClassState,
} from "./define-class-state.js";
import type { AssertionOptions } from "./factories/class.js";
import { createConditionBuilder, type QueryConditionBuilder } from "./factories/query.js";

export function definedPolicyBase(state: DefinedClassState): DefinedClassPolicy {
  return state.policy ?? { result: "throw", create: true, hydrate: true };
}

export function resolveDefinedNestedResultPolicy(schema: ATS.AnyTypeSchema): FactoryPolicyCandidate | undefined {
  const candidates: FactoryPolicyCandidate[] = [];
  const active = new Set<ATS.AnyTypeSchema>();
  const visit = (current: ATS.AnyTypeSchema, depth: number): void => {
    if (active.has(current)) return;
    active.add(current);
    if (current.type === TypeName.runtimeType) {
      const traits = (current as ATS.RuntimeTypeSchema).def.traits.factoryPolicy;
      if (traits.configured && (traits.resultModeExplicit || traits.resultModeInherited)) {
        candidates.push({
          mode: traits.resultMode as FactoryReturnMode,
          priority: traits.priority,
          explicitMode: traits.resultModeExplicit,
          depth,
          source: String(candidates.length),
        });
      }
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

export function resolveDefinedPolicy(state: DefinedClassState): DefinedClassPolicy | undefined {
  if (state.validationConfigured) return state.policy;
  const previous = state.policy;
  if (previous !== undefined && previous.resultModeInherited !== true) return previous;
  const nestedPolicy = resolveDefinedNestedResultPolicy(state.schema);
  if (nestedPolicy === undefined) return clearInheritedDefinedPolicy(previous);
  return {
    ...(previous ?? { result: "throw", create: true, hydrate: true }),
    result: nestedPolicy.mode,
    errorPriority: nestedPolicy.priority,
    resultModeInherited: true,
  };
}

function clearInheritedDefinedPolicy(previous: DefinedClassPolicy | undefined): DefinedClassPolicy | undefined {
  if (previous === undefined) return undefined;
  return { ...previous, result: "throw", resultModeInherited: false };
}

export function definedAssertions(
  descriptors: readonly AssertionDescriptor[],
  maxIssues: number | undefined,
  errors: readonly (unknown | undefined)[]
): DefinedClassAssertions {
  const bindingValues = descriptors.flatMap((descriptor) => descriptor.bindings);
  return {
    descriptors: Object.freeze([...descriptors]),
    source: emitAssertionSource(descriptors, maxIssues),
    bindingNames: Object.freeze(bindingValues.map((_, index) => `__q${index}`)),
    bindingValues: Object.freeze(bindingValues),
    failures: Object.freeze(
      descriptors.map((descriptor, index) => ({
        rule: descriptor.rule,
        field: descriptor.field,
        code: descriptor.code,
        message: descriptor.message,
        priority: descriptor.priority,
        ...(errors[index] === undefined ? {} : { error: errors[index] }),
      }))
    ),
  };
}

export function defineClassAssertion(
  state: DefinedClassState,
  predicate: (query: QueryConditionBuilder<unknown>) => QueryConditionNode,
  options: AssertionOptions | undefined
): DefinedClassState {
  const policy = definedPolicyBase(state);
  const previous = policy.assertions;
  const startIndex = previous?.bindingValues.length ?? 0;
  const builder = createConditionBuilder(startIndex);
  const condition = predicate(builder.builder);
  if (options?.priority !== undefined && !Number.isFinite(options.priority)) {
    throw new RangeError("priority must be a finite number");
  }
  const descriptor = resolveAssertionDescriptor({
    condition,
    bindings: builder.bindings,
    ...(options?.rule === undefined ? {} : { rule: options.rule }),
    ...(options?.code === undefined ? {} : { code: options.code }),
    ...(options?.message === undefined ? {} : { message: options.message }),
    ...(options?.priority === undefined ? {} : { priority: options.priority }),
  });
  const descriptors = [...(previous?.descriptors ?? []), descriptor];
  const errors = [...(previous?.failures.map((failure) => failure.error) ?? []), options?.error];
  return {
    ...state,
    policy: { ...policy, assertions: definedAssertions(descriptors, policy.maxIssues, errors) },
  };
}

export function definedLifecycleMutation(lifecycle: LifecycleDefinition):
  | {
      readonly updatedAt?: string;
      readonly touchAt?: string;
      readonly version?: string;
      readonly deletedAt?: string;
      readonly touchMethod?: string;
      readonly deleteMethod?: string;
      readonly restoreMethod?: string;
      readonly isDeletedMember?: string;
      readonly timestampClock?: unknown;
      readonly deletionClock?: unknown;
    }
  | undefined {
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

export function removeDefinedNoConstructorFields(
  schema: ATS.AnyTypeSchema,
  policies: readonly DefinedClassFieldPolicy[]
): ATS.AnyTypeSchema {
  const excluded = new Set(policies.filter((policy) => policy.noConstructor).map((policy) => policy.name));
  if (excluded.size === 0) return schema;
  const object = resolveWrappers(schema).base;
  if (object.type !== TypeName.object) return schema;
  return createSchema(
    TypeName.object,
    {
      props: Object.fromEntries(
        Object.entries((object as ATS.ObjectSchema).def.props).filter(([name]) => !excluded.has(name))
      ),
      unknownKeys: (object as ATS.ObjectSchema).def.unknownKeys,
      catchall: (object as ATS.ObjectSchema).def.catchall,
      checks: (object as ATS.ObjectSchema).def.checks,
    },
    object.annotations
  );
}

export type DefinedPolicyReturnModeInput = FactoryReturnModeInput;
