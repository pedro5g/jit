import {
  type AssertionDescriptor,
  type AssertionErrorFactory,
  type AssertionIssue,
  assertionError,
  assertionFailures,
  assertionIssues,
  emitAssertionSource,
  resolveAssertionDescriptor,
} from "../compiler/assertion.js";
import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import type { QueryConditionNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { type FactoryReturnMode, normalizeFactoryReturnMode } from "../core/factory-policy.js";
import { JITError, JITValidationError, type ValidationIssue } from "../errors/index.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import { Object_hasOwn } from "../shared/utils.js";
import type { AssertionOptions, FactoryFailure, FactoryValidationOptions } from "./class.js";
import type { NestedErrorCandidate } from "./class-policy-nested-errors.js";
import { createConditionBuilder, type QueryConditionBuilder } from "./query.js";

/** Internal marker carried by the allocation-free `either` failure result. */
export const FACTORY_FAILURE: unique symbol = Symbol.for("jit.factory.failure") as never;

interface AssertionOutcome {
  readonly errorIndex?: number;
  readonly issues?: readonly AssertionIssue[];
}

export { collectNestedErrorCandidates } from "./class-policy-nested-errors.js";

/** Mutable declaration-time policy state shared by create and hydrate. */
export interface FactoryPolicyState {
  mode: FactoryReturnMode;
  resultModeExplicit: boolean;
  inheritedResultMode: boolean;
  error: ((issues: readonly ValidationIssue[]) => unknown) | undefined;
  create: boolean;
  hydrate: boolean;
  configured: boolean;
  validationConfigured: boolean;
  maxIssues: number | undefined;
  modePriority: number;
  errorPriority: number;
  errorPriorityExplicit: boolean;
  assertions: AssertionDescriptor[];
  assertionErrors: (AssertionErrorFactory | undefined)[];
  assertionGuard: ((value: unknown) => AssertionOutcome | undefined) | undefined;
  assert: ((value: unknown) => unknown) | undefined;
  nestedErrors: readonly NestedErrorCandidate[];
}

function createPolicyState(): FactoryPolicyState {
  return {
    mode: "throw",
    resultModeExplicit: false,
    inheritedResultMode: false,
    error: undefined,
    create: true,
    hydrate: true,
    configured: false,
    validationConfigured: false,
    maxIssues: undefined,
    modePriority: 1000,
    errorPriority: 1000,
    errorPriorityExplicit: false,
    assertions: [],
    assertionErrors: [],
    assertionGuard: undefined,
    assert: undefined,
    nestedErrors: [],
  };
}

/** Clones policy configuration while preserving independent assertion arrays. */
export function clonePolicyState(source: FactoryPolicyState | undefined): FactoryPolicyState {
  if (source === undefined) return createPolicyState();

  return {
    ...source,
    assertions: [...source.assertions],
    assertionErrors: [...source.assertionErrors],
    nestedErrors: [...source.nestedErrors],
  };
}

/** Creates the immutable Runtime Type traits stored in a schema node. */
export function runtimeTypeTraits<TRepresentation extends "object" | "value", TIdentifier extends boolean>(
  representation: TRepresentation,
  identifier: TIdentifier,
  policy: Pick<
    FactoryPolicyState,
    | "configured"
    | "mode"
    | "validationConfigured"
    | "resultModeExplicit"
    | "inheritedResultMode"
    | "modePriority"
    | "errorPriority"
    | "assertions"
  >
): ATS.RuntimeTypeTraits<TRepresentation, TIdentifier> {
  return Object.freeze({
    representation,
    identifier,
    factoryPolicy: Object.freeze({
      configured: policy.configured,
      resultMode: policy.mode,
      resultModeExplicit: policy.validationConfigured && policy.resultModeExplicit,
      resultModeInherited: policy.inheritedResultMode,
      errorType: undefined,
      priority: policy.modePriority,
      hasAssertions: policy.assertions.length > 0,
      validationConfigured: policy.validationConfigured,
    }),
  }) as ATS.RuntimeTypeTraits<TRepresentation, TIdentifier>;
}

/**
 * Recompiles the assertion guard.
 *
 * The conditions are the shared query conditions, so the guard is generated
 * comparisons rather than a list of callbacks the factory walks. A class with
 * no assertions has no guard at all.
 */
function compileAssertions(policy: FactoryPolicyState): void {
  if (policy.assertions.length === 0) {
    policy.assertionGuard = undefined;
    policy.assert = undefined;
    return;
  }
  const failures = assertionFailures(policy.assertions, policy.assertionErrors);
  const issues = assertionIssues(policy.assertions);
  const bindings = policy.assertions.flatMap((descriptor) => descriptor.bindings);
  const bindingNames = bindings.map((_, index) => `__q${index}`);
  const failureNames = failures.map((_, index) => `__fail${index}`);
  const issueNames = issues.map((_, index) => `__issue${index}`);
  const guard = globalThis.Function(
    ...bindingNames,
    ...failureNames,
    ...issueNames,
    `${emitAssertionSource(policy.assertions, policy.maxIssues)}\nreturn __assert;`
  )(...bindings, ...failures, ...issues) as (value: unknown) => AssertionOutcome | undefined;
  policy.assertionGuard = guard;

  policy.assert = (value: unknown) => {
    const outcome = guard(value);
    if (outcome === undefined) return undefined;
    const selectedPriority =
      outcome.errorIndex === undefined || outcome.errorIndex < 0
        ? -1
        : (policy.assertions[outcome.errorIndex]?.priority ?? -1);
    if (policy.error !== undefined && policy.errorPriority >= selectedPriority) {
      return policy.error(outcome.issues as unknown as readonly ValidationIssue[]);
    }
    // A custom error is selected only after the full assertion pass. This
    // keeps the issue set complete and constructs one final error.
    if (outcome.errorIndex !== undefined && outcome.errorIndex >= 0) {
      const factory = policy.assertionErrors[outcome.errorIndex];
      if (factory !== undefined) return factory(value, policy.assertions[outcome.errorIndex]);
    }
    return assertionError(outcome.issues ?? []);
  };
}

/** Applies the declared success result mode to one factory value. */
export function policySuccess(policy: FactoryPolicyState, value: unknown): unknown {
  if (policy.mode === "either") return value;
  if (policy.mode === "tuple") return [null, value];
  return value;
}

/** Applies the declared failure result mode to one factory error. */
export function policyFailure(policy: FactoryPolicyState, error: unknown): never | unknown {
  if (policy.mode === "either") {
    return Object.defineProperties({ ok: false, error }, { [FACTORY_FAILURE]: { enumerable: false, value: true } });
  }
  if (policy.mode === "tuple") return [error, null];
  throw error;
}

/** Returns whether the JIT is failure condition holds. */
export function isFailure<TError>(value: unknown): value is FactoryFailure<TError> {
  return (
    Object_hasOwn(value, FACTORY_FAILURE) &&
    (value as { readonly [FACTORY_FAILURE]?: unknown })[FACTORY_FAILURE] === true
  );
}

/** Selects the highest-priority configured error for the reported issue paths. */
export function policyError(policy: FactoryPolicyState, issues: readonly ValidationIssue[]): unknown {
  let selected:
    | {
        readonly priority: number;
        readonly depth: number;
        readonly order: number;
        readonly factory: (issues: readonly ValidationIssue[]) => unknown;
      }
    | undefined =
    policy.error === undefined
      ? undefined
      : { priority: policy.errorPriority, depth: 0, order: -1, factory: policy.error };

  for (const candidate of policy.nestedErrors) {
    if (!hasIssueAtPath(issues, candidate.path)) continue;
    if (
      selected === undefined ||
      candidate.priority > selected.priority ||
      (candidate.priority === selected.priority && candidate.depth < selected.depth) ||
      (candidate.priority === selected.priority &&
        candidate.depth === selected.depth &&
        candidate.order < selected.order)
    ) {
      selected = candidate;
    }
  }
  return selected === undefined ? new JITValidationError(issues) : selected.factory(issues);
}

function hasIssueAtPath(issues: readonly ValidationIssue[], prefix: readonly (string | number)[]): boolean {
  return issues.some((issue) => prefix.every((part, index) => issue.path[index] === part));
}

/**
 * The reconstructive form of a configured policy.
 *
 * An unconfigured class contributes nothing, so its artifact — and the module
 * AOT generates from it — is exactly what it was before policies existed.
 */
export function policyArtifact(policy: FactoryPolicyState): {
  readonly policy?: ClassPolicyArtifact;
} {
  if (!policy.configured) return {};
  const bindings = policy.assertions.flatMap((descriptor) => descriptor.bindings);

  return {
    policy: {
      result: policy.mode,
      create: policy.create,
      hydrate: policy.hydrate,
      validationConfigured: policy.validationConfigured,
      ...(policy.maxIssues === undefined ? {} : { maxIssues: policy.maxIssues }),
      ...(policy.error === undefined ? {} : { errorPriority: policy.errorPriority }),
      ...(policy.error === undefined ? {} : { errorPriorityExplicit: policy.errorPriorityExplicit }),
      ...(policy.error === undefined ? {} : { error: policy.error }),
      ...(policy.nestedErrors.length === 0
        ? {}
        : {
            nestedErrors: policy.nestedErrors.map((candidate) => ({
              priority: candidate.priority,
              depth: candidate.depth,
              order: candidate.order,
              path: candidate.path,
              error: candidate.factory,
              runtimeBinding: candidate.runtimeBinding,
              ...(candidate.assertion === undefined ? {} : { assertion: candidate.assertion }),
            })),
          }),
      ...(policy.assertions.length === 0
        ? {}
        : {
            assertions: {
              source: emitAssertionSource(policy.assertions, policy.maxIssues),
              bindingNames: bindings.map((_, index) => `__q${index}`),
              bindingValues: bindings,
              failures: policy.assertions.map((descriptor, index) => ({
                rule: descriptor.rule,
                field: descriptor.field,
                code: descriptor.code,
                message: descriptor.message,
                priority: descriptor.priority,
                descriptor,
                ...(policy.assertionErrors[index] === undefined ? {} : { error: policy.assertionErrors[index] }),
              })),
            },
          }),
    },
  };
}

/** Reconstructive policy metadata emitted for a configured Runtime Class. */
export type ClassPolicyArtifact = NonNullable<Extract<CompiledArtifact, { readonly kind: "class" }>["policy"]>;

/** Result shape used by diagnostic factory validation. */
export type SafeParse<TValue> =
  | { readonly success: true; readonly data: TValue }
  | { readonly success: false; readonly issues: readonly ValidationIssue[] };

/** Applies `.validate(...)` to a policy shared by every factory of one class. */
export function applyValidationPolicy(policy: FactoryPolicyState, options: FactoryValidationOptions | undefined): void {
  if (policy.validationConfigured) {
    throw new JITError("INVALID_OPERATION", "Factory validation is already configured for this Runtime Class");
  }
  if (options?.maxIssues !== undefined && (!Number.isSafeInteger(options.maxIssues) || options.maxIssues < 1)) {
    throw new RangeError("maxIssues must be a positive safe integer");
  }
  if (options?.priority !== undefined && !Number.isFinite(options.priority)) {
    throw new RangeError("priority must be a finite number");
  }
  policy.configured = true;
  policy.validationConfigured = true;
  if (options?.result !== undefined) {
    policy.mode = normalizeFactoryReturnMode(options.result);
    policy.resultModeExplicit = true;
    policy.inheritedResultMode = false;
  }
  if (options?.error !== undefined) policy.error = options.error;
  if (options?.create !== undefined) policy.create = options.create;
  if (options?.hydrate !== undefined) policy.hydrate = options.hydrate;
  if (options?.maxIssues !== undefined) policy.maxIssues = options.maxIssues;
  if (options?.priority !== undefined) {
    policy.modePriority = options.priority;
    policy.errorPriority = options.priority;
    policy.errorPriorityExplicit = true;
  }
  if (policy.assertions.length > 0) compileAssertions(policy);
}

/** Appends one invariant and recompiles the guard the factories run. */
export function applyAssertion(
  policy: FactoryPolicyState,
  schema: ATS.AnyTypeSchema,
  predicate: (query: QueryConditionBuilder<never>) => QueryConditionNode,
  options: AssertionOptions | undefined
): void {
  const base = resolveWrappers(schema).base;
  if (base.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", "Assertions describe object fields; a scalar schema has none to name");
  }
  const builder = createConditionBuilder(policy.assertions.reduce((total, item) => total + item.bindings.length, 0));
  const condition = predicate(builder.builder as unknown as QueryConditionBuilder<never>);
  if (options?.priority !== undefined && !Number.isFinite(options.priority)) {
    throw new RangeError("priority must be a finite number");
  }
  policy.assertions.push(
    resolveAssertionDescriptor({
      condition,
      bindings: builder.bindings,
      ...(options?.rule === undefined ? {} : { rule: options.rule }),
      ...(options?.code === undefined ? {} : { code: options.code }),
      ...(options?.message === undefined ? {} : { message: options.message }),
      ...(options?.priority === undefined ? {} : { priority: options.priority }),
    })
  );
  policy.assertionErrors.push(options?.error);
  // An assertion is itself a configuration: without one, the class keeps the
  // path it had before policies existed.
  policy.configured = true;
  compileAssertions(policy);
}
