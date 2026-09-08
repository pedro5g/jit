import {
  addMember,
  applyDddCapability,
  type CapabilityOptions,
  initialEffectiveSchema,
  type LifecycleDefinition,
  type ManagedFieldDescriptor,
  reapplyManagedFields,
  resolveEffectiveObjectSchema,
  validateManagedFields,
} from "../classes/effective-schema.js";
import {
  type ClassFactoryMemberDescriptor,
  type ClassMemberDefinition,
  type ClassMemberDescriptor,
  type ClassMemberVisibility,
  classFactory as classFactoryDescriptor,
  classGetter,
  classMethod,
  classNoConstructor,
  classPrivate,
  classProtected,
  classPublic,
  classSetter,
  isClassMemberDescriptor,
} from "../classes/member-descriptors.js";
import type { ResolvedMemberTable } from "../classes/members.js";
import { isOverrideDescriptor, type OverrideDescriptor, override } from "../classes/override.js";
import { buildAggregateMutationPlan, emitAggregateMutationBody } from "../compiler/aggregate-mutation.js";
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
import { compileClone } from "../compiler/clone.js";
import { compileDiff } from "../compiler/diff.js";
import { compileEqual, compileEqualMethod } from "../compiler/equal.js";
import { compileHash } from "../compiler/hash.js";
import { compileUpdate, type DiffChange, type UpdatePatch } from "../compiler/index.js";
import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import { isPrimitiveLikeSchema } from "../compiler/schema-nodes.js";
import { schemaChildren } from "../compiler/schema-recursion.js";
import { compileSerializeWithRootAccess } from "../compiler/serialize.js";
import { emitPropertyAccess } from "../compiler/source/access.js";
import {
  compileHydrator,
  compileSafeHydrator,
  compileValidator,
  compileValidatorSelection,
} from "../compiler/validate.js";
import type { QueryConditionNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import type { Input, Update as SchemaUpdate } from "../core/ats/input.js";
import type { Hydrate } from "../core/ats/representations.js";
import type { NO_CONSTRUCTOR_FIELD_MARKER } from "../core/ats/type-schema.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import type { CompareNumericLiteral } from "../core/builder/types.js";
import {
  type FactoryPolicyCandidate,
  type FactoryReturnMode,
  type FactoryReturnModeInput,
  normalizeFactoryReturnMode,
  selectFactoryPolicyCandidate,
} from "../core/factory-policy.js";
import { DomainAssertionError, JITError, JITValidationError, type ValidationIssue } from "../errors/index.js";
import { type CompiledArtifact, getArtifact, registerArtifact } from "../runtime/artifact-registry.js";
import { Object_hasOwn } from "../shared/utils.js";
import * as Transform from "../transforms/index.js";
import { createConditionBuilder, type QueryConditionBuilder } from "./query.js";

const CLASS_TARGET = Symbol("jit.class.target");
const INTERNAL_CONSTRUCT = Symbol("jit.class.construct");
const TRUSTED_MATERIALIZER = "__jitMaterialize";
export type ConstructionMode = "constructor" | "factory";

export type {
  ClassFactoryMemberDescriptor,
  ClassFieldMemberDescriptor,
  ClassMemberDefinition,
  ClassMemberDescriptor,
  ClassMemberVisibility,
  ClassMethodBuilder,
  ClassMethodOptions,
} from "../classes/member-descriptors.js";
export type {
  DefaultRuntimeTypeFactoryPolicyTraits,
  DefaultRuntimeTypeTraits,
  RuntimeTypeFactoryPolicyTraits,
  RuntimeTypeTraits,
} from "../core/ats/type-schema.js";

/** How a factory reports a rejected input. Fixed at declaration, never per call. */
export type { FactoryReturnMode };
/** @deprecated Use FactoryReturnMode. */
export type FactoryResultMode = FactoryReturnMode;
/** Input spelling retained only as a migration alias; plans use `either`. */
export type FactoryResultModeInput = FactoryReturnModeInput;

const FACTORY_FAILURE: unique symbol = Symbol.for("jit.factory.failure") as never;

export interface FactoryFailure<TError> {
  readonly [FACTORY_FAILURE]: true;
  readonly ok: false;
  readonly error: TError;
}

export interface ClassJsonOptions {
  readonly method?: string;
}

type ClassJsonMethods<TOptions extends ClassJsonOptions> = NamedMethod<
  TOptions["method"] extends string ? TOptions["method"] : "toJson",
  () => string
>;

export interface ClassJsonCapability<TOptions extends ClassJsonOptions = ClassJsonOptions>
  extends ClassCapability<ClassJsonMethods<TOptions>> {
  readonly kind: "class.json";
  readonly __options?: TOptions;
}

export type FactoryEither<TValue, TError> = TValue | FactoryFailure<TError>;

type ClassRuntimeTraits = ATS.DefaultRuntimeTypeTraits;
type FactoryTraits<
  TTraits extends ATS.RuntimeTypeTraits,
  TMode extends FactoryReturnMode,
  TError,
  TConfigured extends boolean,
  TAssertions extends boolean = false,
  TModeExplicit extends boolean = false,
  TModeInherited extends boolean = false,
  TPriority extends number = TTraits["factoryPolicy"]["priority"],
> = ATS.RuntimeTypeTraits<
  TTraits["representation"],
  TTraits["identifier"],
  ATS.RuntimeTypeFactoryPolicyTraits<TMode, TConfigured, TError, TPriority> & {
    readonly resultModeExplicit: TModeExplicit;
    readonly resultModeInherited: TModeInherited;
    readonly hasAssertions: TAssertions;
  }
>;

type AssertionTraits<TTraits extends ATS.RuntimeTypeTraits, TError> = ATS.RuntimeTypeTraits<
  TTraits["representation"],
  TTraits["identifier"],
  Omit<TTraits["factoryPolicy"], "errorType" | "hasAssertions"> & {
    readonly errorType: TError;
    readonly hasAssertions: true;
  }
>;

/** The failure channel and the phases it covers. */
export interface FactoryValidationOptions {
  readonly result?: FactoryReturnModeInput;
  /** Stops diagnostic validation as soon as this many issues have been emitted. */
  readonly maxIssues?: number;
  /** Builds the error a rejected input produces; defaults to `JITValidationError`. */
  readonly error?: (issues: readonly ValidationIssue[]) => unknown;
  /** Larger values win when several declared error candidates can apply. */
  readonly priority?: number;
  readonly create?: boolean;
  readonly hydrate?: boolean;
}

export interface FactoryConstructionContext<TInstance = unknown> {
  readonly construct: (state: unknown) => TInstance;
}

export interface AssertionOptions {
  /** Identifier reported by the failure; defaults to the field the condition names. */
  readonly rule?: string;
  /** Machine-readable issue code; defaults to `custom`. */
  readonly code?: string;
  readonly message?: string;
  /** Builds the error this assertion produces; defaults to `DomainAssertionError`. */
  readonly error?: AssertionErrorFactory;
  /** Larger values win between failed assertion error candidates. */
  readonly priority?: number;
}

/** A successful or rejected factory call, in the shape the policy declared. */
export type FactoryOutcome<TInstance, TMode, TError> = TMode extends "either"
  ? FactoryEither<TInstance, TError>
  : TMode extends "tuple"
    ? readonly [TError, null] | readonly [null, TInstance]
    : TInstance;

interface AssertionOutcome {
  readonly errorIndex?: number;
  readonly issues?: readonly AssertionIssue[];
}

interface NestedErrorCandidate {
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

interface FactoryPolicyState {
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

function runtimeTypeTraits<TRepresentation extends "object" | "value", TIdentifier extends boolean>(
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

function policySuccess(policy: FactoryPolicyState, value: unknown): unknown {
  if (policy.mode === "either") return value;
  if (policy.mode === "tuple") return [null, value];
  return value;
}

function policyFailure(policy: FactoryPolicyState, error: unknown): never | unknown {
  if (policy.mode === "either") {
    return Object.defineProperties({ ok: false, error }, { [FACTORY_FAILURE]: { enumerable: false, value: true } });
  }
  if (policy.mode === "tuple") return [error, null];
  throw error;
}

export function isFailure<TError>(value: unknown): value is FactoryFailure<TError> {
  return (
    Object_hasOwn(value, FACTORY_FAILURE) &&
    (value as { readonly [FACTORY_FAILURE]?: unknown })[FACTORY_FAILURE] === true
  );
}

function policyError(policy: FactoryPolicyState, issues: readonly ValidationIssue[]): unknown {
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

function collectNestedErrorCandidates(schema: ATS.AnyTypeSchema): readonly NestedErrorCandidate[] {
  const candidates: NestedErrorCandidate[] = [];
  const active = new Set<ATS.AnyTypeSchema>();
  let order = 0;

  const walk = (current: ATS.AnyTypeSchema, path: readonly (string | number)[], depth: number): void => {
    if (active.has(current)) return;
    active.add(current);

    if (current.type === TypeName.runtimeType) {
      const nested = getArtifact((current as ATS.RuntimeTypeSchema).def.materialize);
      if (nested?.kind === "class" && typeof nested.policy?.error === "function") {
        candidates.push({
          priority: nested.policy.errorPriorityExplicit ? (nested.policy.errorPriority ?? 800) : 800,
          depth,
          order: order++,
          path,
          factory: nested.policy.error as (issues: readonly ValidationIssue[]) => unknown,
          runtimeBinding: true,
        });
      }
      if (nested?.kind === "class") {
        for (const failure of nested.policy?.assertions?.failures ?? []) {
          const assertionPath = failure.field === undefined ? path : [...path, failure.field];
          candidates.push({
            priority: failure.priority,
            depth: depth + 1,
            order: order++,
            path: assertionPath,
            runtimeBinding: typeof failure.error === "function",
            ...(typeof failure.error === "function"
              ? {}
              : {
                  assertion: {
                    rule: failure.rule,
                    field: failure.field,
                    message: failure.message,
                  },
                }),
            factory:
              typeof failure.error === "function"
                ? () =>
                    (failure.error as (value: unknown, descriptor: unknown) => unknown)(undefined, failure.descriptor)
                : (issues) =>
                    new DomainAssertionError(failure.message, {
                      ...(failure.rule === undefined ? {} : { rule: failure.rule }),
                      ...(failure.field === undefined ? {} : { field: failure.field }),
                      issues,
                    }),
          });
        }
      }
    }

    if (current.type === TypeName.object) {
      for (const [key, child] of Object.entries((current as ATS.ObjectSchema).def.props))
        walk(child, [...path, key], depth + 1);
      active.delete(current);
      return;
    }
    if (current.type === TypeName.array || current.type === TypeName.set) {
      walk(
        (current as ATS.ArraySchema<ATS.AnyTypeSchema> | ATS.SetSchema<ATS.AnyTypeSchema>).def.element,
        path,
        depth + 1
      );
      active.delete(current);
      return;
    }
    for (const child of schemaChildren(current)) walk(child, path, depth + 1);
    active.delete(current);
  };

  walk(schema, [], 0);
  return candidates;
}

/**
 * The reconstructive form of a configured policy.
 *
 * An unconfigured class contributes nothing, so its artifact — and the module
 * AOT generates from it — is exactly what it was before policies existed.
 */
function policyArtifact(policy: FactoryPolicyState): {
  readonly policy?: ClassPolicyArtifact;
} {
  if (!policy.configured) return {};
  const bindings = policy.assertions.flatMap((descriptor) => descriptor.bindings);

  return {
    policy: {
      result: policy.mode,
      create: policy.create,
      hydrate: policy.hydrate,
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

type ClassPolicyArtifact = NonNullable<Extract<CompiledArtifact, { readonly kind: "class" }>["policy"]>;

type SafeParse<TValue> =
  | { readonly success: true; readonly data: TValue }
  | { readonly success: false; readonly issues: readonly ValidationIssue[] };

/** Applies `.validate(...)` to a policy shared by every factory of one class. */
function applyValidationPolicy(policy: FactoryPolicyState, options: FactoryValidationOptions | undefined): void {
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
function applyAssertion(
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

/** A generated runtime constructor backed by one object schema. */
/**
 * One argument of `.extends()`: a built-in capability or an object of methods.
 *
 * The object is typed with `ThisType` of the instance the class already has,
 * so a body reads its own fields and its already-installed capabilities and
 * nothing else. A name the instance already carries is rejected here rather
 * than shadowing something at run time.
 */
export type ClassExtensionArgs<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TExtensions extends readonly AnyClassExtension[],
> = ResolveClassExtensionArgs<TSchema, TInstance, TExtensions>;

type ResolveClassExtensionArgs<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TExtensions extends readonly AnyClassExtension[],
> = number extends TExtensions["length"]
  ? ClassExtensionArgument<TSchema, TInstance, TExtensions[number]>[]
  : TExtensions extends readonly [
        infer THead extends AnyClassExtension,
        ...infer TTail extends readonly AnyClassExtension[],
      ]
    ? [
        ClassExtensionArgument<TSchema, TInstance, THead>,
        ...ResolveClassExtensionArgs<
          ApplyClassExtensionSchema<TSchema, THead>,
          ExtendedInstance<TSchema, TInstance, [THead]>,
          TTail
        >,
      ]
    : [];

type ClassExtensionArgument<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TExtension extends AnyClassExtension,
> = TExtension extends AnyClassCapability
  ? NonConflictingCapability<TExtension, TSchema, TInstance>
  : TExtension extends ClassMixin
    ? MixinRequirementsMet<TSchema, TExtension> extends true
      ? TExtension
      : never
    : TExtension &
        ThisType<
          MutableSurface<TInstance> &
            ATS.TypeofSchema<AddSchemaFields<ApplySchemaOverride<TSchema, TExtension>, TExtension>> &
            MethodsForExtension<TExtension, TSchema, TInstance>
        > &
        Partial<Record<Extract<NonOverrideMemberKeys<TExtension>, keyof TInstance>, never>> &
        Partial<Record<Exclude<ExtensionOverrideMemberKeys<TExtension>, keyof TInstance>, never>>;

type NonOverrideMemberKeys<TExtension> =
  TExtension extends Record<string, unknown>
    ? {
        [TName in keyof TExtension]: IsOverrideValue<TExtension[TName]> extends true ? never : TName;
      }[keyof TExtension]
    : never;
type ExtensionOverrideMemberKeys<TExtension> =
  TExtension extends Record<string, unknown>
    ? {
        [TName in keyof TExtension]: IsOverrideValue<TExtension[TName]> extends true ? TName : never;
      }[keyof TExtension]
    : never;
type IsAny<TValue> = 0 extends 1 & TValue ? true : false;
type IsOverrideValue<TValue> = IsAny<TValue> extends true ? false : TValue extends OverrideDescriptor ? true : false;

type AnyClassExtension = AnyClassCapability | ClassMethodsInput | ClassMixin;

type MixinRequirements<TExtension> = TExtension extends ClassMixin<ClassMethodsInput, infer TRequires> ? TRequires : {};
type MixinRequirementsMet<TSchema extends ATS.AnyTypeSchema, TExtension> =
  Exclude<SchemaFieldKeys<MixinRequirements<TExtension>>, keyof ATS.TypeofSchema<TSchema>> extends never ? true : false;

/** Structural capabilities may inject their canonical fields. */
type CompatibleCapability<TCapability extends AnyClassCapability, _TSchema extends ATS.AnyTypeSchema> = TCapability;

declare const TIMESTAMPS_FIELD_MARKER: unique symbol;
declare const SOFT_DELETE_FIELD_MARKER: unique symbol;
declare const VERSIONED_FIELD_MARKER: unique symbol;

type SchemaContainsMarker<TSchema extends ATS.AnyTypeSchema, TMarker extends PropertyKey> =
  TSchema extends ATS.ObjectSchema<infer TShape>
    ? true extends {
        [TKey in keyof TShape]: TShape[TKey] extends { readonly [TKeyMarker in TMarker]: true } ? true : never;
      }[keyof TShape]
      ? true
      : false
    : false;

type CapabilityAlreadyInstalled<
  TCapability,
  TSchema extends ATS.AnyTypeSchema,
> = TCapability extends TimestampCapability
  ? SchemaContainsMarker<TSchema, typeof TIMESTAMPS_FIELD_MARKER>
  : TCapability extends SoftDeleteCapability
    ? SchemaContainsMarker<TSchema, typeof SOFT_DELETE_FIELD_MARKER>
    : TCapability extends VersionedCapability
      ? SchemaContainsMarker<TSchema, typeof VERSIONED_FIELD_MARKER>
      : false;

type NonConflictingCapability<TCapability extends AnyClassCapability, TSchema extends ATS.AnyTypeSchema, TInstance> =
  CapabilityAlreadyInstalled<TCapability, TSchema> extends true
    ? never
    : Extract<keyof MethodsForCapability<TCapability, TSchema, TInstance>, keyof TInstance> extends never
      ? CompatibleCapability<TCapability, TSchema>
      : never;

/** Methods an extension contributes, keeping declared signatures intact. */
type MethodsForExtension<TExtension, TSchema extends ATS.AnyTypeSchema, TInstance> =
  TExtension extends ClassMixin<infer TOutput>
    ? MethodsForExtension<TOutput, TSchema, TInstance>
    : [TExtension] extends [never]
      ? {}
      : TExtension extends AnyClassCapability
        ? MethodsForCapability<TExtension, TSchema, TInstance>
        : TExtension extends Record<string, unknown>
          ? {
              -readonly [TKey in keyof TExtension as IsOverrideValue<TExtension[TKey]> extends true
                ? IsSchemaFieldInput<
                    TExtension[TKey] extends OverrideDescriptor<infer TValue> ? TValue : never
                  > extends true
                  ? never
                  : TKey
                : [IsHiddenClassMember<TExtension[TKey]>] extends [true]
                  ? never
                  : IsSchemaFieldInput<TExtension[TKey]> extends true
                    ? never
                    : TKey]: ExtensionMemberType<TExtension[TKey]>;
            }
          : {};

type ExtensionMemberType<TValue> =
  TValue extends OverrideDescriptor<infer TInner>
    ? ExtensionMemberType<TInner>
    : TValue extends ClassMemberDescriptor<infer TDefinition>
      ? TDefinition extends { readonly kind: "method"; readonly implementation?: infer TImplementation }
        ? TImplementation extends (...args: infer TArgs) => infer TResult
          ? (...args: TArgs) => TResult
          : never
        : TDefinition extends { readonly kind: "accessor"; readonly getter?: infer TGetter }
          ? TGetter extends (...args: never[]) => infer TResult
            ? TResult
            : unknown
          : never
      : TValue;

type ExtensionMethods<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TExtensions extends readonly AnyClassExtension[],
> = UnionToIntersection<MethodsForExtension<TExtensions[number], TSchema, TInstance>>;
type MethodsForCapability<
  TCapability,
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
> = TCapability extends ClassWithCapability
  ? { with(patch: SchemaUpdate<TSchema>): TInstance }
  : TCapability extends ClassCloneCapability
    ? { clone(): TInstance }
    : TCapability extends ClassCapability<infer TMethods>
      ? TMethods
      : never;
type UnionToIntersection<TValue> = (TValue extends unknown ? (value: TValue) => void : never) extends (
  value: infer TIntersection
) => void
  ? TIntersection
  : never;

type IsSchemaInput<TValue> =
  IsAny<TValue> extends true
    ? false
    : TValue extends ATS.AnyTypeSchema | { readonly schema: ATS.AnyTypeSchema }
      ? true
      : false;
type MemberDefinition<TValue> =
  IsAny<TValue> extends true ? never : TValue extends ClassMemberDescriptor<infer TDefinition> ? TDefinition : never;
type IsHiddenClassMember<TValue> =
  TValue extends OverrideDescriptor<infer TInner>
    ? IsHiddenClassMember<TInner>
    : [MemberDefinition<TValue>] extends [never]
      ? false
      : [MemberDefinition<TValue>] extends [{ readonly visibility: "protected" | "private" }]
        ? true
        : false;
type DescriptorSchema<TValue> =
  IsAny<TValue> extends true
    ? never
    : MemberDefinition<TValue> extends infer TDefinition
      ? TDefinition extends { readonly kind: "field"; readonly schema?: infer TSchema }
        ? TSchema extends SchemaInput<infer TInner extends ATS.AnyTypeSchema>
          ? TDefinition extends { readonly noConstructor: true }
            ? TInner & { readonly [NO_CONSTRUCTOR_FIELD_MARKER]: true }
            : TInner
          : never
        : never
      : never;
type IsDescriptorField<TValue> =
  IsAny<TValue> extends true ? false : [DescriptorSchema<TValue>] extends [never] ? false : true;
type IsSchemaFieldInput<TValue> = IsDescriptorField<TValue> extends true ? true : IsSchemaInput<TValue>;
type SchemaFromInput<TValue> = [DescriptorSchema<TValue>] extends [never]
  ? TValue extends { readonly schema: infer TSchema extends ATS.AnyTypeSchema }
    ? TSchema
    : TValue extends ATS.AnyTypeSchema
      ? TValue
      : never
  : DescriptorSchema<TValue>;
type SchemaFieldKeys<TExtension> =
  TExtension extends Record<string, unknown>
    ? {
        [TKey in keyof TExtension]: IsSchemaFieldInput<TExtension[TKey]> extends true ? TKey : never;
      }[keyof TExtension]
    : never;
type SchemaFieldShape<TExtension> =
  TExtension extends Record<string, unknown>
    ? { [TKey in SchemaFieldKeys<TExtension>]: SchemaFromInput<TExtension[TKey]> }
    : {};
type PreservedManagedMarker<TPrevious> = TPrevious extends {
  readonly [TKey in typeof TIMESTAMPS_FIELD_MARKER]: true;
}
  ? { readonly [TKey in typeof TIMESTAMPS_FIELD_MARKER]: true }
  : TPrevious extends { readonly [TKey in typeof SOFT_DELETE_FIELD_MARKER]: true }
    ? { readonly [TKey in typeof SOFT_DELETE_FIELD_MARKER]: true }
    : TPrevious extends { readonly [TKey in typeof VERSIONED_FIELD_MARKER]: true }
      ? { readonly [TKey in typeof VERSIONED_FIELD_MARKER]: true }
      : {};
type SchemaOverrideKeys<TExtension> =
  TExtension extends Record<string, unknown>
    ? {
        [TKey in keyof TExtension]: IsOverrideValue<TExtension[TKey]> extends true
          ? TExtension[TKey] extends OverrideDescriptor<infer TValue>
            ? IsSchemaFieldInput<TValue> extends true
              ? TKey
              : never
            : never
          : never;
      }[keyof TExtension]
    : never;
type ApplySchemaOverride<TSchema extends ATS.AnyTypeSchema, TExtension> =
  TSchema extends ATS.ObjectSchema<infer TShape, infer TUnknownKeys, infer TCatchall>
    ? TExtension extends Record<string, unknown>
      ? ATS.ObjectSchema<
          Omit<TShape, SchemaOverrideKeys<TExtension>> & {
            [TKey in keyof TExtension as IsOverrideValue<TExtension[TKey]> extends true
              ? TExtension[TKey] extends OverrideDescriptor<infer TValue>
                ? IsSchemaFieldInput<TValue> extends true
                  ? TKey
                  : never
                : never
              : never]: IsOverrideValue<TExtension[TKey]> extends true
              ? TExtension[TKey] extends OverrideDescriptor<infer TValue>
                ? SchemaFromInput<TValue> & PreservedManagedMarker<TShape[TKey & keyof TShape]>
                : never
              : never;
          },
          TUnknownKeys,
          TCatchall
        >
      : TSchema
    : TSchema;
type AddSchemaFields<TSchema extends ATS.AnyTypeSchema, TExtension> =
  TSchema extends ATS.ObjectSchema<infer TShape, infer TUnknownKeys, infer TCatchall>
    ? ATS.ObjectSchema<
        Omit<TShape, keyof SchemaFieldShape<TExtension>> & SchemaFieldShape<TExtension>,
        TUnknownKeys,
        TCatchall
      >
    : TSchema;
// The public value remains Date/number rather than `Readonly<Date>`. The
// inner type is retained for the declaration-time managed-field marker; the
// create boundary makes these fields optional explicitly below.
type ManagedReadonlySchema<TInner extends ATS.AnyTypeSchema> = ATS.BaseSchema<
  ATS.TypeofSchema<TInner>,
  "readonly",
  ATS.InnerTypeDef<TInner>
>;
type ManagedCreatedAtSchema = ManagedReadonlySchema<ATS.DefaultSchema<ATS.DateSchema>> & {
  readonly [TIMESTAMPS_FIELD_MARKER]: true;
};
type ManagedUpdatedAtSchema = ManagedReadonlySchema<ATS.DefaultSchema<ATS.NullableSchema<ATS.DateSchema>>> & {
  readonly [TIMESTAMPS_FIELD_MARKER]: true;
};
type ManagedDeletedAtSchema = ManagedReadonlySchema<ATS.DefaultSchema<ATS.NullableSchema<ATS.DateSchema>>> & {
  readonly [SOFT_DELETE_FIELD_MARKER]: true;
};
type ManagedVersionSchema = ManagedReadonlySchema<ATS.DefaultSchema<ATS.IntSchema>> & {
  readonly [VERSIONED_FIELD_MARKER]: true;
};
type IsManagedFieldSchema<TSchema> = TSchema extends {
  readonly [TKey in typeof TIMESTAMPS_FIELD_MARKER]: true;
}
  ? true
  : TSchema extends { readonly [TKey in typeof SOFT_DELETE_FIELD_MARKER]: true }
    ? true
    : TSchema extends { readonly [TKey in typeof VERSIONED_FIELD_MARKER]: true }
      ? true
      : false;
type ManagedInputKeys<TShape extends ATS.SchemaShape> = {
  [TKey in keyof TShape]: IsManagedFieldSchema<TShape[TKey]> extends true ? TKey : never;
}[keyof TShape];
type IsNoConstructorField<TSchema> = TSchema extends {
  readonly [TKey in typeof NO_CONSTRUCTOR_FIELD_MARKER]: true;
}
  ? true
  : false;
type BoundaryExcludedKeys<TShape extends ATS.SchemaShape> = {
  [TKey in keyof TShape]: IsNoConstructorField<TShape[TKey]> extends true ? TKey : never;
}[keyof TShape];
type CreateInputForSchema<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.ObjectSchema<infer TShape>
    ? Omit<Input<TSchema>, ManagedInputKeys<TShape> | BoundaryExcludedKeys<TShape>> &
        Partial<Pick<Input<TSchema>, Extract<ManagedInputKeys<TShape>, keyof Input<TSchema>>>>
    : Input<TSchema>;

/** Create boundaries resolve defaults while retaining optional managed fields. */
export type ClassCreateInput<TSchema extends ATS.AnyTypeSchema> = CreateInputForSchema<TSchema>;

/** Hydration is a complete persisted boundary and never resolves defaults. */
export type ClassHydrateInput<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.ObjectSchema<infer TShape>
    ? Omit<Hydrate<TSchema>, BoundaryExcludedKeys<TShape>>
    : Hydrate<TSchema>;

/** Constructor input is a creation boundary, excluding generated fields. */
export type ClassConstructorInput<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.ObjectSchema<infer TShape> ? Omit<Input<TSchema>, BoundaryExcludedKeys<TShape>> : Input<TSchema>;

type CapabilityFieldShape<TCapability> =
  TCapability extends TimestampCapability<infer TOptions>
    ? {
        [TKey in TOptions["createdAt"] extends string ? TOptions["createdAt"] : "createdAt"]: ManagedCreatedAtSchema;
      } & {
        [TKey in TOptions["updatedAt"] extends string ? TOptions["updatedAt"] : "updatedAt"]: ManagedUpdatedAtSchema;
      }
    : TCapability extends SoftDeleteCapability<infer TOptions>
      ? { [TKey in TOptions["field"] extends string ? TOptions["field"] : "deletedAt"]: ManagedDeletedAtSchema }
      : TCapability extends VersionedCapability<infer TOptions>
        ? { [TKey in TOptions["field"] extends string ? TOptions["field"] : "version"]: ManagedVersionSchema }
        : {};
type AddCapabilitySchema<TSchema extends ATS.AnyTypeSchema, TCapability> =
  TSchema extends ATS.ObjectSchema<infer TShape, infer TUnknownKeys, infer TCatchall>
    ? ATS.ObjectSchema<
        Omit<TShape, keyof CapabilityFieldShape<TCapability>> & CapabilityFieldShape<TCapability>,
        TUnknownKeys,
        TCatchall
      >
    : TSchema;
type ApplyClassExtensionSchema<TSchema extends ATS.AnyTypeSchema, TExtension> = [TExtension] extends [never]
  ? TSchema
  : NormalizedClassExtension<TExtension> extends AnyClassCapability
    ? AddCapabilitySchema<TSchema, NormalizedClassExtension<TExtension>>
    : AddSchemaFields<
        ApplySchemaOverride<TSchema, NormalizedClassExtension<TExtension>>,
        NormalizedClassExtension<TExtension>
      >;
type ApplySchemaOverrides<
  TSchema extends ATS.AnyTypeSchema,
  TExtensions extends readonly AnyClassExtension[],
> = TExtensions extends readonly [infer THead, ...infer TTail extends readonly AnyClassExtension[]]
  ? ApplySchemaOverrides<ApplyClassExtensionSchema<TSchema, THead>, TTail>
  : TSchema;
type OverrideMemberKeys<TExtension> = TExtension extends AnyClassCapability
  ? never
  : TExtension extends Record<string, unknown>
    ? {
        [TKey in keyof TExtension]: TExtension[TKey] extends OverrideDescriptor ? TKey : never;
      }[keyof TExtension]
    : never;
type AllOverrideMemberKeys<TExtensions extends readonly AnyClassExtension[]> =
  TExtensions[number] extends infer TExtension ? OverrideMemberKeys<TExtension> : never;
type LifecycleUpdateMethod<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TExtensions extends readonly AnyClassExtension[],
> = [Extract<TExtensions[number], TimestampCapability | SoftDeleteCapability | VersionedCapability>] extends [never]
  ? {}
  : "update" extends keyof TInstance
    ? {}
    : { update(patch: SchemaUpdate<ApplySchemaOverrides<TSchema, TExtensions>>): void };
type ExplicitWritableFieldKeys<TExtension> =
  TExtension extends Record<string, unknown>
    ? {
        [TKey in keyof TExtension]: [
          MemberDefinition<TExtension[TKey] extends OverrideDescriptor<infer TInner> ? TInner : TExtension[TKey]>,
        ] extends [never]
          ? never
          : MemberDefinition<
                TExtension[TKey] extends OverrideDescriptor<infer TInner> ? TInner : TExtension[TKey]
              > extends { readonly kind: "field"; readonly visibility: "public" }
            ? MemberDefinition<
                TExtension[TKey] extends OverrideDescriptor<infer TInner> ? TInner : TExtension[TKey]
              > extends infer TDefinition
              ? TDefinition extends { readonly setter: true | Function }
                ? TKey
                : TDefinition extends { readonly getter: true | Function }
                  ? never
                  : TKey
              : never
            : never;
      }[keyof TExtension]
    : never;
type AllExplicitPublicFieldKeys<TExtensions extends readonly AnyClassExtension[]> =
  TExtensions[number] extends infer TExtension
    ? ExplicitWritableFieldKeys<NormalizedClassExtension<TExtension>>
    : never;
type TypeEquals<TLeft, TRight> =
  (<TValue>() => TValue extends TLeft ? 1 : 2) extends <TValue>() => TValue extends TRight ? 1 : 2 ? true : false;
type WritableKeys<TValue> = {
  [TKey in keyof TValue]-?: TypeEquals<Pick<TValue, TKey>, { -readonly [TName in TKey]: TValue[TName] }> extends true
    ? TKey
    : never;
}[keyof TValue];
type PreservedWritableFieldKeys<TInstance, TSchema extends ATS.AnyTypeSchema> = Extract<
  WritableKeys<TInstance>,
  keyof ATS.TypeofSchema<TSchema>
>;
type ExistingWritableFieldKeys<
  TInstance,
  TSchema extends ATS.AnyTypeSchema,
  TEncapsulated extends boolean,
> = TEncapsulated extends true ? PreservedWritableFieldKeys<TInstance, TSchema> : never;

type ExtendedInstance<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TExtensions extends readonly AnyClassExtension[],
  TEncapsulated extends boolean = false,
> = [AllOverrideMemberKeys<TExtensions> | AllHiddenClassMemberKeys<TExtensions>] extends [never]
  ? TInstance &
      ClassFieldSurface<
        ApplySchemaOverrides<TSchema, TExtensions>,
        TEncapsulated,
        | ExistingWritableFieldKeys<TInstance, ApplySchemaOverrides<TSchema, TExtensions>, TEncapsulated>
        | AllExplicitPublicFieldKeys<TExtensions>
      > &
      ExtensionMethods<TSchema, TInstance, TExtensions> &
      LifecycleUpdateMethod<TSchema, TInstance, TExtensions>
  : Omit<TInstance, AllOverrideMemberKeys<TExtensions> | AllHiddenClassMemberKeys<TExtensions>> &
      Omit<
        ClassFieldSurface<
          ApplySchemaOverrides<TSchema, TExtensions>,
          TEncapsulated,
          | ExistingWritableFieldKeys<TInstance, ApplySchemaOverrides<TSchema, TExtensions>, TEncapsulated>
          | AllExplicitPublicFieldKeys<TExtensions>
        >,
        AllHiddenClassMemberKeys<TExtensions>
      > &
      ExtensionMethods<TSchema, TInstance, TExtensions> &
      LifecycleUpdateMethod<TSchema, TInstance, TExtensions>;

type ClassFieldSurface<
  TSchema extends ATS.AnyTypeSchema,
  TEncapsulated extends boolean,
  TWritable extends PropertyKey = never,
> = TEncapsulated extends true
  ? Omit<Readonly<ATS.TypeofSchema<TSchema>>, TWritable> & {
      -readonly [TKey in Extract<TWritable, keyof ATS.TypeofSchema<TSchema>>]: ATS.TypeofSchema<TSchema>[TKey];
    }
  : ATS.TypeofSchema<TSchema>;
type HiddenClassMemberKeys<TExtension> =
  TExtension extends Record<string, unknown>
    ? {
        [TKey in keyof TExtension]: IsHiddenClassMember<TExtension[TKey]> extends true ? TKey : never;
      }[keyof TExtension]
    : never;
type AllHiddenClassMemberKeys<TExtensions extends readonly AnyClassExtension[]> =
  TExtensions[number] extends infer TExtension ? HiddenClassMemberKeys<NormalizedClassExtension<TExtension>> : never;
type MutableSurface<TValue> = TValue extends object ? { -readonly [TKey in keyof TValue]: TValue[TKey] } : TValue;

export interface RuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance = ATS.TypeofSchema<TSchema>,
  TTraits extends ATS.RuntimeTypeTraits = ClassRuntimeTraits,
  TEncapsulated extends boolean = false,
> {
  new (input: ClassConstructorInput<TSchema>): TInstance;
  readonly schema: ATS.RuntimeTypeSchema<TSchema, TInstance, TTraits["representation"], TTraits["identifier"], TTraits>;
  create<TThis extends RuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>>(
    this: TThis,
    input: ClassCreateInput<TSchema>
  ): InstanceType<TThis>;
  hydrate<TThis extends RuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>>(
    this: TThis,
    state: ClassHydrateInput<TSchema>
  ): InstanceType<TThis>;
  extends<const TExtensions extends readonly AnyClassExtension[]>(
    ...extensions: TExtensions & ClassExtensionArgs<TSchema, TInstance, TExtensions>
  ): RuntimeClass<
    ApplySchemaOverrides<TSchema, TExtensions>,
    ExtendedInstance<TSchema, TInstance, TExtensions, TEncapsulated>,
    TTraits,
    TEncapsulated
  >;
  factories<const TOptions extends FactoryOptions>(
    options: TOptions
  ): ConfiguredRuntimeClass<
    TSchema,
    TInstance,
    TOptions,
    "throw",
    JITValidationError,
    false,
    false,
    TTraits,
    TEncapsulated
  >;
  construction(mode: "constructor"): ConstructorRuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>;
  construction(mode: "factory"): FactoryRuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>;
  accessors<TThis extends RuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>>(
    this: TThis,
    options: AccessorOptions<TSchema>
  ): TThis;
  identity<TKey extends Extract<keyof ATS.TypeofSchema<TSchema>, string>>(
    key: TKey
  ): RuntimeClass<TSchema, TInstance & IdentityMethods, TTraits, TEncapsulated>;
  validate(policy?: FactoryValidationOptions): RuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>;
  assert(
    predicate: (query: QueryConditionBuilder<ATS.TypeofSchema<TSchema>>) => QueryConditionNode,
    options?: AssertionOptions
  ): RuntimeClass<TSchema, TInstance, AssertionTraits<TTraits, TTraits["factoryPolicy"]["errorType"]>, TEncapsulated>;
}

// A failure policy applies to factories, so a constructor-first class does not
// carry one: `.factories()` is the step that opens that boundary.
type RuntimeClassConstructionMembers =
  | "create"
  | "hydrate"
  | "extends"
  | "factories"
  | "construction"
  | "accessors"
  | "identity"
  | "validate"
  | "assert";

/** The default `JIT.class` surface: direct construction, no static factories. */
export type ConstructorRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance = ATS.TypeofSchema<TSchema>,
  TTraits extends ATS.RuntimeTypeTraits = ClassRuntimeTraits,
  TEncapsulated extends boolean = false,
> = (new (
  input: ClassConstructorInput<TSchema>
) => TInstance) &
  Omit<RuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>, RuntimeClassConstructionMembers> & {
    extends<const TExtensions extends readonly AnyClassExtension[]>(
      ...extensions: TExtensions & ClassExtensionArgs<TSchema, TInstance, TExtensions>
    ): ConstructorRuntimeClass<
      ApplySchemaOverrides<TSchema, TExtensions>,
      ExtendedInstance<TSchema, TInstance, TExtensions, TEncapsulated>,
      TTraits,
      TEncapsulated
    >;
    factories<const TOptions extends FactoryOptions>(
      options: TOptions
    ): ConfiguredRuntimeClass<
      TSchema,
      TInstance,
      TOptions,
      "throw",
      JITValidationError,
      false,
      true,
      TTraits,
      TEncapsulated
    >;
    construction(mode: "constructor"): ConstructionFixedConstructor<TSchema, TInstance, TTraits, TEncapsulated>;
    construction(mode: "factory"): ConstructionFixedFactory<TSchema, TInstance, TTraits, TEncapsulated>;
    accessors(
      options: AccessorOptions<TSchema>
    ): (new (
      input: ClassConstructorInput<TSchema>
    ) => TInstance) &
      Omit<ConstructorRuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>, "accessors">;
    identity<TKey extends Extract<keyof ATS.TypeofSchema<TSchema>, string>>(
      key: TKey
    ): (new (
      input: ClassConstructorInput<TSchema>
    ) => TInstance & IdentityMethods) &
      Omit<ConstructorRuntimeClass<TSchema, TInstance & IdentityMethods, TTraits, TEncapsulated>, "identity">;
  };

export interface FactoryOptions {
  readonly create?: string | false | ClassMemberDescriptor<ClassFactoryMemberDescriptor>;
  readonly hydrate?: string | false | ClassMemberDescriptor<ClassFactoryMemberDescriptor>;
}

type FactoryModeCandidate<TMode extends FactoryReturnMode = FactoryReturnMode, TPriority extends number = number> = {
  readonly mode: TMode;
  readonly priority: TPriority;
};

type NestedFactoryModeCandidates<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.RuntimeTypeSchema<ATS.AnyTypeSchema, unknown, "object" | "value", boolean, infer TTraits>
    ? TTraits["factoryPolicy"] extends { readonly configured: true }
      ? TTraits["factoryPolicy"] extends { readonly resultModeExplicit: true | false }
        ? TTraits["factoryPolicy"] extends { readonly resultModeExplicit: true }
          ? FactoryModeCandidate<
              Extract<TTraits["factoryPolicy"]["resultMode"], FactoryReturnMode>,
              TTraits["factoryPolicy"]["priority"]
            >
          : TTraits["factoryPolicy"] extends { readonly resultModeInherited: true }
            ? FactoryModeCandidate<
                Extract<TTraits["factoryPolicy"]["resultMode"], FactoryReturnMode>,
                TTraits["factoryPolicy"]["priority"]
              >
            : never
        : never
      : never
    : TSchema extends ATS.ObjectSchema<infer TShape>
      ? NestedFactoryModeCandidates<TShape[keyof TShape]>
      : TSchema extends ATS.ArraySchema<infer TElement> | ATS.SetSchema<infer TElement>
        ? NestedFactoryModeCandidates<TElement>
        : TSchema extends ATS.LazySchema<infer TInner>
          ? NestedFactoryModeCandidates<TInner>
          : TSchema extends
                | ATS.OptionalSchema<infer TInner>
                | ATS.NullableSchema<infer TInner>
                | ATS.NullishSchema<infer TInner>
                | ATS.DefaultSchema<infer TInner>
                | ATS.BrandSchema<infer TInner>
                | ATS.ReadonlySchema<infer TInner>
                | ATS.RefineSchema<infer TInner>
                | ATS.CoerceSchema<infer TInner>
                | ATS.PipeSchema<infer TInner>
                | ATS.TransformSchema<infer TInner>
            ? NestedFactoryModeCandidates<TInner>
            : never;

type ModeRank<TMode extends FactoryReturnMode> = TMode extends "tuple" ? 0 : TMode extends "either" ? 1 : 2;
type IsHigherModeCandidate<TLeft, TRight> = TLeft extends FactoryModeCandidate
  ? TRight extends FactoryModeCandidate
    ? CompareNumericLiteral<TLeft["priority"], TRight["priority"]> extends "gt"
      ? true
      : CompareNumericLiteral<TLeft["priority"], TRight["priority"]> extends "eq"
        ? ModeRank<TLeft["mode"]> extends ModeRank<TRight["mode"]>
          ? false
          : ModeRank<TLeft["mode"]> extends 2
            ? true
            : ModeRank<TRight["mode"]> extends 2
              ? false
              : ModeRank<TLeft["mode"]> extends 1
                ? true
                : false
        : false
    : false
  : false;
type HasHigherModeCandidate<TCandidate, TAll> = TAll extends unknown ? IsHigherModeCandidate<TAll, TCandidate> : never;
type HighestModeCandidates<TAll, TCandidate = TAll> = TCandidate extends FactoryModeCandidate
  ? true extends HasHigherModeCandidate<TCandidate, TAll>
    ? never
    : TCandidate
  : never;
type InheritedFactoryModeFor<TSchema extends ATS.AnyTypeSchema> = [NestedFactoryModeCandidates<TSchema>] extends [never]
  ? "throw"
  : HighestModeCandidates<NestedFactoryModeCandidates<TSchema>>["mode"];

type DeclaredFactoryError<TError> = unknown extends TError ? never : [TError] extends [undefined] ? never : TError;

type NestedFactoryErrors<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.RuntimeTypeSchema<ATS.AnyTypeSchema, unknown, "object" | "value", boolean, infer TTraits>
    ? TTraits["factoryPolicy"] extends { readonly configured: true; readonly errorType: infer TError }
      ? DeclaredFactoryError<TError>
      : never
    : TSchema extends ATS.ObjectSchema<infer TShape>
      ? NestedFactoryErrors<TShape[keyof TShape]>
      : TSchema extends ATS.ArraySchema<infer TElement> | ATS.SetSchema<infer TElement>
        ? NestedFactoryErrors<TElement>
        : TSchema extends ATS.LazySchema<infer TInner>
          ? NestedFactoryErrors<TInner>
          : TSchema extends
                | ATS.OptionalSchema<infer TInner>
                | ATS.NullableSchema<infer TInner>
                | ATS.NullishSchema<infer TInner>
                | ATS.DefaultSchema<infer TInner>
                | ATS.BrandSchema<infer TInner>
                | ATS.ReadonlySchema<infer TInner>
                | ATS.RefineSchema<infer TInner>
                | ATS.CoerceSchema<infer TInner>
                | ATS.PipeSchema<infer TInner>
                | ATS.TransformSchema<infer TInner>
            ? NestedFactoryErrors<TInner>
            : never;

type InitialRuntimeTypeTraits<TSchema extends ATS.AnyTypeSchema> = [NestedFactoryModeCandidates<TSchema>] extends [
  never,
]
  ? ClassRuntimeTraits
  : ATS.RuntimeTypeTraits<
      "object",
      false,
      ATS.RuntimeTypeFactoryPolicyTraits<
        InheritedFactoryModeFor<TSchema>,
        true,
        unknown,
        NestedFactoryModeCandidates<TSchema>["priority"]
      > & {
        readonly resultModeExplicit: false;
        readonly resultModeInherited: true;
        readonly hasAssertions: false;
      }
    >;

type InheritedFactoryMode<TSchema extends ATS.AnyTypeSchema> = InheritedFactoryModeFor<TSchema>;

export type AccessorVisibility = "public" | "protected" | "private" | false;

export interface AccessorMember {
  readonly name?: string;
  readonly visibility?: AccessorVisibility;
}

export interface FieldAccessorOptions {
  readonly field?: AccessorVisibility;
  readonly get?: AccessorVisibility | AccessorMember;
  readonly set?: AccessorVisibility | AccessorMember;
}

export interface AccessorOptions<TSchema extends ATS.AnyTypeSchema> {
  readonly default?: FieldAccessorOptions;
  readonly fields?: Partial<Record<Extract<keyof ATS.TypeofSchema<TSchema>, string>, FieldAccessorOptions>>;
}

type RuntimeConstructor<TInstance> = abstract new (...args: never[]) => TInstance;
type CreateArguments<TSchema extends ATS.AnyTypeSchema> =
  undefined extends ClassCreateInput<TSchema>
    ? [] | [input: ClassCreateInput<TSchema>]
    : [input: ClassCreateInput<TSchema>];

type FactoryOptionName<TValue> = TValue extends string
  ? TValue
  : TValue extends ClassMemberDescriptor<infer TDefinition>
    ? TDefinition extends ClassFactoryMemberDescriptor
      ? TDefinition["name"]
      : never
    : never;

type FactoryMethods<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TOptions extends FactoryOptions,
  TMode = "throw",
  TError = JITValidationError,
> = (TOptions extends { readonly create: infer TValue }
  ? FactoryOptionName<TValue> extends infer TName extends string
    ? {
        [TKey in TName]: <TThis extends RuntimeConstructor<TInstance>>(
          this: TThis,
          ...args: CreateArguments<TSchema>
        ) => FactoryOutcome<InstanceType<TThis>, TMode, TError>;
      }
    : never
  : TOptions extends { readonly create: false }
    ? {}
    : {
        create<TThis extends RuntimeConstructor<TInstance>>(
          this: TThis,
          ...args: CreateArguments<TSchema>
        ): FactoryOutcome<InstanceType<TThis>, TMode, TError>;
      }) &
  (TOptions extends { readonly hydrate: infer TValue }
    ? FactoryOptionName<TValue> extends infer TName extends string
      ? {
          [TKey in TName]: <TThis extends RuntimeConstructor<TInstance>>(
            this: TThis,
            state: ClassHydrateInput<TSchema>
          ) => FactoryOutcome<InstanceType<TThis>, TMode, TError>;
        }
      : never
    : TOptions extends { readonly hydrate: false }
      ? {}
      : {
          hydrate<TThis extends RuntimeConstructor<TInstance>>(
            this: TThis,
            state: ClassHydrateInput<TSchema>
          ): FactoryOutcome<InstanceType<TThis>, TMode, TError>;
        });

type ResolvedResultMode<TPolicy, TDefault extends FactoryReturnMode = "throw"> = TPolicy extends {
  readonly result: infer TMode extends FactoryReturnModeInput;
}
  ? TMode extends "result"
    ? "either"
    : TMode
  : TDefault;
type ResolvedResultModeExplicit<TPolicy> = TPolicy extends {
  readonly result: FactoryReturnModeInput;
}
  ? true
  : false;
type ResolvedResultModeInherited<TTraits extends ATS.RuntimeTypeTraits, TPolicy> = TPolicy extends {
  readonly result: FactoryReturnModeInput;
}
  ? false
  : TTraits["factoryPolicy"]["resultModeInherited"];
type ResolvedFactoryPriority<TPolicy, TDefault extends number> = TPolicy extends {
  readonly result: FactoryReturnModeInput;
}
  ? TPolicy extends { readonly priority: infer TPriority extends number }
    ? TPriority
    : 1000
  : TPolicy extends { readonly priority: infer TPriority extends number }
    ? TPriority
    : TDefault;
type LiteralPriorityPolicy<TPolicy> = TPolicy extends { readonly priority: infer TPriority extends number }
  ? number extends TPriority
    ? { readonly priority: never }
    : {}
  : {};
type ResolvedFactoryError<TPolicy, TError, TSchema extends ATS.AnyTypeSchema> = TPolicy extends {
  readonly error: (...args: never[]) => infer TNext;
}
  ? TNext
  : TError | NestedFactoryErrors<TSchema>;
type ResolvedAssertionError<TOptions, TError> = TOptions extends {
  readonly error: (...args: never[]) => infer TNext;
}
  ? TError | TNext
  : TError | DomainAssertionError;

export type ConfiguredRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TOptions extends FactoryOptions,
  TMode extends FactoryReturnMode = "throw",
  TError = JITValidationError,
  TValidated extends boolean = false,
  TFactoriesConfigured extends boolean = false,
  TTraits extends ATS.RuntimeTypeTraits = ClassRuntimeTraits,
  TEncapsulated extends boolean = false,
> = (abstract new (
  input: ClassConstructorInput<TSchema>
) => TInstance) &
  Omit<RuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>, RuntimeClassConstructionMembers> &
  FactoryMethods<TSchema, TInstance, TOptions, TMode, TError> & {
    extends<const TExtensions extends readonly AnyClassExtension[]>(
      ...extensions: TExtensions & ClassExtensionArgs<TSchema, TInstance, TExtensions>
    ): ConfiguredRuntimeClass<
      ApplySchemaOverrides<TSchema, TExtensions>,
      ExtendedInstance<TSchema, TInstance, TExtensions, TEncapsulated>,
      TOptions,
      TMode,
      TError,
      TValidated,
      TFactoriesConfigured,
      TTraits,
      TEncapsulated
    >;
    accessors(
      options: AccessorOptions<TSchema>
    ): (abstract new (
      input: ClassConstructorInput<TSchema>
    ) => TInstance) &
      Omit<
        ConfiguredRuntimeClass<
          TSchema,
          TInstance,
          TOptions,
          TMode,
          TError,
          TValidated,
          TFactoriesConfigured,
          TTraits,
          TEncapsulated
        >,
        "accessors"
      >;
    /** Adds one domain invariant, written in the shared condition builder. */
    assert<const TAssertion extends AssertionOptions = Record<never, never>>(
      predicate: (query: QueryConditionBuilder<ATS.TypeofSchema<TSchema>>) => QueryConditionNode,
      options?: TAssertion
    ): ConfiguredRuntimeClass<
      TSchema,
      TInstance,
      TOptions,
      TMode,
      ResolvedAssertionError<TAssertion, TError> | NestedFactoryErrors<TSchema>,
      TValidated,
      TFactoriesConfigured,
      AssertionTraits<TTraits, ResolvedAssertionError<TAssertion, TError>>,
      TEncapsulated
    >;
  } & (TValidated extends true
    ? object
    : {
        /** Fixes the factory validation policy exactly once for this artifact. */
        validate<const TPolicy extends FactoryValidationOptions = Record<never, never>>(
          policy?: TPolicy & FactoryValidationOptions & LiteralPriorityPolicy<TPolicy>
        ): ConfiguredRuntimeClass<
          TSchema,
          TInstance,
          TOptions,
          ResolvedResultMode<TPolicy, TMode>,
          ResolvedFactoryError<TPolicy, TError, TSchema>,
          true,
          TFactoriesConfigured,
          FactoryTraits<
            TTraits,
            Extract<ResolvedResultMode<TPolicy, TMode>, FactoryReturnMode>,
            ResolvedFactoryError<TPolicy, TError, TSchema>,
            true,
            false,
            ResolvedResultModeExplicit<TPolicy>,
            ResolvedResultModeInherited<TTraits, TPolicy>,
            ResolvedFactoryPriority<TPolicy, TTraits["factoryPolicy"]["priority"]>
          >,
          TEncapsulated
        >;
      }) &
  (TValidated extends true
    ? object
    : TFactoriesConfigured extends true
      ? object
      : {
          construction(mode: "constructor"): ConstructionFixedConstructor<TSchema, TInstance, TTraits, TEncapsulated>;
          construction(
            mode: "factory"
          ): (abstract new (
            input: ClassConstructorInput<TSchema>
          ) => TInstance) &
            Omit<
              ConfiguredRuntimeClass<
                TSchema,
                TInstance,
                TOptions,
                TMode,
                TError,
                false,
                TFactoriesConfigured,
                TTraits,
                TEncapsulated
              >,
              "construction" | "factories"
            >;
        }) &
  (TFactoriesConfigured extends true
    ? object
    : {
        factories<const TNext extends FactoryOptions>(
          options: TNext
        ): ConfiguredRuntimeClass<TSchema, TInstance, TNext, TMode, TError, TValidated, true, TTraits, TEncapsulated>;
      });

export type FactoryRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance = ATS.TypeofSchema<TSchema>,
  TTraits extends ATS.RuntimeTypeTraits = InitialRuntimeTypeTraits<TSchema>,
  TEncapsulated extends boolean = false,
> = ConfiguredRuntimeClass<
  TSchema,
  TInstance,
  {},
  InheritedFactoryMode<TSchema>,
  JITValidationError,
  false,
  false,
  TTraits,
  TEncapsulated
>;

/** Entity declaration before a structural identifier extension is applied. */
export type PendingEntityRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TTraits extends ATS.RuntimeTypeTraits = InitialRuntimeTypeTraits<TSchema>,
> = Omit<FactoryRuntimeClass<TSchema, TInstance, TTraits, true>, "create" | "hydrate" | "factories" | "extends"> & {
  extends<const TExtensions extends readonly AnyClassExtension[]>(
    ...extensions: TExtensions & ClassExtensionArgs<TSchema, TInstance, TExtensions>
  ): EntityRuntimeClassFor<
    ApplySchemaOverrides<TSchema, TExtensions>,
    ExtendedInstance<TSchema, TInstance, TExtensions, true>,
    TTraits
  >;
};

type EntityRuntimeClassFor<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TTraits extends ATS.RuntimeTypeTraits = InitialRuntimeTypeTraits<TSchema>,
> = [IdentityKeys<TSchema>] extends [never]
  ? PendingEntityRuntimeClass<TSchema, TInstance, TTraits>
  : FactoryRuntimeClass<TSchema, TInstance & IdentityMethods, TTraits, true>;

type ConstructionFixedConstructor<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TTraits extends ATS.RuntimeTypeTraits = ClassRuntimeTraits,
  TEncapsulated extends boolean = false,
> = (new (
  input: ClassConstructorInput<TSchema>
) => TInstance) &
  Omit<ConstructorRuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>, "construction" | "factories">;

type ConstructionFixedFactory<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TTraits extends ATS.RuntimeTypeTraits = ClassRuntimeTraits,
  TEncapsulated extends boolean = false,
> = (abstract new (
  input: ClassConstructorInput<TSchema>
) => TInstance) &
  Omit<FactoryRuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>, "construction" | "factories">;

type ScalarFactoryRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TTraits extends ATS.RuntimeTypeTraits = ClassRuntimeTraits,
  TEncapsulated extends boolean = false,
> = (abstract new (
  input: ClassConstructorInput<TSchema>
) => TInstance) &
  Omit<FactoryRuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>, "accessors" | "assert">;

type IdentifierRuntimeTraits = ATS.RuntimeTypeTraits<"value", true, ATS.DefaultRuntimeTypeFactoryPolicyTraits>;

type IdentifierRuntimeClass<TSchema extends ATS.AnyTypeSchema, TInstance> = ScalarFactoryRuntimeClass<
  TSchema,
  TInstance,
  IdentifierRuntimeTraits
> & {
  readonly schema: ATS.RuntimeTypeSchema<TSchema, TInstance, "value", true, IdentifierRuntimeTraits>;
};

type RuntimeClassTarget = RuntimeClass<ATS.AnyTypeSchema> & {
  readonly [CLASS_TARGET]: true;
};

interface ResolvedAccessor {
  readonly key: string;
  readonly field: AccessorVisibility;
  readonly get: string | false;
  readonly set: string | false;
}

type ResolvedAccessors = readonly ResolvedAccessor[];

/** Resolves the class target without making the marker part of the public surface. */
export function getRuntimeClassTarget(value: unknown): RuntimeClassTarget | undefined {
  if (typeof value !== "function" || !(CLASS_TARGET in value)) return undefined;
  return value as RuntimeClassTarget;
}

/** A generated base constructor that cannot itself be instantiated through `create` or `hydrate`. */
export type AbstractRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance = ATS.TypeofSchema<TSchema>,
  TTraits extends ATS.RuntimeTypeTraits = ClassRuntimeTraits,
  TEncapsulated extends boolean = false,
> = (abstract new (
  input: ClassConstructorInput<TSchema>
) => TInstance) &
  Omit<RuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>, RuntimeClassConstructionMembers> & {
    extends<const TExtensions extends readonly AnyClassExtension[]>(
      ...extensions: TExtensions & ClassExtensionArgs<TSchema, TInstance, TExtensions>
    ): AbstractRuntimeClass<
      ApplySchemaOverrides<TSchema, TExtensions>,
      ExtendedInstance<TSchema, TInstance, TExtensions, TEncapsulated>,
      TTraits,
      TEncapsulated
    >;
    factories<const TOptions extends FactoryOptions>(
      options: TOptions
    ): ConfiguredRuntimeClass<
      TSchema,
      TInstance,
      TOptions,
      "throw",
      JITValidationError,
      false,
      true,
      TTraits,
      TEncapsulated
    >;
    accessors(
      options: AccessorOptions<TSchema>
    ): (abstract new (
      input: ClassConstructorInput<TSchema>
    ) => TInstance) &
      Omit<AbstractRuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>, "accessors">;
    identity<TKey extends Extract<keyof ATS.TypeofSchema<TSchema>, string>>(
      key: TKey
    ): (abstract new (
      input: ClassConstructorInput<TSchema>
    ) => TInstance & IdentityMethods) &
      Omit<AbstractRuntimeClass<TSchema, TInstance & IdentityMethods, TTraits, TEncapsulated>, "identity">;
  };

/** An immutable, tree-shakeable operation that installs one prototype capability. */
export interface ClassCapability<TMethods extends object = object> {
  readonly kind: string;
  install(classTarget: Function, schema: ATS.AnyTypeSchema): void;
  readonly __methods?: TMethods;
  /** Declaration-time names used by the member resolver; never emitted. */
  readonly __memberNames?: readonly string[];
  /** Declaration-time options used by structural DDD capabilities. */
  readonly __options?: unknown;
}

/**
 * Application-owned methods installed on the generated prototype.
 *
 * One function per name, shared by every instance. There is no dispatcher: a
 * call reaches the prototype the way it reaches a hand-written class method.
 */
export type ClassMethodsInput = Readonly<Record<string, unknown>>;

/**
 * The surface available while a structural mixin is declared.  It is
 * deliberately limited to the mixin's own fields and its host requirements;
 * fields added by a future host class are not guessed here.
 */
type MixinThisSurface<TFields extends ClassMethodsInput, TRequires extends ClassMethodsInput> = ATS.TypeofSchema<
  ATS.ObjectSchema<SchemaFieldShape<TFields & TRequires>>
>;

export interface ClassMixinDefinition<
  TFields extends ClassMethodsInput = ClassMethodsInput,
  TMethods extends ClassMethodsInput = ClassMethodsInput,
  TRequires extends ClassMethodsInput = ClassMethodsInput,
> {
  /** Existing host fields visible to methods, without adding persistence fields. */
  readonly requires?: TRequires;
  readonly fields?: TFields;
  readonly methods?: TMethods & ThisType<MixinThisSurface<TFields, TRequires>>;
}

export interface ClassMixin<
  TOutput extends ClassMethodsInput = ClassMethodsInput,
  TRequires extends ClassMethodsInput = ClassMethodsInput,
> {
  (): TOutput;
  readonly __classMixin: true;
  readonly __requires?: TRequires;
}

const CLASS_MIXIN = Symbol("jit.class.mixin");

export function classMixin<
  const TRequires extends ClassMethodsInput = {},
  const TFields extends ClassMethodsInput = {},
  const TMethods extends ClassMethodsInput = {},
>(definition: {
  readonly requires?: TRequires;
  readonly fields?: TFields;
  readonly methods?: TMethods & ThisType<MixinThisSurface<TFields, TRequires>>;
}): ClassMixin<TFields & TMethods, TRequires>;
export function classMixin(definition: ClassMixinDefinition): ClassMixin {
  const fieldNames = new Set(Object.getOwnPropertyNames(definition.fields ?? {}));
  const methodNames = Object.getOwnPropertyNames(definition.methods ?? {});
  if (methodNames.some((name) => fieldNames.has(name))) {
    throw new JITError(
      "CLASS_MEMBER_ALREADY_EXISTS",
      "A class mixin cannot declare the same member as a field and method"
    );
  }
  const mixin = (() => Object.freeze({ ...(definition.fields ?? {}), ...(definition.methods ?? {}) })) as ClassMixin;
  Object.defineProperties(mixin, {
    [CLASS_MIXIN]: { enumerable: false, value: true },
    __classMixin: { enumerable: false, value: true },
    __requires: { enumerable: false, value: definition.requires ?? {} },
  });
  return Object.freeze(mixin);
}

function isClassMixin(value: unknown): value is ClassMixin {
  return typeof value === "function" && (value as { readonly [CLASS_MIXIN]?: unknown })[CLASS_MIXIN] === true;
}

type NormalizedClassExtension<TExtension> = TExtension extends ClassMixin<infer TOutput> ? TOutput : TExtension;

/** Names a custom extension may not take, whatever the schema declares. */
/** A scalar Value Object is its value; those members are already taken. */
const SCALAR_MEMBERS: ReadonlySet<string> = new Set(["value", "equals", "hashCode", "toJSON"]);

const RESERVED_EXTENSION_NAMES: ReadonlySet<string> = new Set([
  "constructor",
  "schema",
  "create",
  "hydrate",
  "extends",
  "factories",
  "construction",
  "accessors",
  "identity",
  "validate",
  "assert",
]);

function isClassCapability(value: unknown): value is AnyClassCapability {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { install?: unknown }).install === "function" &&
    typeof (value as { kind?: unknown }).kind === "string"
  );
}

/** Minimal application-owned event publisher contract. */
export interface EventPublisher<TEvent = unknown> {
  publish(event: TEvent): void | Promise<void>;
}

/** Versioned structural metadata exposed by a domain-event instance. */
export interface StandardEvent {
  readonly version: 1;
  readonly type: string;
  readonly schemaVersion: number;
}

type AnyClassCapability = ClassCapability<object>;
type EqualsMethods = { equals(other: unknown): boolean };
type HashCodeMethods = { hashCode(): number };
type DiffMethods = { diff(other: unknown): DiffChange[] };
type IdentityMethods = {
  sameIdentity(other: unknown): boolean;
  identity(): unknown;
};
type ValueAccessor<TValue> = { readonly value: TValue };
export interface ScalarValueObject<TValue> extends EqualsMethods, HashCodeMethods {
  readonly value: TValue;
}
export interface TimestampOptions {
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly touch?: "mutation" | "manual";
  /** Runtime clock. Omit it to emit a direct `new Date()` in runtime and AOT. */
  readonly clock?: () => Date;
  readonly methods?: {
    /** Prototype method name; defaults to `touch`. */
    readonly touch?: string;
  };
}
export interface SoftDeleteOptions {
  readonly field?: string;
  /** Uses the timestamp clock when omitted and timestamps are installed. */
  readonly clock?: () => Date;
  readonly methods?: {
    readonly delete?: string;
    readonly restore?: string;
    readonly isDeleted?: string;
  };
}
export interface VersionedOptions {
  readonly field?: string;
}
declare class AggregateProtectedMethods<TSchema extends ATS.AnyTypeSchema> {
  protected update(patch: SchemaUpdate<TSchema>): void;
  protected raise(event: unknown): void;
}

type AggregateMethods<TSchema extends ATS.AnyTypeSchema> = AggregateProtectedMethods<TSchema> & {
  peekEvents(): readonly unknown[];
  pullEvents(): unknown[];
  commit(publisher: EventPublisher): Promise<void>;
};
type NamedMethod<TName extends string, TMethod> = {
  readonly [TKey in TName]: TMethod;
};
type OptionMethodName<TOptions, TKey extends PropertyKey, TFallback extends string> = TOptions extends {
  readonly methods: Record<TKey, infer TName extends string>;
}
  ? TName
  : TFallback;
type TimestampMethodsFor<TOptions> = NamedMethod<OptionMethodName<TOptions, "touch", "touch">, () => void>;
type SoftDeleteMethodsFor<TOptions> = NamedMethod<OptionMethodName<TOptions, "delete", "softDelete">, () => void> &
  NamedMethod<OptionMethodName<TOptions, "restore", "restore">, () => void> &
  Readonly<NamedMethod<OptionMethodName<TOptions, "isDeleted", "isDeleted">, boolean>>;

export interface TimestampCapability<TOptions extends TimestampOptions = TimestampOptions>
  extends ClassCapability<TimestampMethodsFor<TOptions>> {
  readonly kind: "ddd.timestamps";
  readonly __options?: TOptions;
}

export interface SoftDeleteCapability<TOptions extends SoftDeleteOptions = SoftDeleteOptions>
  extends ClassCapability<SoftDeleteMethodsFor<TOptions>> {
  readonly kind: "ddd.softDelete";
  readonly __options?: TOptions;
}

export interface VersionedCapability<TOptions extends VersionedOptions = VersionedOptions>
  extends ClassCapability<object> {
  readonly kind: "ddd.versioned";
  readonly __options?: TOptions;
}

type AggregateRuntimeClass<TSchema extends ATS.AnyTypeSchema, TInstance> = FactoryRuntimeClass<
  TSchema,
  TInstance,
  InitialRuntimeTypeTraits<TSchema>,
  true
>;
interface ClassWithCapability extends ClassCapability<object> {
  readonly __with: true;
}
interface ClassCloneCapability extends ClassCapability<object> {
  readonly __clone: true;
}

/**
 * Materializes an object schema as a runtime class with a generated,
 * shape-stable constructor. Validation/default resolution is compiled once per
 * class and shared by `create()` and `hydrate()`; no schema is traversed when
 * an instance is constructed.
 */
function classFactory<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): ConstructorRuntimeClass<TSchema> {
  return createRuntimeClass(
    unwrapSchema(schema),
    false,
    false,
    false,
    "constructor"
  ) as ConstructorRuntimeClass<TSchema>;
}

function abstractClass<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): AbstractRuntimeClass<TSchema> {
  return createRuntimeClass(unwrapSchema(schema), true, false, false, "constructor");
}

interface ClassMethodDefinition {
  readonly name: string;
  readonly kind: "method" | "get" | "set";
  readonly source: Function;
  readonly schema?: ATS.FunctionSchema;
  readonly async?: boolean;
}

interface ClassFieldPolicy {
  readonly visibility: ClassMemberVisibility;
  readonly getter: true | false | Function;
  readonly setter: true | false | Function;
  readonly noConstructor: boolean;
}

/**
 * The physical class layout after member descriptors and capabilities have
 * been resolved. Emitters consume this plan; they never inspect the fluent
 * descriptor syntax or resolve members on an instance.
 */
interface ClassLayoutPlan {
  readonly properties: readonly string[];
  readonly accessors: ResolvedAccessors | undefined;
  readonly managedStorage: ReadonlyMap<string, ManagedStorageBinding>;
  readonly fieldPolicies: ReadonlyMap<string, ClassFieldPolicy>;
  readonly encapsulateFields: boolean;
  readonly initializers: ReadonlyMap<string, () => unknown>;
}

interface ClassDefinitionState {
  readonly declaredSchema: ATS.AnyTypeSchema;
  readonly schema: ATS.AnyTypeSchema;
  readonly isAbstract: boolean;
  readonly freezeInstances: boolean;
  readonly aggregate: boolean;
  readonly construction: ConstructionMode;
  readonly constructionConfigured: boolean;
  readonly factoriesConfigured: boolean;
  readonly factoryNames: { readonly create: string | false; readonly hydrate: string | false };
  readonly customFactories: {
    readonly create?: Function;
    readonly hydrate?: Function;
  };
  readonly accessors: ResolvedAccessors | undefined;
  readonly fieldPolicies: ReadonlyMap<string, ClassFieldPolicy>;
  readonly encapsulateFields: boolean;
  readonly mutationGate: WeakSet<object>;
  readonly capabilities: readonly AnyClassCapability[];
  readonly methods: readonly ClassMethodDefinition[];
  readonly lifecycle: LifecycleDefinition;
  readonly managedFields: readonly ManagedFieldDescriptor[];
  readonly members: ResolvedMemberTable;
  readonly policy: FactoryPolicyState;
  readonly identity: IdentityState;
}

export type IdentityState =
  | { readonly state: "none" }
  | { readonly state: "resolved"; readonly key: string; readonly explicit: boolean }
  | { readonly state: "pending" }
  | { readonly state: "ambiguous"; readonly candidates: readonly string[] };

interface ManagedStorageBinding {
  readonly name: string;
  readonly value: symbol;
}

interface ClassStateSeed {
  readonly declaredSchema?: ATS.AnyTypeSchema;
  readonly capabilities?: readonly AnyClassCapability[];
  readonly methods?: readonly ClassMethodDefinition[];
  readonly lifecycle?: LifecycleDefinition;
  readonly managedFields?: readonly ManagedFieldDescriptor[];
  readonly members?: ResolvedMemberTable;
  readonly policy?: FactoryPolicyState;
  readonly fieldPolicies?: ReadonlyMap<string, ClassFieldPolicy>;
  readonly encapsulateFields?: boolean;
  readonly mutationGate?: WeakSet<object>;
  readonly factoryNames?: { readonly create: string | false; readonly hydrate: string | false };
  readonly customFactories?: { readonly create?: Function; readonly hydrate?: Function };
  readonly constructionConfigured?: boolean;
  readonly factoriesConfigured?: boolean;
  readonly identity?: IdentityState;
}

/** Resolves nested policy candidates once while declaring the outer class. */
function resolveNestedResultPolicy(schema: ATS.AnyTypeSchema): FactoryPolicyCandidate | undefined {
  const candidates: FactoryPolicyCandidate[] = [];
  const active = new Set<ATS.AnyTypeSchema>();
  const visit = (current: ATS.AnyTypeSchema, depth: number): void => {
    if (active.has(current)) return;
    active.add(current);
    if (current.type === TypeName.runtimeType) {
      const runtime = current as ATS.RuntimeTypeSchema;
      const traits = runtime.def.traits.factoryPolicy;
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
    if (current.type === TypeName.object) {
      for (const child of Object.values((current as ATS.ObjectSchema).def.props)) visit(child, depth + 1);
    } else {
      for (const child of schemaChildren(current)) visit(child, depth + 1);
    }
    active.delete(current);
  };
  visit(schema, 0);
  return selectFactoryPolicyCandidate(candidates);
}

/**
 * Materializes one complete class definition. Structural resolution has
 * already happened before this function, so every compiler sees the final
 * EffectiveSchema and no later extension can leave a stale constructor.
 */
function createRuntimeClass<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  isAbstract: boolean,
  freezeInstances: boolean,
  aggregate: boolean,
  construction: ConstructionMode,
  encapsulateFields = false,
  accessors?: ResolvedAccessors,
  seed?: ClassStateSeed
): RuntimeClass<TSchema> {
  const baseState = initialEffectiveSchema(schema);
  const members = seed?.members?.clone() ?? baseState.members;
  if (aggregate && !members.has("update")) addMember(members, "update", "preset", "ddd.aggregateRoot", "method");
  if (aggregate) {
    addMember(members, "raise", "preset", "ddd.aggregateRoot", "method");
    addMember(members, "peekEvents", "preset", "ddd.aggregateRoot", "method");
    addMember(members, "pullEvents", "preset", "ddd.aggregateRoot", "method");
    addMember(members, "commit", "preset", "ddd.aggregateRoot", "method");
  }
  const state: ClassDefinitionState = {
    declaredSchema: seed?.declaredSchema ?? schema,
    schema: schema,
    isAbstract,
    freezeInstances,
    aggregate,
    construction,
    constructionConfigured: seed?.constructionConfigured ?? false,
    // Factory-first presets still allow one explicit `.construction(...)` or
    // `.factories(...)` decision; the default mode is not itself a lock.
    factoriesConfigured: seed?.factoriesConfigured ?? false,
    factoryNames:
      seed?.factoryNames ??
      (construction === "factory" ? { create: "create", hydrate: "hydrate" } : { create: false, hydrate: false }),
    customFactories: seed?.customFactories ?? {},
    accessors,
    capabilities: Object.freeze([...(seed?.capabilities ?? [])]),
    methods: Object.freeze([...(seed?.methods ?? [])]),
    lifecycle: seed?.lifecycle ?? baseState.lifecycle,
    managedFields: Object.freeze([...(seed?.managedFields ?? baseState.managedFields)]),
    members,
    fieldPolicies: new Map(seed?.fieldPolicies ?? []),
    encapsulateFields: seed?.encapsulateFields ?? encapsulateFields,
    mutationGate: seed?.mutationGate ?? new WeakSet<object>(),
    policy: seed?.policy ?? createPolicyState(),
    identity: seed?.identity ?? { state: "none" },
  };
  const policy = state.policy;
  policy.nestedErrors = collectNestedErrorCandidates(state.schema);
  if (!policy.validationConfigured) {
    const nestedPolicy = resolveNestedResultPolicy(state.schema);
    if (nestedPolicy === undefined) {
      if (policy.inheritedResultMode) {
        policy.configured = false;
        policy.mode = "throw";
        policy.inheritedResultMode = false;
        policy.resultModeExplicit = false;
      }
    } else {
      policy.configured = true;
      policy.mode = nestedPolicy.mode;
      policy.modePriority = nestedPolicy.priority;
      policy.inheritedResultMode = true;
      policy.resultModeExplicit = false;
    }
  }

  const objectSchema = resolveEffectiveObjectSchema(state.schema);
  const properties = Object.keys(objectSchema.def.props);
  const creationSchema = removeNoConstructorFields(state.schema, state.fieldPolicies);
  const noConstructorFields = [...state.fieldPolicies.entries()]
    .filter(([, policy]) => policy.noConstructor)
    .map(([field]) => field);
  const boundaryInput = (input: unknown): unknown => {
    if (noConstructorFields.length === 0 || input === null || typeof input !== "object") return input;
    if (!noConstructorFields.some((field) => Object_hasOwn(input, field))) return input;
    const copy = { ...(input as Record<string, unknown>) };
    for (const field of noConstructorFields) delete copy[field];
    return copy;
  };
  const hydrateSchema = removeNoConstructorFields(state.schema, state.fieldPolicies);
  let parseCreation: ((input: unknown) => unknown) | undefined;
  const parse = (input: unknown): unknown => {
    parseCreation ??= compileValidator(creationSchema).parse;
    return parseCreation(boundaryInput(input));
  };
  let hydrateState: ((input: unknown) => unknown) | undefined;
  const hydrateInput = (input: unknown): unknown => {
    hydrateState ??= compileHydrator(hydrateSchema);
    return hydrateState(boundaryInput(input));
  };
  const initializers = compileNoConstructorInitializers(state.schema, state.fieldPolicies);
  let safeParse: ((input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>) | undefined;
  let safeHydrate: ((input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>) | undefined;
  const policySafeParse = () => {
    safeParse ??= compileValidatorSelection(creationSchema, ["safeParse"], {
      ...(policy.maxIssues === undefined ? {} : { maxIssues: policy.maxIssues }),
    }).safeParse as (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
    return safeParse;
  };
  const policySafeHydrate = () => {
    safeHydrate ??= compileSafeHydrator(hydrateSchema, {
      ...(policy.maxIssues === undefined ? {} : { maxIssues: policy.maxIssues }),
    }) as (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
    return safeHydrate;
  };

  const constructionState = { mode: state.construction };
  const managedStorage = resolveManagedStorage(
    properties,
    state.accessors,
    state.managedFields,
    state.encapsulateFields,
    state.fieldPolicies
  );
  const layout = createClassLayoutPlan(
    properties,
    state.accessors,
    managedStorage,
    state.fieldPolicies,
    state.encapsulateFields,
    initializers
  );
  const mutationGate = state.encapsulateFields ? state.mutationGate : undefined;
  const classTarget = emitConstructor(
    layout,
    state.freezeInstances,
    state.aggregate,
    parse,
    constructionState,
    mutationGate
  ) as RuntimeClass<TSchema>;
  installTrustedMaterializer(classTarget, layout, state.freezeInstances, state.aggregate);
  parseCreation = compileValidator(creationSchema).parse;
  hydrateState = compileHydrator(hydrateSchema);

  for (const capabilityValue of state.capabilities) {
    if (capabilityValue.kind === "class.json") {
      const method = capabilityMemberNames(capabilityValue)[0] ?? "toJson";
      const jsonFields = Object.keys(resolveEffectiveObjectSchema(hydrateSchema).def.props);
      const rootPropertyAccess = new Map<string, string>();
      const bindings: symbol[] = [];
      for (const field of jsonFields) {
        const managed = managedStorage.get(field);
        if (managed === undefined) rootPropertyAccess.set(field, `value[${JSON.stringify(field)}]`);
        else {
          const index = bindings.length;
          bindings.push(managed.value);
          rootPropertyAccess.set(field, `value[__root${index}]`);
        }
      }
      const stringify = compileSerializeWithRootAccess(hydrateSchema, rootPropertyAccess, bindings);
      definePrototype(
        classTarget.prototype,
        method,
        function toJson(this: unknown) {
          return stringify(this as never);
        },
        true
      );
    } else {
      capabilityValue.install(classTarget, state.schema);
    }
  }
  installLifecycleMethods(classTarget, state, managedStorage);
  installFieldDescriptorAccessors(classTarget, state.fieldPolicies);
  for (const method of state.methods) installMethodDefinition(classTarget, method, mutationGate);

  function registerClass(): void {
    const mutation = lifecycleArtifact(state.lifecycle);
    registerArtifact(classTarget, {
      kind: "class",
      declaredSchema: state.declaredSchema,
      schema: state.schema,
      creationSchema,
      wireSchema: hydrateSchema,
      abstract: state.isAbstract,
      frozen: state.freezeInstances,
      aggregate: state.aggregate,
      construction: state.construction,
      representation: "object",
      capabilities: state.capabilities.map((capability) => capability.kind),
      managedFields: state.managedFields,
      hydrateSchema,
      encapsulateFields: state.encapsulateFields,
      ...(state.fieldPolicies.size === 0
        ? {}
        : {
            fieldPolicies: [...state.fieldPolicies.entries()].map(([name, policy]) => ({
              name,
              visibility: policy.visibility,
              getter: policy.getter !== false,
              setter: policy.setter !== false,
              noConstructor: policy.noConstructor,
            })),
          }),
      lifecycle: state.lifecycle,
      resolvedMembers: state.members.entries(),
      ...(mutation === undefined ? {} : { mutation }),
      ...policyArtifact(policy),
      ...(state.methods.length === 0 ? {} : { methods: state.methods }),
      factories: state.factoryNames,
      ...(state.customFactories.create === undefined && state.customFactories.hydrate === undefined
        ? {}
        : { customFactories: state.customFactories }),
      accessors: state.accessors,
    });
  }

  function create<TThis extends RuntimeClass<TSchema>>(this: TThis, input: Input<TSchema>): InstanceType<TThis> {
    if (state.isAbstract && this === classTarget) {
      throw new JITError("INVALID_OPERATION", "Cannot create an instance of an abstract JIT class");
    }
    if (state.identity.state === "pending") {
      throw new JITError("DDD_IDENTITY_MISSING", "Entity identity is pending a structural identifier extension");
    }
    if (state.identity.state === "ambiguous") {
      throw new JITError("DDD_IDENTITY_AMBIGUOUS", "Entity identity has multiple structural identifier candidates");
    }
    const construct = this as unknown as new (
      input: unknown,
      token: symbol,
      validated?: boolean
    ) => InstanceType<TThis>;
    const customFactory = state.customFactories.create;
    if (customFactory !== undefined) {
      const parsed =
        policy.configured && policy.create
          ? policySafeParse()(boundaryInput(input))
          : { success: true as const, data: parse(input) };
      if (!parsed.success) return policyFailure(policy, policyError(policy, parsed.issues)) as InstanceType<TThis>;
      if (policy.assert !== undefined) {
        const failure = policy.assert(parsed.data);
        if (failure !== undefined) return policyFailure(policy, failure) as InstanceType<TThis>;
      }
      const result = customFactory.call(this, parsed.data, {
        construct: (value: unknown) => new construct(value, INTERNAL_CONSTRUCT, true),
      } satisfies FactoryConstructionContext<InstanceType<TThis>>);
      let instance: InstanceType<TThis>;
      if (result instanceof this) {
        instance = result as InstanceType<TThis>;
      } else {
        if (result === null || typeof result !== "object") {
          const error = new JITError(
            "CLASS_FACTORY_RESULT_INVALID",
            "A custom object factory must return state or an instance"
          );
          if (policy.configured) return policyFailure(policy, error) as InstanceType<TThis>;
          throw error;
        }
        instance = new construct(result, INTERNAL_CONSTRUCT, true);
      }
      return policy.configured
        ? (policySuccess(policy, instance) as InstanceType<TThis>)
        : (instance as InstanceType<TThis>);
    }
    if (!policy.configured || !policy.create) {
      if (
        state.lifecycle.timestamps === undefined &&
        state.lifecycle.softDelete === undefined &&
        state.lifecycle.versioned === undefined
      ) {
        return new construct(input, INTERNAL_CONSTRUCT);
      }
      return new construct(parse(input), INTERNAL_CONSTRUCT, true);
    }
    if (policy.maxIssues === undefined && policy.assert === undefined) {
      try {
        return policySuccess(policy, new construct(parse(input), INTERNAL_CONSTRUCT, true)) as InstanceType<TThis>;
      } catch (error) {
        if (!(error instanceof JITValidationError)) throw error;
        return policyFailure(policy, policyError(policy, error.issues)) as InstanceType<TThis>;
      }
    }
    const parsed = policySafeParse()(boundaryInput(input));
    if (!parsed.success) return policyFailure(policy, policyError(policy, parsed.issues)) as InstanceType<TThis>;
    if (policy.assert !== undefined) {
      const failure = policy.assert(parsed.data);
      if (failure !== undefined) return policyFailure(policy, failure) as InstanceType<TThis>;
    }
    return policySuccess(policy, new construct(parsed.data, INTERNAL_CONSTRUCT, true)) as InstanceType<TThis>;
  }

  function hydrate<TThis extends RuntimeClass<TSchema>>(this: TThis, input: Hydrate<TSchema>): InstanceType<TThis> {
    if (state.isAbstract && this === classTarget) {
      throw new JITError("INVALID_OPERATION", "Cannot hydrate an instance of an abstract JIT class");
    }
    if (state.identity.state === "pending") {
      throw new JITError("DDD_IDENTITY_MISSING", "Entity identity is pending a structural identifier extension");
    }
    if (state.identity.state === "ambiguous") {
      throw new JITError("DDD_IDENTITY_AMBIGUOUS", "Entity identity has multiple structural identifier candidates");
    }
    const construct = this as unknown as new (
      value: unknown,
      token: symbol,
      validated?: boolean
    ) => InstanceType<TThis>;
    const customFactory = state.customFactories.hydrate;
    if (customFactory !== undefined) {
      const parsed =
        policy.configured && policy.hydrate
          ? policySafeHydrate()(boundaryInput(input))
          : { success: true as const, data: hydrateInput(input) };
      if (!parsed.success) return policyFailure(policy, policyError(policy, parsed.issues)) as InstanceType<TThis>;
      if (policy.assert !== undefined) {
        const failure = policy.assert(parsed.data);
        if (failure !== undefined) return policyFailure(policy, failure) as InstanceType<TThis>;
      }
      const result = customFactory.call(this, parsed.data, {
        construct: (value: unknown) => new construct(value, INTERNAL_CONSTRUCT, true),
      } satisfies FactoryConstructionContext<InstanceType<TThis>>);
      let instance: InstanceType<TThis>;
      if (result instanceof this) {
        instance = result as InstanceType<TThis>;
      } else {
        if (result === null || typeof result !== "object") {
          const error = new JITError(
            "CLASS_FACTORY_RESULT_INVALID",
            "A custom object factory must return state or an instance"
          );
          if (policy.configured) return policyFailure(policy, error) as InstanceType<TThis>;
          throw error;
        }
        instance = new construct(result, INTERNAL_CONSTRUCT, true);
      }
      return policy.configured
        ? (policySuccess(policy, instance) as InstanceType<TThis>)
        : (instance as InstanceType<TThis>);
    }
    if (!policy.configured || !policy.hydrate) {
      return new construct(hydrateInput(input), INTERNAL_CONSTRUCT, true);
    }
    if (policy.maxIssues === undefined && policy.assert === undefined) {
      try {
        return policySuccess(
          policy,
          new construct(hydrateInput(input), INTERNAL_CONSTRUCT, true)
        ) as InstanceType<TThis>;
      } catch (error) {
        if (!(error instanceof JITValidationError)) throw error;
        return policyFailure(policy, policyError(policy, error.issues)) as InstanceType<TThis>;
      }
    }
    const parsed = policySafeHydrate()(boundaryInput(input));
    if (!parsed.success) return policyFailure(policy, policyError(policy, parsed.issues)) as InstanceType<TThis>;
    if (policy.assert !== undefined) {
      const failure = policy.assert(parsed.data);
      if (failure !== undefined) return policyFailure(policy, failure) as InstanceType<TThis>;
    }
    return policySuccess(policy, new construct(parsed.data, INTERNAL_CONSTRUCT, true)) as InstanceType<TThis>;
  }

  Object.defineProperties(classTarget, {
    [CLASS_TARGET]: { enumerable: false, value: true },
    schema: {
      enumerable: true,
      value: createSchema(TypeName.runtimeType, {
        innerType: state.schema,
        materialize: classTarget,
        representation: "object",
        identifier: false,
        traits: runtimeTypeTraits("object", false, policy),
        assertion: policy.assertionGuard,
      }) as unknown as ATS.RuntimeTypeSchema<
        TSchema,
        ATS.TypeofSchema<TSchema>,
        "object",
        false,
        ATS.RuntimeTypeTraits<"object", false>
      >,
    },
    extends: {
      enumerable: false,
      value: (...extensions: readonly (AnyClassCapability | ClassMethodsInput | ClassMixin)[]) =>
        materializeClassState(resolveClassExtensions(state, extensions)),
    },
    validate: {
      enumerable: false,
      value: (options?: FactoryValidationOptions) => {
        applyValidationPolicy(state.policy, options);
        return materializeClassState(state);
      },
    },
    assert: {
      enumerable: false,
      value: (predicate: (query: QueryConditionBuilder<never>) => QueryConditionNode, options?: AssertionOptions) => {
        applyAssertion(state.policy, state.schema, predicate, options);
        return materializeClassState(state);
      },
    },
    factories: {
      enumerable: false,
      value: (options: FactoryOptions) => {
        if (state.factoriesConfigured) {
          throw new JITError("INVALID_OPERATION", "Factories are already configured for this Runtime Class");
        }
        if (state.constructionConfigured) {
          throw new JITError("INVALID_OPERATION", "Construction is already configured for this Runtime Class");
        }
        const createOption = resolveFactoryOption(options.create, state.factoryNames.create, "create");
        const hydrateOption = resolveFactoryOption(options.hydrate, state.factoryNames.hydrate, "hydrate");
        const next = {
          create: createOption.name,
          hydrate: hydrateOption.name,
        };
        if (next.create === false && next.hydrate === false) {
          throw new JITError(
            "INVALID_OPERATION",
            "Factory construction requires at least one create or hydrate factory"
          );
        }
        return materializeClassState({
          ...state,
          construction: "factory",
          factoriesConfigured: true,
          factoryNames: next,
          customFactories: {
            ...(state.customFactories.create === undefined && createOption.implementation === undefined
              ? {}
              : { create: createOption.implementation ?? state.customFactories.create }),
            ...(state.customFactories.hydrate === undefined && hydrateOption.implementation === undefined
              ? {}
              : { hydrate: hydrateOption.implementation ?? state.customFactories.hydrate }),
          },
        });
      },
    },
    construction: {
      enumerable: false,
      value: (mode: ConstructionMode) => {
        if (state.constructionConfigured) {
          throw new JITError("INVALID_OPERATION", "Construction is already configured for this Runtime Class");
        }
        if (state.factoriesConfigured) {
          throw new JITError("INVALID_OPERATION", "Factories already fixed the construction boundary");
        }
        if (mode !== "constructor" && mode !== "factory") {
          throw new JITError("INVALID_OPERATION", "Construction mode must be constructor or factory");
        }
        if (state.isAbstract && mode === "constructor") {
          throw new JITError("INVALID_OPERATION", "An abstract Runtime Class cannot use constructor construction");
        }
        if (state.policy.configured) {
          throw new JITError("INVALID_OPERATION", "Construction must be configured before validation or assertions");
        }
        return materializeClassState({
          ...state,
          construction: mode,
          constructionConfigured: true,
          factoryNames:
            mode === "factory" ? { create: "create", hydrate: "hydrate" } : { create: false, hydrate: false },
        });
      },
    },
    accessors: {
      enumerable: false,
      value: (options: AccessorOptions<TSchema>) => {
        if (state.accessors !== undefined) {
          throw new JITError("INVALID_OPERATION", "Accessors are already configured for this Runtime Class");
        }
        return materializeClassState({
          ...state,
          accessors: resolveAccessors(properties, options),
        });
      },
    },
    identity: {
      enumerable: false,
      value: (key: Extract<keyof ATS.TypeofSchema<TSchema>, string>) => {
        if (state.capabilities.some((capability) => capability.kind.startsWith("identity:"))) {
          throw new JITError("INVALID_OPERATION", "Identity is already configured for this Runtime Class");
        }
        return materializeClassState(resolveClassExtensions(state, [classType.identity(key)]));
      },
    },
  });
  installFactory(classTarget, false, state.factoryNames.create, create);
  installFactory(classTarget, false, state.factoryNames.hydrate, hydrate);
  registerClass();
  return classTarget;
}

function materializeClassState(state: ClassDefinitionState): RuntimeClass<ATS.AnyTypeSchema> {
  return createRuntimeClass(
    state.schema,
    state.isAbstract,
    state.freezeInstances,
    state.aggregate,
    state.construction,
    state.encapsulateFields,
    state.accessors,
    state
  );
}

function resolveClassExtensions(
  current: ClassDefinitionState,
  extensions: readonly (AnyClassCapability | ClassMethodsInput | ClassMixin)[]
): ClassDefinitionState {
  let next: ClassDefinitionState = {
    ...current,
    capabilities: [...current.capabilities],
    methods: [...current.methods],
    managedFields: [...current.managedFields],
    members: current.members.clone(),
    fieldPolicies: new Map(current.fieldPolicies),
  };

  for (const rawExtension of extensions) {
    const mixin = isClassMixin(rawExtension) ? rawExtension : undefined;
    if (mixin !== undefined) validateMixinRequirements(next.schema, mixin.__requires);
    const extension = mixin === undefined ? rawExtension : mixin();
    if (isClassCapability(extension)) {
      if (next.capabilities.some((capability) => capability.kind === extension.kind)) {
        throw new JITError(
          "INVALID_OPERATION",
          `Class capability ${JSON.stringify(extension.kind)} is already installed`
        );
      }
      for (const name of capabilityMemberNames(extension)) assertNewMember(next.members, name, extension.kind);
      if (
        extension.kind === "ddd.timestamps" ||
        extension.kind === "ddd.softDelete" ||
        extension.kind === "ddd.versioned"
      ) {
        try {
          const resolved = applyDddCapability(
            {
              schema: next.schema,
              lifecycle: next.lifecycle,
              managedFields: next.managedFields,
              members: next.members,
            },
            extension.kind,
            capabilityOptions(extension)
          );
          next = {
            ...next,
            schema: resolved.schema,
            lifecycle: resolved.lifecycle,
            managedFields: resolved.managedFields,
            members: resolved.members,
            capabilities: [...next.capabilities, extension],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new JITError("DDD_CAPABILITY_SCHEMA_CONFLICT", `${extension.kind} declaration conflict: ${message}`);
        }
      } else {
        const names = capabilityMemberNames(extension);
        for (const name of names) assertNewMember(next.members, name, extension.kind);
        const members = next.members.clone();
        for (const name of names) addMember(members, name, "capability", extension.kind, "method");
        next = {
          ...next,
          members,
          capabilities: [...next.capabilities, extension],
          ...(extension.kind.startsWith("identity:")
            ? {
                identity: {
                  state: "resolved" as const,
                  key: extension.kind.slice("identity:".length),
                  explicit: true,
                },
              }
            : {}),
        };
      }
      continue;
    }

    const members = next.members.clone();
    const methods = [...next.methods];
    const fieldPolicies = new Map(next.fieldPolicies);
    let schema = next.schema;
    for (const name of Object.getOwnPropertyNames(extension)) {
      const descriptor = Object.getOwnPropertyDescriptor(extension, name);
      if (descriptor === undefined) continue;
      const value = descriptor.value;
      if (isOverrideDescriptor(value)) {
        const existing = members.get(name);
        if (existing === undefined) {
          throw new JITError(
            "CLASS_OVERRIDE_TARGET_NOT_FOUND",
            `Class member ${JSON.stringify(name)} does not exist. JIT.class.override() can only replace an existing member.`
          );
        }
        if (isClassMemberDescriptor(value.value)) {
          const definition = value.value.definition;
          if (definition.kind === "method") {
            if (existing.kind === "field") {
              throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is a schema field`);
            }
            replaceMethod(methods, name, methodDefinitionFromContract(name, definition));
            members.replace(name, {
              ...existing,
              source: "override",
              descriptor: { value: definition.implementation },
            });
          } else {
            if (definition.kind === "factory") {
              throw new JITError("CLASS_FACTORY_CONFLICT", "Factory descriptors cannot override instance members");
            }
            if (existing.kind !== "field") {
              throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is not a schema field`);
            }
            if (definition.kind === "field" && definition.schema !== undefined) {
              schema = replaceSchemaField(schema, name, unwrapSchema(definition.schema));
              schema = reapplyManagedAfterOverride(schema, next.managedFields);
              members.replace(name, {
                ...existing,
                source: "override",
                schema: resolveEffectiveObjectSchema(schema).def.props[name],
              });
            }
            applyFieldPolicy(fieldPolicies, name, definition);
          }
          continue;
        }
        if (isSchemaInputValue(value.value)) {
          if (existing.kind !== "field") {
            throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is not a schema field`);
          }
          schema = replaceSchemaField(schema, name, unwrapSchema(value.value as SchemaInput<ATS.AnyTypeSchema>));
          schema = reapplyManagedAfterOverride(schema, next.managedFields);
          const effectiveField = resolveEffectiveObjectSchema(schema).def.props[name];
          members.replace(name, {
            ...existing,
            source: "override",
            schema: effectiveField,
          });
        } else {
          if (existing.kind === "field") {
            throw new JITError(
              "CLASS_MEMBER_ALREADY_EXISTS",
              `Member ${JSON.stringify(name)} is a schema field; use a schema value with JIT.class.override(...)`
            );
          }
          const replacement = methodDefinitionFromValue(name, value.value);
          replaceMethod(methods, name, replacement);
          members.replace(name, { ...existing, source: "override", descriptor: { value: replacement.source } });
        }
        continue;
      }

      if (members.has(name) || RESERVED_EXTENSION_NAMES.has(name)) {
        throw new JITError(
          "CLASS_MEMBER_ALREADY_EXISTS",
          `Class member ${JSON.stringify(name)} would shadow an existing member. Use ${JSON.stringify(`${name}: JIT.class.override(...)`)} to replace it explicitly.`
        );
      }
      if (isClassMemberDescriptor(value)) {
        const definition = value.definition;
        if (definition.kind === "method") {
          if (definition.implementation === undefined) {
            throw new JITError("INVALID_OPERATION", `Class method ${JSON.stringify(name)} must be implemented`);
          }
          const method = methodDefinitionFromContract(name, definition);
          methods.push(method);
          addMember(members, name, "extension", "custom extension", "method");
          continue;
        }
        if (definition.kind === "factory") {
          throw new JITError(
            "INVALID_OPERATION",
            "Factory descriptors belong in .factories(), not an instance extension"
          );
        }
        const fieldSchema = definition.schema;
        if (fieldSchema !== undefined) {
          const field = unwrapSchema(fieldSchema);
          if (definition.kind === "field" && definition.noConstructor && !hasDefault(field)) {
            throw new JITError(
              "CLASS_FIELD_DESCRIPTOR_CONFLICT",
              `No-constructor field ${JSON.stringify(name)} requires a default initializer`
            );
          }
          schema = addSchemaField(schema, name, field);
          members.add({ name, kind: "field", source: "extension", owner: "custom extension", schema: field });
        } else {
          const hasCustomAccessor =
            definition.kind === "accessor" &&
            (typeof definition.getter === "function" || typeof definition.setter === "function");
          if (!hasCustomAccessor) {
            throw new JITError(
              "CLASS_FIELD_DESCRIPTOR_CONFLICT",
              `Class member ${JSON.stringify(name)} needs a schema or a custom getter/setter`
            );
          }
          const methodDefinitions = descriptorMethods(name, definition);
          methods.push(...methodDefinitions);
          addMember(
            members,
            name,
            "extension",
            "custom extension",
            methodDefinitions[0]?.kind === "get" ? "getter" : "setter"
          );
        }
        applyFieldPolicy(fieldPolicies, name, definition);
        continue;
      }
      if (isSchemaInputValue(value)) {
        const field = unwrapSchema(value);
        schema = addSchemaField(schema, name, field);
        members.add({ name, kind: "field", source: "extension", owner: "custom extension", schema: field });
        continue;
      }
      const method = methodDefinitionFromDescriptor(name, descriptor);
      methods.push(method);
      addMember(
        members,
        name,
        "extension",
        "custom extension",
        method.kind === "get" ? "getter" : method.kind === "set" ? "setter" : "method"
      );
    }
    validateManagedFields(schema, next.managedFields);
    next = { ...next, schema, methods, members, fieldPolicies };
  }
  if (next.identity.state === "pending") {
    const object = resolveEffectiveObjectSchema(next.schema);
    const candidates = Object.keys(object.def.props).filter((key) => isIdentifierSchema(object.def.props[key]));
    if (candidates.length === 1) {
      const key = candidates[0];
      const identity = classType.identity(key);
      const members = next.members.clone();
      for (const name of capabilityMemberNames(identity))
        addMember(members, name, "capability", identity.kind, "method");
      next = {
        ...next,
        members,
        capabilities: [...next.capabilities, identity],
        identity: { state: "resolved", key, explicit: false },
      };
    } else if (candidates.length > 1) {
      next = { ...next, identity: { state: "ambiguous", candidates: Object.freeze(candidates) } };
    }
  }
  validateManagedFields(next.schema, next.managedFields);
  return next;
}

function validateMixinRequirements(schema: ATS.AnyTypeSchema, requirements: ClassMethodsInput | undefined): void {
  if (requirements === undefined) return;
  const object = resolveEffectiveObjectSchema(schema);
  for (const name of Object.getOwnPropertyNames(requirements)) {
    const required = requirements[name];
    const actual = object.def.props[name];
    if (actual === undefined) {
      throw new JITError(
        "CLASS_FIELD_DESCRIPTOR_CONFLICT",
        `Class mixin requires the host field ${JSON.stringify(name)}`
      );
    }
    if (!isSchemaInputValue(required)) {
      throw new JITError(
        "CLASS_FIELD_DESCRIPTOR_CONFLICT",
        `Mixin requirement ${JSON.stringify(name)} must be a schema`
      );
    }
    const expectedBase = resolveWrappers(unwrapSchema(required)).base;
    const actualBase = resolveWrappers(actual).base;
    if (expectedBase.type !== actualBase.type) {
      throw new JITError(
        "CLASS_FIELD_DESCRIPTOR_CONFLICT",
        `Class mixin requirement ${JSON.stringify(name)} is incompatible with the host field`
      );
    }
  }
}

function capabilityOptions(capability: AnyClassCapability): CapabilityOptions | undefined {
  return (capability as AnyClassCapability & { readonly __options?: CapabilityOptions }).__options;
}

function capabilityMemberNames(capability: AnyClassCapability): readonly string[] {
  return (capability as AnyClassCapability & { readonly __memberNames?: readonly string[] }).__memberNames ?? [];
}

function assertNewMember(members: ResolvedMemberTable, name: string, owner: string): void {
  const existing = members.get(name);
  if (existing !== undefined) {
    if (existing.kind === "field") {
      throw new JITError(
        "CLASS_MEMBER_ALREADY_EXISTS",
        `Member ${JSON.stringify(name)} is a schema field and cannot be installed by ${owner}`
      );
    }
    throw new JITError(
      "CLASS_MEMBER_ALREADY_EXISTS",
      `Member ${JSON.stringify(name)} already exists. Existing source conflicts with ${owner}; use JIT.class.override(...) explicitly.`
    );
  }
}

function isSchemaInputValue(value: unknown): value is SchemaInput<ATS.AnyTypeSchema> {
  return (
    ((typeof value === "object" || typeof value === "function") &&
      value !== null &&
      "schema" in value &&
      typeof value.schema === "object") ||
    (typeof value === "object" && value !== null && "type" in value && "def" in value)
  );
}

function replaceSchemaField(
  schema: ATS.AnyTypeSchema,
  name: string,
  replacement: ATS.AnyTypeSchema
): ATS.AnyTypeSchema {
  const object = resolveEffectiveObjectSchema(schema);
  const props = { ...object.def.props, [name]: replacement };
  return createSchema(
    TypeName.object,
    {
      props,
      unknownKeys: object.def.unknownKeys,
      catchall: object.def.catchall,
      checks: object.def.checks,
    },
    object.annotations
  );
}

function addSchemaField(schema: ATS.AnyTypeSchema, name: string, field: ATS.AnyTypeSchema): ATS.AnyTypeSchema {
  const object = resolveEffectiveObjectSchema(schema);
  return createSchema(
    TypeName.object,
    {
      props: { ...object.def.props, [name]: field },
      unknownKeys: object.def.unknownKeys,
      catchall: object.def.catchall,
      checks: object.def.checks,
    },
    object.annotations
  );
}

function reapplyManagedAfterOverride(
  schema: ATS.AnyTypeSchema,
  managedFields: readonly ManagedFieldDescriptor[]
): ATS.AnyTypeSchema {
  try {
    return reapplyManagedFields(schema, managedFields);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new JITError("DDD_CAPABILITY_SCHEMA_CONFLICT", message);
  }
}

function methodDefinitionFromDescriptor(name: string, descriptor: PropertyDescriptor): ClassMethodDefinition {
  if (descriptor.get !== undefined || descriptor.set !== undefined) {
    return {
      name,
      kind: descriptor.get === undefined ? "set" : "get",
      source: (descriptor.get ?? descriptor.set) as Function,
    };
  }
  if (typeof descriptor.value !== "function") {
    throw new JITError(
      "INVALID_OPERATION",
      `Class extension ${JSON.stringify(name)} must be a method, a getter or a setter`
    );
  }
  return { name, kind: "method", source: descriptor.value };
}

function methodDefinitionFromContract(
  name: string,
  definition: Extract<ClassMemberDefinition, { readonly kind: "method" }>
): ClassMethodDefinition {
  if (definition.implementation === undefined) {
    throw new JITError("INVALID_OPERATION", `Class method ${JSON.stringify(name)} must be implemented`);
  }
  return {
    name,
    kind: "method",
    source: definition.implementation,
    schema: definition.schema as ATS.FunctionSchema,
    ...(definition.async === undefined ? {} : { async: definition.async }),
  };
}

function descriptorMethods(
  name: string,
  definition: Extract<ClassMemberDefinition, { readonly kind: "accessor" | "field" }>
): readonly ClassMethodDefinition[] {
  const methods: ClassMethodDefinition[] = [];
  if (typeof definition.getter === "function") methods.push({ name, kind: "get", source: definition.getter });
  if (typeof definition.setter === "function") methods.push({ name, kind: "set", source: definition.setter });
  return methods;
}

function applyFieldPolicy(
  policies: Map<string, ClassFieldPolicy>,
  name: string,
  definition: Extract<ClassMemberDefinition, { readonly kind: "accessor" | "field" }>
): void {
  const previous = policies.get(name);
  const visibility = definition.visibility ?? previous?.visibility ?? "public";
  const hasAccessorIntent = definition.getter !== undefined || definition.setter !== undefined;
  const defaultPublicField =
    definition.kind === "field" &&
    (definition.visibility === "public" || definition.noConstructor === true) &&
    !hasAccessorIntent;
  const internalVisibilityField =
    definition.kind === "field" &&
    (definition.visibility === "protected" || definition.visibility === "private") &&
    !hasAccessorIntent;
  const getter = definition.getter ?? previous?.getter ?? (defaultPublicField || internalVisibilityField);
  const setter = definition.setter ?? previous?.setter ?? (defaultPublicField || internalVisibilityField);
  if (previous !== undefined) {
    if (definition.getter !== undefined && previous.getter !== false) {
      throw new JITError("CLASS_ACCESSOR_CONFLICT", `Field ${JSON.stringify(name)} declares more than one getter`);
    }
    if (definition.setter !== undefined && previous.setter !== false) {
      throw new JITError("CLASS_ACCESSOR_CONFLICT", `Field ${JSON.stringify(name)} declares more than one setter`);
    }
    if (definition.visibility !== undefined && previous.visibility !== definition.visibility) {
      throw new JITError("CLASS_FIELD_DESCRIPTOR_CONFLICT", `Field ${JSON.stringify(name)} has conflicting visibility`);
    }
  }
  policies.set(name, {
    visibility,
    getter,
    setter,
    noConstructor:
      definition.kind === "field" && definition.noConstructor === true ? true : (previous?.noConstructor ?? false),
  });
}

function hasDefault(schema: ATS.AnyTypeSchema): boolean {
  let current = schema;
  while (true) {
    if (current.type === TypeName.default) return true;
    if (current.type === TypeName.lazy) {
      current = (current.def as ATS.LazyDef).getter();
      continue;
    }
    if (
      current.type === TypeName.readonly ||
      current.type === TypeName.optional ||
      current.type === TypeName.nullable ||
      current.type === TypeName.nullish ||
      current.type === TypeName.brand ||
      current.type === TypeName.refine ||
      current.type === TypeName.coerce ||
      current.type === TypeName.pipe ||
      current.type === TypeName.transform
    ) {
      current = (current.def as ATS.InnerTypeDef).innerType;
      continue;
    }
    return false;
  }
}

function methodDefinitionFromValue(name: string, value: unknown): ClassMethodDefinition {
  if (typeof value !== "function") {
    throw new JITError(
      "INVALID_OPERATION",
      `Override ${JSON.stringify(name)} must provide a method function or schema`
    );
  }
  return { name, kind: "method", source: value };
}

function replaceMethod(methods: ClassMethodDefinition[], name: string, replacement: ClassMethodDefinition): void {
  const index = methods.findIndex((method) => method.name === name);
  if (index === -1) methods.push(replacement);
  else methods[index] = replacement;
}

function installMethodDefinition(
  classTarget: Function,
  method: ClassMethodDefinition,
  mutationGate?: WeakSet<object>
): void {
  let source = method.source;
  if (method.schema !== undefined) {
    const args = compileValidator(method.schema.def.args);
    const output = method.schema.def.output === undefined ? undefined : compileValidator(method.schema.def.output);
    if (method.async === true) {
      source = async function validatedAsyncMethod(this: unknown, ...rawArgs: unknown[]) {
        const parsed = args.parse(rawArgs) as readonly unknown[];
        const result = await method.source.apply(this, parsed as never[]);
        return output === undefined ? result : output.parseAsync(result);
      };
    } else {
      source = function validatedMethod(this: unknown, ...rawArgs: unknown[]) {
        const parsed = args.parse(rawArgs) as readonly unknown[];
        const result = method.source.apply(this, parsed as never[]);
        return output === undefined ? result : output.parse(result);
      };
    }
  }
  if (mutationGate !== undefined && method.kind === "method") {
    const body = source;
    source = function domainMethod(this: object, ...args: unknown[]) {
      mutationGate.add(this);
      try {
        return body.apply(this, args);
      } finally {
        mutationGate.delete(this);
      }
    };
  }
  const descriptor: PropertyDescriptor =
    method.kind === "method"
      ? { value: source, writable: false }
      : method.kind === "get"
        ? { get: source as () => unknown }
        : { set: source as (value: unknown) => void };
  Object.defineProperty(classTarget.prototype, method.name, {
    ...descriptor,
    configurable: true,
    enumerable: false,
  });
}

function lifecycleArtifact(lifecycle: LifecycleDefinition):
  | {
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

function installLifecycleMethods(
  classTarget: Function,
  state: ClassDefinitionState,
  managedStorage: ReadonlyMap<string, ManagedStorageBinding>
): void {
  const lifecycle = state.lifecycle;
  const timestamps = lifecycle.timestamps;
  const deletion = lifecycle.softDelete;
  const versioned = lifecycle.versioned;
  const needsMutation =
    state.aggregate || timestamps !== undefined || deletion !== undefined || versioned !== undefined;
  const managedAccess = (field: string): string => {
    const storage = managedStorage.get(field);
    return storage === undefined ? `this[${JSON.stringify(field)}]` : `this[${storage.name}]`;
  };
  const managedWrite = (field: string, value: string): string => {
    const storage = managedStorage.get(field);
    return storage === undefined
      ? `Object.defineProperty(this, ${JSON.stringify(field)}, { value: ${value}, writable: false, enumerable: true, configurable: true });`
      : `${managedAccess(field)} = ${value};`;
  };
  const installLifecycleMethod = (name: string, clock: (() => Date) | undefined, body: string): void => {
    const source = `return function() { ${body} };`;
    const storageEntries = [...managedStorage.values()];
    const storageNames = storageEntries.map((entry) => entry.name);
    const storageValues = storageEntries.map((entry) => entry.value);
    const method = globalThis.Function(
      ...storageNames,
      ...(clock === undefined ? [] : ["__clock"]),
      source
    )(...storageValues, ...(clock === undefined ? [] : [() => checkedClock(clock)])) as Function;
    definePrototype(classTarget.prototype, name, method, true);
  };

  if (needsMutation) {
    const object = resolveEffectiveObjectSchema(state.schema);
    const fields = Object.keys(object.def.props);
    const readonlyFields = fields.filter((field) => resolveWrappers(object.def.props[field]).readonly);
    const mutableFields = fields.filter((field) => !readonlyFields.includes(field));
    const updates = new Map<string, string | null>();
    const names: string[] = [];
    const values: ((value: unknown, patch: unknown) => unknown)[] = [];
    for (const field of mutableFields) {
      if (state.managedFields.some((managed) => managed.field === field)) continue;
      const fieldSchema = object.def.props[field];
      if (isPrimitiveLikeSchema(resolveWrappers(fieldSchema).base)) updates.set(field, null);
      else {
        const name = `__update${names.length}`;
        names.push(name);
        values.push(compileUpdate(fieldSchema) as (value: unknown, patch: unknown) => unknown);
        updates.set(field, name);
      }
    }
    const mutation = buildAggregateMutationPlan({
      fields: mutableFields,
      readonlyFields: [...readonlyFields, ...state.managedFields.map((managed) => managed.field)],
      ...(timestamps?.touch !== "manual" && timestamps !== undefined ? { updatedAt: timestamps.updatedAt } : {}),
      ...(versioned === undefined ? {} : { version: versioned.field }),
      managedFields: state.managedFields.map((managed) => managed.field),
      fieldAccess: new Map(
        [...managedStorage.entries()].map(([field, storage]) => [field, `this[${storage.name}]`] as const)
      ),
    });
    const clock = timestamps?.clock;
    const clockNames = mutation.updatedAt === undefined || clock === undefined ? [] : ["__clock"];
    const clockValues = clockNames.length === 0 ? [] : [() => checkedClock(clock as () => Date)];
    const storageEntries = [...managedStorage.values()];
    const storageNames = storageEntries.map((entry) => entry.name);
    const storageValues = storageEntries.map((entry) => entry.value);
    const update = globalThis.Function(
      ...names,
      ...storageNames,
      ...clockNames,
      `return function update(patch) { ${emitAggregateMutationBody(mutation, updates, clockNames.length === 0 ? "new Date()" : "__clock()")} };`
    )(...values, ...storageValues, ...clockValues) as Function;
    definePrototype(classTarget.prototype, "update", update as Function, true);
  }

  if (timestamps !== undefined) {
    const clock = timestamps.clock;
    const field = timestamps.updatedAt;
    const version = versioned?.field;
    installLifecycleMethod(
      timestamps.touchMethod,
      clock,
      `const now = ${clock === undefined ? "new Date()" : "__clock()"}; ${managedWrite(field, "now")} ${version === undefined ? "" : managedWrite(version, `${managedAccess(version)} + 1`)}`
    );
  }

  if (deletion !== undefined) {
    const timestampField =
      timestamps?.touch === "manual" || timestamps === undefined ? undefined : timestamps.updatedAt;
    const clock = deletion.clock ?? timestamps?.clock;
    installLifecycleMethod(
      deletion.deleteMethod,
      clock,
      `if (${managedAccess(deletion.field)} !== null) return; const now = ${clock === undefined ? "new Date()" : "__clock()"}; ${managedWrite(deletion.field, "now")} ${timestampField === undefined ? "" : managedWrite(timestampField, "now")} ${versioned === undefined ? "" : managedWrite(versioned.field, `${managedAccess(versioned.field)} + 1`)}`
    );
    installLifecycleMethod(
      deletion.restoreMethod,
      timestampField === undefined ? undefined : clock,
      `if (${managedAccess(deletion.field)} === null) return; ${managedWrite(deletion.field, "null")} ${timestampField === undefined ? "" : managedWrite(timestampField, clock === undefined ? "new Date()" : "__clock()")} ${versioned === undefined ? "" : managedWrite(versioned.field, `${managedAccess(versioned.field)} + 1`)}`
    );
    const deletionStorage = managedStorage.get(deletion.field);
    Object.defineProperty(classTarget.prototype, deletion.isDeletedMember, {
      configurable: true,
      enumerable: false,
      get(this: Record<PropertyKey, unknown>) {
        return deletionStorage === undefined ? this[deletion.field] !== null : this[deletionStorage.value] !== null;
      },
    });
  }

  if (state.aggregate) {
    definePrototype(
      classTarget.prototype,
      "raise",
      function raise(this: { __jitEvents: unknown[] }, event: unknown) {
        this.__jitEvents[this.__jitEvents.length] = event;
      },
      true
    );
    definePrototype(
      classTarget.prototype,
      "peekEvents",
      function peekEvents(this: { __jitEvents: unknown[] }) {
        return this.__jitEvents.slice();
      },
      true
    );
    definePrototype(
      classTarget.prototype,
      "pullEvents",
      function pullEvents(this: { __jitEvents: unknown[] }) {
        const events = this.__jitEvents;
        this.__jitEvents = [];
        return events;
      },
      true
    );
    definePrototype(
      classTarget.prototype,
      "commit",
      async function commit(this: { __jitEvents: unknown[] }, publisher: EventPublisher): Promise<void> {
        const pending = this.__jitEvents;
        for (let index = 0; index < pending.length; index++) await publisher.publish(pending[index]);
        this.__jitEvents.splice(0, pending.length);
      },
      true
    );
  }
}

function checkedClock(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new JITError("INVALID_OPERATION", "A DDD clock must return a valid Date");
  }
  return value;
}

function installFactory<TSchema extends ATS.AnyTypeSchema>(
  classTarget: RuntimeClass<TSchema>,
  previous: string | false,
  next: string | false,
  factory: Function
): void {
  if (previous !== false && previous !== next) Reflect.deleteProperty(classTarget, previous);
  if (next === false) return;
  if (
    next === "schema" ||
    next === "use" ||
    next === "extends" ||
    next === "factories" ||
    next === "construction" ||
    next === "accessors" ||
    next === "identity" ||
    next === "validate" ||
    next === "assert"
  ) {
    throw new JITError("INVALID_OPERATION", `Factory name ${JSON.stringify(next)} is reserved`);
  }
  Object.defineProperty(classTarget, next, {
    configurable: true,
    enumerable: false,
    value: factory,
  });
}

function resolveFactoryOption(
  option: string | false | ClassMemberDescriptor<ClassFactoryMemberDescriptor> | undefined,
  previous: string | false,
  phase: "create" | "hydrate"
): { readonly name: string | false; readonly implementation?: Function } {
  if (option === undefined) return { name: previous };
  if (typeof option === "object") {
    if (!isClassMemberDescriptor(option) || option.definition.kind !== "factory") {
      throw new JITError("CLASS_FACTORY_CONFLICT", "Invalid class factory descriptor");
    }
    if (option.definition.phase !== phase) {
      throw new JITError(
        "CLASS_FACTORY_CONFLICT",
        `A ${option.definition.phase} factory descriptor cannot configure ${phase}`
      );
    }
    return { name: option.definition.name, implementation: option.definition.implementation };
  }
  return { name: option };
}

function createScalarValueObject<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  identifier: boolean,
  isAbstract: boolean
): ScalarFactoryRuntimeClass<TSchema, ScalarValueObject<ATS.TypeofSchema<TSchema>>> {
  const parse = compileValidator(schema).parse;
  const hydrateState = compileHydrator(schema);
  const policy = createPolicyState();
  let safeParse: ((input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>) | undefined;
  let safeHydrate: ((state: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>) | undefined;
  const equal = compileEqual(schema) as (left: unknown, right: unknown) => boolean;
  const hash = compileHash(schema) as (value: unknown) => number;
  const constructionState: { mode: ConstructionMode } = { mode: "factory" };
  const source = `return class JITScalarValueObject { constructor(input, token, validated) { if (__construction.mode === "factory" && token !== __construct && token !== true) throw new Error("This Runtime Type uses factory construction; call its create() or hydrate() factory"); this.value = token === true || validated === true ? input : __parse(input); Object.freeze(this); } };`;
  const classTarget = globalThis.Function(
    "__parse",
    "__construct",
    "__construction",
    source
  )(parse, INTERNAL_CONSTRUCT, constructionState) as RuntimeClass<
    TSchema,
    ScalarValueObject<ATS.TypeofSchema<TSchema>>
  >;
  Object.defineProperty(classTarget, TRUSTED_MATERIALIZER, {
    configurable: false,
    enumerable: false,
    value: (value: unknown) => {
      const instance = Object.create(classTarget.prototype) as { value: unknown };
      instance.value = value;
      return Object.freeze(instance);
    },
  });
  const installedCapabilities = ["equals", "hashCode"];
  const installedMethods: {
    readonly name: string;
    readonly kind: "method" | "get" | "set";
    readonly source: Function;
  }[] = [];
  const installedMethodNames = new Set<string>(SCALAR_MEMBERS);
  let factoryNames: { create: string | false; hydrate: string | false } = {
    create: "create",
    hydrate: "hydrate",
  };
  let customFactories: { create?: Function; hydrate?: Function } = {};
  let constructionConfigured = false;
  let factoriesConfigured = false;

  const updateSchema = (): void => {
    Object.defineProperty(classTarget, "schema", {
      configurable: true,
      enumerable: true,
      value: createSchema(TypeName.runtimeType, {
        innerType: schema,
        materialize: classTarget,
        representation: "value",
        identifier,
        traits: runtimeTypeTraits("value", identifier, policy),
        assertion: undefined,
      }),
    });
  };

  function create<TThis extends RuntimeClass<TSchema>>(
    this: TThis,
    ...args: CreateArguments<TSchema>
  ): InstanceType<TThis> {
    if (isAbstract && this === classTarget) {
      throw new JITError("INVALID_OPERATION", "Cannot create an instance of an abstract JIT class");
    }
    const construct = this as unknown as new (
      input: unknown,
      token: symbol,
      validated?: boolean
    ) => InstanceType<TThis>;
    if (customFactories.create !== undefined) {
      const parsed =
        policy.configured && policy.create
          ? (() => {
              safeParse ??= compileValidatorSelection(schema, ["safeParse"], {}).safeParse as (
                input: unknown
              ) => SafeParse<ATS.TypeofSchema<TSchema>>;
              return safeParse(args[0]);
            })()
          : { success: true as const, data: parse(args[0]) };
      if (!parsed.success) return policyFailure(policy, policyError(policy, parsed.issues)) as InstanceType<TThis>;
      const result = customFactories.create.call(this, parsed.data, {
        construct: (value: unknown) => new construct(value, INTERNAL_CONSTRUCT, true),
      });
      let instance: InstanceType<TThis>;
      if (result instanceof this) {
        instance = result as InstanceType<TThis>;
      } else {
        instance = new construct(result, INTERNAL_CONSTRUCT, true);
      }
      return policy.configured
        ? (policySuccess(policy, instance) as InstanceType<TThis>)
        : (instance as InstanceType<TThis>);
    }
    if (!policy.configured || !policy.create) return new construct(args[0], INTERNAL_CONSTRUCT);
    if (policy.maxIssues === undefined) {
      try {
        return policySuccess(policy, new construct(parse(args[0]), INTERNAL_CONSTRUCT, true)) as InstanceType<TThis>;
      } catch (error) {
        if (!(error instanceof JITValidationError)) throw error;
        return policyFailure(policy, policyError(policy, error.issues)) as InstanceType<TThis>;
      }
    }
    safeParse ??= compileValidatorSelection(schema, ["safeParse"], {
      ...(policy.maxIssues === undefined ? {} : { maxIssues: policy.maxIssues }),
    }).safeParse as (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
    const parsed = safeParse(args[0]);
    if (!parsed.success) return policyFailure(policy, policyError(policy, parsed.issues)) as InstanceType<TThis>;
    return policySuccess(policy, new construct(parsed.data, INTERNAL_CONSTRUCT, true)) as InstanceType<TThis>;
  }

  function hydrate<TThis extends RuntimeClass<TSchema>>(this: TThis, state: Hydrate<TSchema>): InstanceType<TThis> {
    if (isAbstract && this === classTarget) {
      throw new JITError("INVALID_OPERATION", "Cannot hydrate an instance of an abstract JIT class");
    }
    const construct = this as unknown as new (
      input: unknown,
      token: symbol,
      validated?: boolean
    ) => InstanceType<TThis>;
    if (customFactories.hydrate !== undefined) {
      const parsed =
        policy.configured && policy.hydrate
          ? (() => {
              safeHydrate ??= compileSafeHydrator(schema) as (state: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
              return safeHydrate(state);
            })()
          : { success: true as const, data: hydrateState(state) };
      if (!parsed.success) return policyFailure(policy, policyError(policy, parsed.issues)) as InstanceType<TThis>;
      const result = customFactories.hydrate.call(this, parsed.data, {
        construct: (value: unknown) => new construct(value, INTERNAL_CONSTRUCT, true),
      });
      let instance: InstanceType<TThis>;
      if (result instanceof this) {
        instance = result as InstanceType<TThis>;
      } else {
        instance = new construct(result, INTERNAL_CONSTRUCT, true);
      }
      return policy.configured
        ? (policySuccess(policy, instance) as InstanceType<TThis>)
        : (instance as InstanceType<TThis>);
    }
    if (!policy.configured || !policy.hydrate) {
      return new construct(hydrateState(state), INTERNAL_CONSTRUCT, true);
    }
    if (policy.maxIssues === undefined) {
      try {
        return policySuccess(
          policy,
          new construct(hydrateState(state), INTERNAL_CONSTRUCT, true)
        ) as InstanceType<TThis>;
      } catch (error) {
        if (!(error instanceof JITValidationError)) throw error;
        return policyFailure(policy, policyError(policy, error.issues)) as InstanceType<TThis>;
      }
    }
    safeHydrate ??= compileSafeHydrator(schema, {
      ...(policy.maxIssues === undefined ? {} : { maxIssues: policy.maxIssues }),
    }) as (state: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
    const parsed = safeHydrate(state);
    if (!parsed.success) return policyFailure(policy, policyError(policy, parsed.issues)) as InstanceType<TThis>;
    return policySuccess(policy, new construct(parsed.data, INTERNAL_CONSTRUCT, true)) as InstanceType<TThis>;
  }

  const register = () => {
    updateSchema();
    registerArtifact(classTarget, {
      kind: "class",
      schema,
      wireSchema: schema,
      abstract: isAbstract,
      frozen: true,
      aggregate: false,
      construction: constructionState.mode,
      representation: "value",
      ...policyArtifact(policy),
      capabilities: installedCapabilities,
      ...(installedMethods.length === 0 ? {} : { methods: installedMethods }),
      factories: factoryNames,
      ...(customFactories.create === undefined && customFactories.hydrate === undefined ? {} : { customFactories }),
    });
  };

  Object.defineProperties(classTarget, {
    [CLASS_TARGET]: { enumerable: false, value: true },
    schema: {
      configurable: true,
      enumerable: true,
      value: createSchema(TypeName.runtimeType, {
        innerType: schema,
        materialize: classTarget,
        representation: "value",
        identifier,
        traits: runtimeTypeTraits("value", identifier, policy),
        assertion: undefined,
      }) as ATS.RuntimeTypeSchema<
        TSchema,
        ScalarValueObject<ATS.TypeofSchema<TSchema>>,
        "value",
        boolean,
        ATS.RuntimeTypeTraits<"value", boolean>
      >,
    },
    create: { configurable: true, enumerable: false, value: create },
    hydrate: { configurable: true, enumerable: false, value: hydrate },
    extends: {
      enumerable: false,
      value: (...extensions: readonly (AnyClassCapability | ClassMethodsInput | ClassMixin)[]) => {
        for (const rawExtension of extensions) {
          const extension = isClassMixin(rawExtension) ? rawExtension() : rawExtension;
          if (isClassCapability(extension)) {
            if (installedCapabilities.includes(extension.kind)) {
              throw new JITError(
                "INVALID_OPERATION",
                `Class capability ${JSON.stringify(extension.kind)} is already installed`
              );
            }
            const before = new Set(Object.getOwnPropertyNames(classTarget.prototype));
            extension.install(classTarget, schema);
            for (const name of Object.getOwnPropertyNames(classTarget.prototype)) {
              if (!before.has(name)) installedMethodNames.add(name);
            }
            installedCapabilities.push(extension.kind);
            continue;
          }
          installScalarExtension(classTarget, extension, installedMethods, installedMethodNames);
        }
        register();
        return classTarget;
      },
    },
    factories: {
      enumerable: false,
      value: (options: FactoryOptions) => {
        if (factoriesConfigured) {
          throw new JITError("INVALID_OPERATION", "Factories are already configured for this Runtime Class");
        }
        if (constructionConfigured) {
          throw new JITError("INVALID_OPERATION", "Construction is already configured for this Runtime Class");
        }
        const createOption = resolveFactoryOption(options.create, factoryNames.create, "create");
        const hydrateOption = resolveFactoryOption(options.hydrate, factoryNames.hydrate, "hydrate");
        const next = { create: createOption.name, hydrate: hydrateOption.name };
        if (next.create === false && next.hydrate === false) {
          throw new JITError(
            "INVALID_OPERATION",
            "Factory construction requires at least one create or hydrate factory"
          );
        }
        installFactory(classTarget, factoryNames.create, next.create, create);
        installFactory(classTarget, factoryNames.hydrate, next.hydrate, hydrate);
        factoriesConfigured = true;
        factoryNames = next;
        customFactories = {
          ...(createOption.implementation === undefined ? {} : { create: createOption.implementation }),
          ...(hydrateOption.implementation === undefined ? {} : { hydrate: hydrateOption.implementation }),
        };
        register();
        return classTarget;
      },
    },
    construction: {
      enumerable: false,
      value: (mode: ConstructionMode) => {
        if (constructionConfigured) {
          throw new JITError("INVALID_OPERATION", "Construction is already configured for this Runtime Class");
        }
        if (factoriesConfigured) {
          throw new JITError("INVALID_OPERATION", "Factories already fixed the construction boundary");
        }
        if (mode !== "constructor" && mode !== "factory") {
          throw new JITError("INVALID_OPERATION", "Construction mode must be constructor or factory");
        }
        if (isAbstract && mode === "constructor") {
          throw new JITError("INVALID_OPERATION", "An abstract Runtime Class cannot use constructor construction");
        }
        if (policy.configured) {
          throw new JITError("INVALID_OPERATION", "Construction must be configured before validation or assertions");
        }
        constructionConfigured = true;
        constructionState.mode = mode;
        if (mode === "factory") {
          installFactory(classTarget, factoryNames.create, "create", create);
          installFactory(classTarget, factoryNames.hydrate, "hydrate", hydrate);
          factoryNames = { create: "create", hydrate: "hydrate" };
        } else {
          installFactory(classTarget, factoryNames.create, false, create);
          installFactory(classTarget, factoryNames.hydrate, false, hydrate);
          factoryNames = { create: false, hydrate: false };
        }
        register();
        return classTarget;
      },
    },
    accessors: {
      enumerable: false,
      value: () => {
        throw new JITError("INVALID_OPERATION", "Scalar Value Objects expose only their readonly value accessor");
      },
    },
    validate: {
      enumerable: false,
      value: (options?: FactoryValidationOptions) => {
        applyValidationPolicy(policy, options);
        register();
        return classTarget;
      },
    },
    assert: {
      enumerable: false,
      value: () => {
        throw new JITError("INVALID_OPERATION", "Assertions describe object fields; refine the scalar schema instead");
      },
    },
    identity: {
      enumerable: false,
      value: () => {
        throw new JITError("INVALID_OPERATION", "Scalar Value Objects do not have object fields");
      },
    },
  });
  definePrototype(
    classTarget.prototype,
    "equals",
    function equalsScalar(this: ScalarValueObject<unknown>, other: unknown) {
      return other instanceof classTarget && equal(this.value, (other as ScalarValueObject<unknown>).value);
    }
  );
  definePrototype(classTarget.prototype, "hashCode", function hashScalar(this: ScalarValueObject<unknown>) {
    return hash(this.value);
  });
  definePrototype(classTarget.prototype, "toJSON", function scalarToJson(this: ScalarValueObject<unknown>) {
    return this.value;
  });
  register();
  return classTarget as unknown as ScalarFactoryRuntimeClass<TSchema, ScalarValueObject<ATS.TypeofSchema<TSchema>>>;
}

function createClassLayoutPlan(
  properties: readonly string[],
  accessors: ResolvedAccessors | undefined,
  managedStorage: ReadonlyMap<string, ManagedStorageBinding>,
  fieldPolicies: ReadonlyMap<string, ClassFieldPolicy>,
  encapsulateFields: boolean,
  initializers: ReadonlyMap<string, () => unknown>
): ClassLayoutPlan {
  return Object.freeze({
    properties: Object.freeze([...properties]),
    accessors,
    managedStorage,
    fieldPolicies,
    encapsulateFields,
    initializers,
  });
}

/**
 * Installs the internal validation ABI used by nested Runtime Type emitters.
 * Validated nested state is written into the final instance directly, so the
 * common hydrate path does not create a plain state object and copy it again
 * through the public constructor. Layouts that use a native private slot keep
 * the constructor fallback because JavaScript does not allow an external
 * function to initialize that slot.
 */
function installTrustedMaterializer(
  classTarget: Function,
  layout: ClassLayoutPlan,
  freezeInstances: boolean,
  aggregate: boolean
): void {
  const accessorByKey = new Map(layout.accessors?.map((accessor) => [accessor.key, accessor]));
  const hasNativePrivateSlot = layout.properties.some(
    (property) => accessorByKey.get(property)?.field === "private" && !layout.managedStorage.has(property)
  );
  const materialize = (state: unknown): unknown => {
    if (hasNativePrivateSlot) {
      return new (classTarget as new (input: unknown, token: symbol, validated: boolean) => unknown)(
        state,
        INTERNAL_CONSTRUCT,
        true
      );
    }
    const instance = Object.create(classTarget.prototype) as Record<PropertyKey, unknown>;
    for (const property of layout.properties) {
      const initializer = layout.initializers.get(property);
      const input = state as Record<string, unknown>;
      const value = input[property] === undefined && initializer !== undefined ? initializer() : input[property];
      const managed = layout.managedStorage.get(property);
      if (managed === undefined) instance[property] = value;
      else instance[managed.value] = value;
    }
    if (aggregate) Object.defineProperty(instance, "__jitEvents", { value: [], writable: true });
    return freezeInstances ? Object.freeze(instance) : instance;
  };
  Object.defineProperty(classTarget, TRUSTED_MATERIALIZER, {
    configurable: false,
    enumerable: false,
    value: materialize,
  });
}

function emitConstructor(
  layout: ClassLayoutPlan,
  freezeInstances: boolean,
  aggregate: boolean,
  parse: (input: unknown) => unknown,
  construction: { mode: ConstructionMode },
  mutationGate?: WeakSet<object>
): unknown {
  const { properties, accessors, managedStorage, fieldPolicies, encapsulateFields, initializers } = layout;
  const accessorByKey = new Map(accessors?.map((accessor) => [accessor.key, accessor]));
  const slots: string[] = [];
  const definitions: string[] = [];
  const initializerEntries = [...initializers.entries()];
  const initializerBindings = new Map(initializerEntries.map(([field], index) => [field, `__init${index}`] as const));
  let slotIndex = 0;
  const assignments = properties.map((property) => {
    const accessor = accessorByKey.get(property);

    const managed = managedStorage.get(property);
    if (managed !== undefined) {
      const policy = fieldPolicies.get(property);
      const defaultDdd = encapsulateFields && policy === undefined;
      const getter = policy?.getter === true || defaultDdd || (policy === undefined && accessor?.field !== "private");
      const setter = policy?.setter === true;
      if (getter) definitions.push(`get [${JSON.stringify(property)}]() { return this[${managed.name}]; }`);
      if (setter || defaultDdd) {
        const guarded = encapsulateFields && (policy?.visibility !== "public" || policy?.noConstructor === true);
        definitions.push(
          guarded
            ? `set [${JSON.stringify(property)}](value) { if (!__mutationGate.has(this)) throw new TypeError("Field ${property} is readonly"); this[${managed.name}] = value; }`
            : `set [${JSON.stringify(property)}](value) { this[${managed.name}] = value; }`
        );
      }
      const initializer = initializerBindings.get(property);
      const value =
        initializer !== undefined
          ? `(state${emitPropertyAccess("", property)} === undefined ? ${initializer}() : state${emitPropertyAccess("", property)})`
          : `state${emitPropertyAccess("", property)}`;
      return `this[${managed.name}] = ${value};`;
    }

    if (accessor?.field !== "private") {
      const initializer = initializers.get(property);
      return initializer === undefined
        ? `this${emitPropertyAccess("", property)} = state${emitPropertyAccess("", property)};`
        : `this${emitPropertyAccess("", property)} = state${emitPropertyAccess("", property)} === undefined ? ${initializerBindings.get(property)}() : state${emitPropertyAccess("", property)};`;
    }

    const slot = `#p${slotIndex++}`;
    slots.push(slot);
    if (accessor.get !== false) definitions.push(`get [${JSON.stringify(accessor.get)}]() { return this.${slot}; }`);
    if (accessor.set !== false)
      definitions.push(`set [${JSON.stringify(accessor.set)}](value) { this.${slot} = value; }`);
    const initializer = initializers.get(property);
    return initializer === undefined
      ? `this.${slot} = state${emitPropertyAccess("", property)};`
      : `this.${slot} = state${emitPropertyAccess("", property)} === undefined ? ${initializerBindings.get(property)}() : state${emitPropertyAccess("", property)};`;
  });
  const events = aggregate ? ' Object.defineProperty(this, "__jitEvents", { value: [], writable: true });' : "";
  const storageEntries = [...managedStorage.values()];
  const storageNames = storageEntries.map((entry) => entry.name);
  const storageValues = storageEntries.map((entry) => entry.value);
  const initializerNames = initializerEntries.map(([field]) => initializerBindings.get(field) as string);
  const initializerValues = initializerEntries.map(([, initializer]) => initializer);
  const source = `return class JITRuntimeClass { ${slots.map((slot) => `${slot};`).join(" ")} constructor(input, token, validated) { if (__construction.mode === "factory" && token !== __construct && token !== true) throw new Error("This Runtime Type uses factory construction; call its create() or hydrate() factory"); const state = token === true || validated === true ? input : __parse(input); ${assignments.join(" ")}${events}${freezeInstances ? " Object.freeze(this);" : ""} } ${definitions.join(" ")} };`;

  return globalThis.Function(
    ...storageNames,
    ...initializerNames,
    "__parse",
    "__construct",
    "__construction",
    ...(mutationGate === undefined ? [] : ["__mutationGate"]),
    source
  )(
    ...storageValues,
    ...initializerValues,
    parse,
    INTERNAL_CONSTRUCT,
    construction,
    ...(mutationGate === undefined ? [] : [mutationGate])
  );
}

function resolveManagedStorage(
  properties: readonly string[],
  _accessors: ResolvedAccessors | undefined,
  managedFields: readonly ManagedFieldDescriptor[],
  encapsulateFields: boolean,
  fieldPolicies: ReadonlyMap<string, ClassFieldPolicy>
): ReadonlyMap<string, ManagedStorageBinding> {
  const storage = new Map<string, ManagedStorageBinding>();
  let index = 0;
  for (const field of properties) {
    const managed = managedFields.some((item) => item.field === field);
    const policy = fieldPolicies.get(field);
    const needsAccessorStorage =
      policy !== undefined &&
      (policy.visibility !== "public" || policy.getter !== false || policy.setter !== false || policy.noConstructor);
    if (!managed && !encapsulateFields && !needsAccessorStorage) continue;
    storage.set(field, { name: `__managed${index++}`, value: Symbol(`jit.${field}`) });
  }
  return storage;
}

function removeNoConstructorFields(
  schema: ATS.AnyTypeSchema,
  policies: ReadonlyMap<string, ClassFieldPolicy>
): ATS.AnyTypeSchema {
  const noConstructor = new Set(
    [...policies.entries()].filter(([, policy]) => policy.noConstructor).map(([field]) => field)
  );
  if (noConstructor.size === 0) return schema;
  const object = resolveEffectiveObjectSchema(schema);
  const props = Object.fromEntries(Object.entries(object.def.props).filter(([field]) => !noConstructor.has(field)));
  return createSchema(
    TypeName.object,
    {
      props,
      unknownKeys: object.def.unknownKeys,
      catchall: object.def.catchall,
      checks: object.def.checks,
    },
    object.annotations
  );
}

function compileNoConstructorInitializers(
  schema: ATS.AnyTypeSchema,
  policies: ReadonlyMap<string, ClassFieldPolicy>
): ReadonlyMap<string, () => unknown> {
  const object = resolveEffectiveObjectSchema(schema);
  const initializers = new Map<string, () => unknown>();
  for (const [field, policy] of policies) {
    if (!policy.noConstructor) continue;
    const fieldSchema = object.def.props[field];
    if (fieldSchema === undefined) continue;
    const parse = compileValidator(fieldSchema).parse;
    initializers.set(field, () => parse(undefined));
  }
  return initializers;
}

function installFieldDescriptorAccessors(classTarget: Function, policies: ReadonlyMap<string, ClassFieldPolicy>): void {
  for (const [name, policy] of policies) {
    const previous = Object.getOwnPropertyDescriptor(classTarget.prototype, name) ?? {
      configurable: true,
      enumerable: false,
    };
    const next: PropertyDescriptor = { ...previous };
    if (typeof policy.getter === "function") next.get = policy.getter as () => unknown;
    if (typeof policy.setter === "function") next.set = policy.setter as (value: unknown) => void;
    if (typeof policy.getter === "function" || typeof policy.setter === "function") {
      Object.defineProperty(classTarget.prototype, name, next);
    }
  }
}

function resolveAccessors<TSchema extends ATS.AnyTypeSchema>(
  properties: readonly string[],
  options: AccessorOptions<TSchema>
): ResolvedAccessors {
  return properties.map((key) => {
    const configured = {
      ...options.default,
      ...options.fields?.[key as Extract<keyof ATS.TypeofSchema<TSchema>, string>],
    };
    const get = resolveAccessorMember(key, configured.get);
    const set = resolveAccessorMember(key, configured.set);

    if (configured.field === "private" && get === false && set === false) {
      throw new JITError("INVALID_OPERATION", `Private field ${JSON.stringify(key)} must expose a getter or setter`);
    }
    return { key, field: configured.field ?? "public", get, set };
  });
}

function resolveAccessorMember(key: string, member: AccessorVisibility | AccessorMember | undefined): string | false {
  if (member === undefined) return key;
  if (member === false) return false;
  return typeof member === "string" ? key : (member.name ?? key);
}

export interface ClassFactory {
  <TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): ConstructorRuntimeClass<TSchema>;
  abstract<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): AbstractRuntimeClass<TSchema>;
  readonly equals: ClassCapability<EqualsMethods>;
  readonly hashCode: ClassCapability<HashCodeMethods>;
  readonly with: ClassWithCapability;
  readonly diff: ClassCapability<DiffMethods>;
  /**
   * Copies an instance's state through the shared clone plan.
   *
   * It is opt-in on purpose. Cloning a Value Object answers nothing — the value
   * is the identity — and cloning an Entity produces two objects claiming to be
   * the same one, which is a decision the domain has to make rather than
   * inherit. An Aggregate Root's clone starts with an empty event queue: the
   * pending events belong to the transition that raised them, not to a copy.
   */
  readonly clone: ClassCloneCapability;
  readonly override: typeof override;
  readonly public: typeof classPublic;
  readonly protected: typeof classProtected;
  readonly private: typeof classPrivate;
  readonly getter: typeof classGetter;
  readonly setter: typeof classSetter;
  readonly method: typeof classMethod;
  readonly factory: typeof classFactoryDescriptor;
  readonly noConstructor: typeof classNoConstructor;
  readonly mixin: typeof classMixin;
  readonly json: <const TOptions extends ClassJsonOptions = {}>(options?: TOptions) => ClassJsonCapability<TOptions>;
  readonly isFailure: typeof isFailure;
  identity<TKey extends string>(key: TKey): ClassCapability<IdentityMethods>;
}

/** Runtime type factory. Capabilities are installed separately on the prototype. */
export const classType: ClassFactory = Object.assign(classFactory, {
  abstract: abstractClass,
  equals: capability<EqualsMethods>("equals", (prototype, schema) => {
    definePrototype(prototype, "equals", compileEqualMethod(schema), true);
  }),
  hashCode: capability<HashCodeMethods>("hashCode", (prototype, schema) => {
    const hash = compileHash(schema);
    definePrototype(
      prototype,
      "hashCode",
      function hashCode(this: unknown) {
        return hash(this);
      },
      true
    );
  }),
  with: (() => {
    const base = capability<object>("with", (prototype, schema) => {
      const update = compileUpdate(schema);
      definePrototype(
        prototype,
        "with",
        function withPatch(this: object, patch: UpdatePatch<unknown>) {
          const next = update(this, patch);
          return new (this.constructor as new (state: object, token: symbol) => object)(
            next as object,
            INTERNAL_CONSTRUCT
          );
        },
        true
      );
    });
    return Object.freeze({ ...base, __with: true as const });
  })(),
  diff: capability<DiffMethods>("diff", (prototype, schema) => {
    const diff = compileDiff(schema);
    definePrototype(
      prototype,
      "diff",
      function diffInstance(this: unknown, other: unknown) {
        return diff(this, other);
      },
      true
    );
  }),
  clone: (() => {
    const base = capability<object>("clone", (prototype, schema) => {
      const clone = compileClone(schema);
      definePrototype(
        prototype,
        "clone",
        function cloneInstance(this: object) {
          return new (this.constructor as new (state: object, token: symbol, validated: boolean) => object)(
            clone(this) as object,
            INTERNAL_CONSTRUCT,
            true
          );
        },
        true
      );
    });
    return Object.freeze({ ...base, __clone: true as const });
  })(),
  override,
  public: classPublic,
  protected: classProtected,
  private: classPrivate,
  getter: classGetter,
  setter: classSetter,
  method: classMethod,
  factory: classFactoryDescriptor,
  noConstructor: classNoConstructor,
  mixin: classMixin,
  json<const TOptions extends ClassJsonOptions = {}>(options?: TOptions): ClassJsonCapability<TOptions> {
    const method = options?.method ?? "toJson";
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(method)) {
      throw new JITError("INVALID_OPERATION", `Invalid class JSON method name ${JSON.stringify(method)}`);
    }
    return Object.freeze({
      kind: "class.json" as const,
      __options: (options ?? {}) as TOptions,
      __memberNames: Object.freeze([method]),
      install() {},
    }) as ClassJsonCapability<TOptions>;
  },
  isFailure,
  identity(key: string): ClassCapability<IdentityMethods> {
    return capability<IdentityMethods>(
      `identity:${key}`,
      (prototype, schema) => {
        const base = resolveWrappers(schema).base;
        const props = base.type === TypeName.object ? (base as ATS.ObjectSchema).def.props : undefined;

        if (!props || !(key in props)) {
          throw new JITError("INVALID_OPERATION", `Identity key ${JSON.stringify(key)} is not a schema field`);
        }
        const runtimeIdentity = findRuntimeTypeSchema(props[key]);
        const valueIdentity = runtimeIdentity?.def.representation === "value";
        const equalIdentity = valueIdentity
          ? (compileEqual(runtimeIdentity.def.innerType) as (left: unknown, right: unknown) => boolean)
          : undefined;
        definePrototype(
          prototype,
          "identity",
          function identity(this: Record<string, unknown>) {
            return this[key];
          },
          true
        );
        definePrototype(
          prototype,
          "sameIdentity",
          function sameIdentity(this: Record<string, unknown>, other: unknown) {
            if (typeof other !== "object" || other === null) return false;
            const left = this[key];
            const right = (other as Record<string, unknown>)[key];
            if (!valueIdentity) return Object.is(left, right);
            return (
              typeof left === "object" &&
              left !== null &&
              typeof right === "object" &&
              right !== null &&
              (equalIdentity as (left: unknown, right: unknown) => boolean)(
                (left as ScalarValueObject<unknown>).value,
                (right as ScalarValueObject<unknown>).value
              )
            );
          },
          true
        );
      },
      ["identity", "sameIdentity"]
    );
  },
});
export type { OverrideDescriptor } from "../classes/override.js";
/** @deprecated Use `JIT.class.override(...)` instead. */
export { override, override as overwrite } from "../classes/override.js";
export type { OverwriteDescriptor } from "../classes/overwrite.js";
export { classType as class };

const valueAccessorCapability = capability<ValueAccessor<unknown>>("value", (prototype) => {
  Object.defineProperty(prototype, "value", {
    configurable: false,
    enumerable: false,
    get(this: unknown) {
      return this;
    },
  });
});

/** Immutable class preset with compiled structural equality and hash code. */
export function valueObject<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): ValueObjectRuntimeClass<TSchema> {
  const unwrapped = unwrapSchema(schema);
  const base = resolveWrappers(unwrapped).base;
  if (base.type !== TypeName.object) {
    if (!isPrimitiveLikeSchema(base)) {
      throw new JITError("INVALID_OPERATION", "Scalar Value Objects require a primitive-like schema");
    }
    return createScalarValueObject(unwrapped, false, false) as unknown as ValueObjectRuntimeClass<TSchema>;
  }
  const runtime = createRuntimeClass(unwrapped, false, true, false, "factory");
  return ("value" in (base as ATS.ObjectSchema).def.props
    ? (runtime.extends as (...extensions: AnyClassExtension[]) => RuntimeClass<TSchema>)(
        classType.equals,
        classType.hashCode
      )
    : (runtime.extends as (...extensions: AnyClassExtension[]) => RuntimeClass<TSchema>)(
        valueAccessorCapability,
        classType.equals,
        classType.hashCode
      )) as unknown as ValueObjectRuntimeClass<TSchema>;
}

type ObjectValueAccessor<TValue extends object> = "value" extends keyof TValue
  ? object
  : ValueAccessor<Readonly<TValue>>;
type ValueObjectInstance<TSchema extends ATS.AnyTypeSchema> =
  ATS.TypeofSchema<TSchema> extends object
    ? ATS.TypeofSchema<TSchema> & EqualsMethods & HashCodeMethods & ObjectValueAccessor<ATS.TypeofSchema<TSchema>>
    : ScalarValueObject<ATS.TypeofSchema<TSchema>>;
type ValueObjectRuntimeClass<TSchema extends ATS.AnyTypeSchema> =
  ATS.TypeofSchema<TSchema> extends object
    ? FactoryRuntimeClass<TSchema, ValueObjectInstance<TSchema>>
    : ScalarFactoryRuntimeClass<TSchema, ValueObjectInstance<TSchema>>;

export function abstractValueObject<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): ValueObjectRuntimeClass<TSchema> {
  const unwrapped = unwrapSchema(schema);
  const base = resolveWrappers(unwrapped).base;
  if (base.type !== TypeName.object) {
    if (!isPrimitiveLikeSchema(base)) {
      throw new JITError("INVALID_OPERATION", "Scalar Value Objects require a primitive-like schema");
    }
    return createScalarValueObject(unwrapped, false, true) as unknown as ValueObjectRuntimeClass<TSchema>;
  }
  const runtime = createRuntimeClass(unwrapped, true, true, false, "factory");
  return ("value" in (base as ATS.ObjectSchema).def.props
    ? (runtime.extends as (...extensions: AnyClassExtension[]) => RuntimeClass<TSchema>)(
        classType.equals,
        classType.hashCode
      )
    : (runtime.extends as (...extensions: AnyClassExtension[]) => RuntimeClass<TSchema>)(
        valueAccessorCapability,
        classType.equals,
        classType.hashCode
      )) as unknown as ValueObjectRuntimeClass<TSchema>;
}

type DefaultIdentifierSchema = ATS.DefaultSchema<ATS.StringSchema>;

/** Creates a scalar identifier Value Object with identifier metadata. */
export function uniqueIdentifier(): IdentifierRuntimeClass<DefaultIdentifierSchema, ScalarValueObject<string>>;
export function uniqueIdentifier<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): IdentifierRuntimeClass<TSchema, ScalarValueObject<ATS.TypeofSchema<TSchema>>>;
export function uniqueIdentifier<TSchema extends ATS.AnyTypeSchema>(schema?: SchemaInput<TSchema>): unknown {
  const identifierSchema =
    schema === undefined
      ? Transform.default(
          createSchema<string, "string", ATS.ChecksDef<ATS.StringCheck, readonly [ATS.StringCheck]>>(TypeName.string, {
            checks: [{ kind: "uuid" }],
          }),
          createIdentifierValue
        )
      : unwrapSchema(schema);
  const base = resolveWrappers(identifierSchema).base;
  if (!isPrimitiveLikeSchema(base) || base.type === TypeName.object) {
    throw new JITError("INVALID_OPERATION", "JIT.ddd.uniqueIdentifier() requires a primitive-like schema");
  }
  return createScalarValueObject(identifierSchema, true, false);
}

type HasIdentifierMetadata<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.RuntimeTypeSchema<ATS.AnyTypeSchema, unknown, "value", true, infer TTraits>
    ? TTraits extends ATS.RuntimeTypeTraits<"value", true>
      ? true
      : false
    : TSchema extends ATS.LazySchema<infer TInner>
      ? HasIdentifierMetadata<TInner>
      : TSchema extends
            | ATS.OptionalSchema<infer TInner>
            | ATS.NullableSchema<infer TInner>
            | ATS.NullishSchema<infer TInner>
            | ATS.DefaultSchema<infer TInner>
            | ATS.BrandSchema<infer TInner>
            | ATS.ReadonlySchema<infer TInner>
            | ATS.RefineSchema<infer TInner>
            | ATS.CoerceSchema<infer TInner>
            | ATS.PipeSchema<infer TInner>
            | ATS.TransformSchema<infer TInner>
        ? HasIdentifierMetadata<TInner>
        : false;

type IdentityKeys<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.ObjectSchema<infer TShape>
    ? {
        [TKey in keyof TShape]: HasIdentifierMetadata<TShape[TKey]> extends true ? TKey : never;
      }[keyof TShape] &
        string
    : never;
type IsUnion<TValue, TWhole = TValue> = [TValue] extends [never]
  ? false
  : TValue extends unknown
    ? [TWhole] extends [TValue]
      ? false
      : true
    : never;
type IdentityArguments<TSchema extends ATS.AnyTypeSchema> = [IdentityKeys<TSchema>] extends [never]
  ? []
  : IsUnion<IdentityKeys<TSchema>> extends true
    ? [
        options: {
          readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string>;
        },
      ]
    : [
        options?: {
          readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string>;
        },
      ];
type AggregateIdentityArguments<TSchema extends ATS.AnyTypeSchema> = [IdentityKeys<TSchema>] extends [never]
  ? [options: { readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string> }]
  : IdentityArguments<TSchema>;

function resolveIdentityState(
  schema: ATS.AnyTypeSchema,
  explicit: string | undefined,
  label: "Entity" | "Aggregate"
): IdentityState {
  const base = resolveWrappers(schema).base;
  if (base.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", `${label} identity requires an object schema`);
  }
  if (explicit !== undefined) return { state: "resolved", key: explicit, explicit: true };
  const candidates = Object.keys((base as ATS.ObjectSchema).def.props).filter((key) =>
    isIdentifierSchema((base as ATS.ObjectSchema).def.props[key])
  );
  if (candidates.length === 1) return { state: "resolved", key: candidates[0], explicit: false };
  if (candidates.length === 0) return { state: "pending" };
  throw new JITError(
    "DDD_IDENTITY_AMBIGUOUS",
    `${label} identity must be explicit when the schema has multiple unique identifiers`
  );
}

function isIdentifierSchema(schema: ATS.AnyTypeSchema): boolean {
  return findRuntimeTypeSchema(schema)?.def.identifier === true;
}

function findRuntimeTypeSchema(schema: ATS.AnyTypeSchema): ATS.RuntimeTypeSchema | undefined {
  let current = schema;
  while (true) {
    if (current.type === TypeName.runtimeType) {
      return current as ATS.RuntimeTypeSchema;
    }
    if (current.type === TypeName.lazy) {
      current = (current.def as ATS.LazyDef).getter();
      continue;
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
      current = (current.def as ATS.InnerTypeDef).innerType;
      continue;
    }
    return undefined;
  }
}

/** Adds structural timestamp fields and lifecycle mutation semantics. */
export function timestamps(): TimestampCapability<{}>;
export function timestamps<const TOptions extends TimestampOptions>(options?: TOptions): TimestampCapability<TOptions>;
export function timestamps<const TOptions extends TimestampOptions>(options?: TOptions): TimestampCapability<TOptions> {
  const resolved = options ?? ({} as TOptions);
  const touch = resolved.methods?.touch ?? "touch";
  return Object.freeze({
    kind: "ddd.timestamps" as const,
    __options: resolved,
    __memberNames: Object.freeze([touch]),
    install() {},
  }) as TimestampCapability<TOptions>;
}

/** Adds structural soft-delete state and reversible lifecycle methods. */
export function softDelete(): SoftDeleteCapability<{}>;
export function softDelete<const TOptions extends SoftDeleteOptions>(options: TOptions): SoftDeleteCapability<TOptions>;
export function softDelete<const TOptions extends SoftDeleteOptions>(
  options?: TOptions
): SoftDeleteCapability<TOptions> {
  const resolved = options ?? ({} as TOptions);
  const names = [
    resolved.methods?.delete ?? "softDelete",
    resolved.methods?.restore ?? "restore",
    resolved.methods?.isDeleted ?? "isDeleted",
  ];
  return Object.freeze({
    kind: "ddd.softDelete" as const,
    __options: resolved,
    __memberNames: Object.freeze(names),
    install() {},
  }) as SoftDeleteCapability<TOptions>;
}

/** Adds structural version state and lifecycle versioning. */
export function versioned(): VersionedCapability<{}>;
export function versioned<const TOptions extends VersionedOptions>(options?: TOptions): VersionedCapability<TOptions>;
export function versioned<const TOptions extends VersionedOptions>(options?: TOptions): VersionedCapability<TOptions> {
  const resolved = options ?? ({} as TOptions);
  return Object.freeze({
    kind: "ddd.versioned" as const,
    __options: resolved,
    __memberNames: Object.freeze([]),
    install() {},
  }) as VersionedCapability<TOptions>;
}

function createEntity<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  isAbstract: boolean,
  ...args: IdentityArguments<TSchema> | [{ readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string> }]
): FactoryRuntimeClass<
  TSchema,
  Readonly<ATS.TypeofSchema<TSchema>> & IdentityMethods,
  InitialRuntimeTypeTraits<TSchema>,
  true
> {
  const unwrapped = unwrapSchema(schema);
  const identity = resolveIdentityState(unwrapped, args[0]?.id, "Entity");
  const runtime = createRuntimeClass(unwrapped, isAbstract, false, false, "factory", true, undefined, {
    identity,
  });
  if (identity.state !== "resolved") {
    Reflect.deleteProperty(runtime, "create");
    Reflect.deleteProperty(runtime, "hydrate");
    return runtime as unknown as FactoryRuntimeClass<
      TSchema,
      Readonly<ATS.TypeofSchema<TSchema>> & IdentityMethods,
      InitialRuntimeTypeTraits<TSchema>,
      true
    >;
  }
  return (runtime.extends as (...extensions: AnyClassExtension[]) => RuntimeClass<TSchema>)(
    classType.identity(identity.key)
  ) as unknown as FactoryRuntimeClass<
    TSchema,
    Readonly<ATS.TypeofSchema<TSchema>> & IdentityMethods,
    InitialRuntimeTypeTraits<TSchema>,
    true
  >;
}

/** Concrete factory-first Entity with explicit or inferred identity semantics. */
export function entity<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema> & (IsUnion<IdentityKeys<TSchema>> extends true ? never : unknown)
): EntityRuntimeClassFor<
  TSchema,
  Readonly<ATS.TypeofSchema<TSchema>> & ([IdentityKeys<TSchema>] extends [never] ? {} : IdentityMethods),
  InitialRuntimeTypeTraits<TSchema>
>;
export function entity<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options: { readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string> }
): FactoryRuntimeClass<
  TSchema,
  Readonly<ATS.TypeofSchema<TSchema>> & IdentityMethods,
  InitialRuntimeTypeTraits<TSchema>,
  true
>;
export function entity<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  ...args: IdentityArguments<TSchema> | [{ readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string> }]
): unknown {
  return createEntity(schema, false, ...args);
}

/** Abstract factory-first Entity base, intended exclusively for subclassing. */
export function abstractEntity<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema> & (IsUnion<IdentityKeys<TSchema>> extends true ? never : unknown)
): EntityRuntimeClassFor<
  TSchema,
  Readonly<ATS.TypeofSchema<TSchema>> & ([IdentityKeys<TSchema>] extends [never] ? {} : IdentityMethods),
  InitialRuntimeTypeTraits<TSchema>
>;
export function abstractEntity<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options: { readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string> }
): FactoryRuntimeClass<
  TSchema,
  Readonly<ATS.TypeofSchema<TSchema>> & IdentityMethods,
  InitialRuntimeTypeTraits<TSchema>,
  true
>;
export function abstractEntity<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  ...args: IdentityArguments<TSchema> | [{ readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string> }]
): unknown {
  return createEntity(schema, true, ...args);
}

/** Aggregate Root preset using the same structural definition pipeline as entities. */
function createAggregateRoot<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  isAbstract: boolean,
  ...args: AggregateIdentityArguments<TSchema>
): AggregateRuntimeClass<TSchema, Readonly<ATS.TypeofSchema<TSchema>> & IdentityMethods & AggregateMethods<TSchema>> {
  const unwrapped = unwrapSchema(schema);
  const identity = resolveIdentityState(unwrapped, args[0]?.id, "Aggregate");
  if (identity.state !== "resolved") {
    throw new JITError("DDD_IDENTITY_MISSING", "Aggregate identity must be resolved before materialization");
  }
  const runtime = createRuntimeClass(unwrapped, isAbstract, false, true, "factory", true, undefined, { identity });
  return (runtime.extends as (extension: AnyClassCapability) => RuntimeClass<TSchema>)(
    classType.identity(identity.key)
  ) as unknown as AggregateRuntimeClass<
    TSchema,
    Readonly<ATS.TypeofSchema<TSchema>> & IdentityMethods & AggregateMethods<TSchema>
  >;
}

/** Concrete Aggregate Root with controlled mutation and an ordered event buffer. */
export function aggregateRoot<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  ...args: AggregateIdentityArguments<TSchema>
): AggregateRuntimeClass<TSchema, Readonly<ATS.TypeofSchema<TSchema>> & IdentityMethods & AggregateMethods<TSchema>> {
  return createAggregateRoot(schema, false, ...args);
}

/** Abstract Aggregate Root base, intended exclusively for subclassing. */
export function abstractAggregateRoot<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  ...args: AggregateIdentityArguments<TSchema>
): AggregateRuntimeClass<TSchema, Readonly<ATS.TypeofSchema<TSchema>> & IdentityMethods & AggregateMethods<TSchema>> {
  return createAggregateRoot(schema, true, ...args);
}

type EventSchema<TPayload extends ATS.AnyTypeSchema, TType extends string, TVersion extends number> = ATS.ObjectSchema<{
  readonly id: ATS.DefaultSchema<ATS.StringSchema>;
  readonly type: ATS.LiteralSchema<TType>;
  readonly version: ATS.LiteralSchema<TVersion>;
  readonly occurredAt: ATS.DefaultSchema<ATS.DateSchema>;
  readonly payload: TPayload;
}>;
type DomainEventState<TPayload extends ATS.AnyTypeSchema, TType extends string, TVersion extends number> = {
  readonly id: string;
  readonly type: TType;
  readonly version: TVersion;
  readonly occurredAt: Date;
  readonly payload: ATS.TypeofSchema<TPayload>;
};
export type DomainEvent<TPayload extends ATS.AnyTypeSchema, TType extends string, TVersion extends number> = Omit<
  RuntimeClass<EventSchema<TPayload, TType, TVersion>, DomainEventState<TPayload, TType, TVersion>>,
  "create" | "hydrate"
> &
  (abstract new (
    input: Input<EventSchema<TPayload, TType, TVersion>>
  ) => DomainEventState<TPayload, TType, TVersion> & {
    readonly "~event": StandardEvent;
  }) & {
    create(input: Input<TPayload>): DomainEventState<TPayload, TType, TVersion> & {
      readonly "~event": StandardEvent;
    };
    hydrate(state: Hydrate<EventSchema<TPayload, TType, TVersion>>): DomainEventState<TPayload, TType, TVersion> & {
      readonly "~event": StandardEvent;
    };
    readonly type: TType;
    readonly version: TVersion;
  };

/** Creates an immutable, versioned domain-event class from a payload schema. */
export function domainEvent<TPayload extends ATS.AnyTypeSchema, TType extends string, TVersion extends number>(
  type: TType,
  options: {
    readonly version: TVersion;
    readonly payload: SchemaInput<TPayload>;
  }
): DomainEvent<TPayload, TType, TVersion> {
  const payload = unwrapSchema(options.payload);
  const schema = createDomainEventSchema(payload, type, options.version);
  const event = createRuntimeClass(schema, false, true, false, "factory") as unknown as DomainEvent<
    TPayload,
    TType,
    TVersion
  >;
  const createState = (
    event as unknown as {
      create(input: Input<typeof schema>): DomainEventState<TPayload, TType, TVersion>;
    }
  ).create.bind(event);

  Object.defineProperties(event, {
    create: {
      configurable: false,
      enumerable: false,
      value: (input: Input<TPayload>) =>
        createState({ type, version: options.version, payload: input } as Input<typeof schema>),
    },
    type: { enumerable: true, value: type },
    version: { enumerable: true, value: options.version },
  });
  Object.defineProperty(event.prototype, "~event", {
    configurable: false,
    enumerable: false,
    value: Object.freeze({
      version: 1,
      type,
      schemaVersion: options.version,
    } satisfies StandardEvent),
    writable: false,
  });
  registerArtifact(event, {
    kind: "class",
    schema,
    abstract: false,
    frozen: true,
    aggregate: false,
    construction: "factory",
    representation: "object",
    capabilities: [],
    factories: { create: "create", hydrate: "hydrate" },
    domainEvent: { type, version: options.version },
  });
  return event;
}

function createDomainEventSchema<TPayload extends ATS.AnyTypeSchema, TType extends string, TVersion extends number>(
  payload: TPayload,
  type: TType,
  version: TVersion
): EventSchema<TPayload, TType, TVersion> {
  const id = Transform.default(createSchema(TypeName.string, {}), createEventId);
  // Event transport serializes dates as ISO strings. Coercion keeps the
  // persisted/JSON boundary symmetric while creation still receives a Date.
  const occurredAt = Transform.default(createSchema(TypeName.date, { coerce: true }), () => new Date());
  return createSchema(TypeName.object, {
    props: {
      id,
      type: createSchema(TypeName.literal, { value: type }),
      version: createSchema(TypeName.literal, { value: version }),
      occurredAt,
      payload,
    },
    unknownKeys: undefined,
    catchall: undefined,
    checks: [],
  }) as unknown as EventSchema<TPayload, TType, TVersion>;
}

function createEventId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function createIdentifierValue(): string {
  return crypto.randomUUID();
}

function capability<TMethods extends object>(
  kind: string,
  install: (prototype: object, schema: ATS.AnyTypeSchema) => void,
  memberNames: readonly string[] = [kind]
): ClassCapability<TMethods> {
  return Object.freeze({
    kind,
    __memberNames: Object.freeze([...memberNames]),
    install(classTarget: Function, schema: ATS.AnyTypeSchema) {
      install(classTarget.prototype, schema);
    },
  });
}

/**
 * Installs one application-owned method object on the prototype.
 *
 * Descriptors are copied rather than values, so a getter stays a getter and a
 * setter stays a setter. Every name is checked first: an extension that
 * shadowed a schema field, a factory or an installed capability would look
 * like it worked and quietly change what the class means.
 */
function installMethods(
  classTarget: Function,
  methods: ClassMethodsInput,
  taken: ReadonlySet<string>,
  installed: Set<string>
): {
  readonly name: string;
  readonly kind: "method" | "get" | "set";
  readonly source: Function;
}[] {
  const recorded: {
    name: string;
    kind: "method" | "get" | "set";
    source: Function;
  }[] = [];

  for (const name of Object.getOwnPropertyNames(methods)) {
    if (RESERVED_EXTENSION_NAMES.has(name) || taken.has(name) || installed.has(name)) {
      throw new JITError(
        "INVALID_OPERATION",
        `Class extension ${JSON.stringify(name)} would shadow an existing member; rename it`
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(methods, name);
    if (descriptor === undefined) continue;
    if (descriptor.get === undefined && descriptor.set === undefined && typeof descriptor.value !== "function") {
      throw new JITError(
        "INVALID_OPERATION",
        `Class extension ${JSON.stringify(name)} must be a method, a getter or a setter`
      );
    }
    Object.defineProperty(classTarget.prototype, name, {
      ...descriptor,
      enumerable: false,
      configurable: true,
    });
    installed.add(name);
    if (descriptor.get !== undefined) recorded.push({ name, kind: "get", source: descriptor.get });
    if (descriptor.set !== undefined) recorded.push({ name, kind: "set", source: descriptor.set });
    if (descriptor.get === undefined && descriptor.set === undefined) {
      recorded.push({
        name,
        kind: "method",
        source: descriptor.value as Function,
      });
    }
  }
  return recorded;
}

type InstalledScalarMethod = {
  name: string;
  kind: "method" | "get" | "set";
  source: Function;
};

/** Resolves scalar extensions through the same declaration descriptors as object Runtime Classes. */
function installScalarExtension(
  classTarget: Function,
  extension: ClassMethodsInput,
  installedMethods: InstalledScalarMethod[],
  installedMethodNames: Set<string>
): void {
  for (const name of Object.getOwnPropertyNames(extension)) {
    const property = Object.getOwnPropertyDescriptor(extension, name);
    if (property === undefined) continue;
    const value = property.value;
    if (isOverrideDescriptor(value)) {
      if (!installedMethodNames.has(name) || SCALAR_MEMBERS.has(name)) {
        throw new JITError(
          "CLASS_OVERRIDE_TARGET_NOT_FOUND",
          `Scalar member ${JSON.stringify(name)} does not have an overridable custom declaration`
        );
      }
      const replacement = value.value;
      if (isClassMemberDescriptor(replacement)) {
        installScalarDescriptor(classTarget, name, replacement.definition, installedMethods);
      } else if (typeof replacement === "function") {
        installScalarMethod(classTarget, { name, kind: "method", source: replacement }, installedMethods);
      } else {
        throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Scalar member ${JSON.stringify(name)} must be a method`);
      }
      continue;
    }
    if (SCALAR_MEMBERS.has(name) || installedMethodNames.has(name)) {
      throw new JITError(
        "CLASS_MEMBER_ALREADY_EXISTS",
        `Scalar member ${JSON.stringify(name)} would shadow an existing member; use JIT.class.override(...) explicitly`
      );
    }
    if (isClassMemberDescriptor(value)) {
      installScalarDescriptor(classTarget, name, value.definition, installedMethods);
    } else {
      const recorded = installMethods(classTarget, { [name]: value }, SCALAR_MEMBERS, installedMethodNames);
      installedMethods.push(...recorded);
    }
    installedMethodNames.add(name);
  }
}

function installScalarDescriptor(
  classTarget: Function,
  name: string,
  definition: ClassMemberDefinition,
  installedMethods: InstalledScalarMethod[]
): void {
  if (definition.kind === "factory") {
    throw new JITError(
      "CLASS_FACTORY_CONFLICT",
      "Factory descriptors belong in .factories(), not an instance extension"
    );
  }
  if (definition.kind === "field") {
    throw new JITError("CLASS_FIELD_DESCRIPTOR_CONFLICT", "Scalar Runtime Types do not expose schema fields");
  }
  if (definition.kind === "method") {
    if (definition.implementation === undefined) {
      throw new JITError("INVALID_OPERATION", `Class method ${JSON.stringify(name)} must be implemented`);
    }
    installScalarMethod(
      classTarget,
      {
        name,
        kind: "method",
        source: definition.implementation,
        schema: definition.schema as ATS.FunctionSchema,
        ...(definition.async === undefined ? {} : { async: definition.async }),
      },
      installedMethods
    );
    return;
  }
  const getter = typeof definition.getter === "function" ? definition.getter : undefined;
  const setter = typeof definition.setter === "function" ? definition.setter : undefined;
  if (getter === undefined && setter === undefined) {
    throw new JITError("CLASS_ACCESSOR_CONFLICT", `Scalar accessor ${JSON.stringify(name)} needs an implementation`);
  }
  const previous = Object.getOwnPropertyDescriptor(classTarget.prototype, name);
  const accessor: PropertyDescriptor = {
    configurable: true,
    enumerable: false,
  };
  const resolvedGetter = getter ?? previous?.get;
  const resolvedSetter = setter ?? previous?.set;
  if (resolvedGetter !== undefined) accessor.get = resolvedGetter as () => unknown;
  if (resolvedSetter !== undefined) accessor.set = resolvedSetter as (value: unknown) => void;
  Object.defineProperty(classTarget.prototype, name, accessor);
  if (getter !== undefined) replaceInstalledScalarMethod(installedMethods, { name, kind: "get", source: getter });
  if (setter !== undefined) replaceInstalledScalarMethod(installedMethods, { name, kind: "set", source: setter });
}

function installScalarMethod(
  classTarget: Function,
  method: ClassMethodDefinition,
  installedMethods: InstalledScalarMethod[]
): void {
  installMethodDefinition(classTarget, method);
  replaceInstalledScalarMethod(installedMethods, {
    name: method.name,
    kind: method.kind,
    source: method.source,
  });
}

function replaceInstalledScalarMethod(installedMethods: InstalledScalarMethod[], method: InstalledScalarMethod): void {
  const index = installedMethods.findIndex((item) => item.name === method.name && item.kind === method.kind);
  if (index === -1) installedMethods.push(method);
  else installedMethods[index] = method;
}

function definePrototype(prototype: object, key: string, value: Function, configurable = false): void {
  Object.defineProperty(prototype, key, {
    configurable,
    enumerable: false,
    value,
    writable: false,
  });
}
