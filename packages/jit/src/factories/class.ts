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
import type { ResolvedMemberTable } from "../classes/members.js";
import { isOverwriteDescriptor, type OverwriteDescriptor } from "../classes/overwrite.js";
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
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { type DomainAssertionError, JITError, JITValidationError, type ValidationIssue } from "../errors/index.js";
import { type CompiledArtifact, getArtifact, registerArtifact } from "../runtime/artifact-registry.js";
import * as Transform from "../transforms/index.js";
import { createConditionBuilder, type QueryConditionBuilder } from "./query.js";

const CLASS_TARGET = Symbol("jit.class.target");
const INTERNAL_CONSTRUCT = Symbol("jit.class.construct");
export type ConstructionMode = "constructor" | "factory";

/** How a factory reports a rejected input. Fixed at declaration, never per call. */
export type FactoryResultMode = "throw" | "result" | "tuple";

/** The failure channel and the phases it covers. */
export interface FactoryValidationOptions {
  readonly result?: FactoryResultMode;
  /** Stops diagnostic validation as soon as this many issues have been emitted. */
  readonly maxIssues?: number;
  /** Builds the error a rejected input produces; defaults to `JITValidationError`. */
  readonly error?: (issues: readonly ValidationIssue[]) => unknown;
  /** Larger values win when several declared error candidates can apply. */
  readonly priority?: number;
  readonly create?: boolean;
  readonly hydrate?: boolean;
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
export type FactoryOutcome<TInstance, TMode extends FactoryResultMode, TError> = TMode extends "result"
  ? { readonly ok: true; readonly value: TInstance } | { readonly ok: false; readonly error: TError }
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
}

interface FactoryPolicyState {
  mode: FactoryResultMode;
  error: ((issues: readonly ValidationIssue[]) => unknown) | undefined;
  create: boolean;
  hydrate: boolean;
  configured: boolean;
  validationConfigured: boolean;
  maxIssues: number | undefined;
  errorPriority: number;
  errorPriorityExplicit: boolean;
  assertions: AssertionDescriptor[];
  assertionErrors: (AssertionErrorFactory | undefined)[];
  assert: ((value: unknown) => unknown) | undefined;
  nestedErrors: readonly NestedErrorCandidate[];
}

function createPolicyState(): FactoryPolicyState {
  return {
    mode: "throw",
    error: undefined,
    create: true,
    hydrate: true,
    configured: false,
    validationConfigured: false,
    maxIssues: undefined,
    errorPriority: 1000,
    errorPriorityExplicit: false,
    assertions: [],
    assertionErrors: [],
    assert: undefined,
    nestedErrors: [],
  };
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
  if (policy.mode === "result") return { ok: true, value };
  if (policy.mode === "tuple") return [null, value];
  return value;
}

function policyFailure(policy: FactoryPolicyState, error: unknown): never | unknown {
  if (policy.mode === "result") return { ok: false, error };
  if (policy.mode === "tuple") return [error, null];
  throw error;
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
        });
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
  if (options?.result !== undefined) policy.mode = options.result;
  if (options?.error !== undefined) policy.error = options.error;
  if (options?.create !== undefined) policy.create = options.create;
  if (options?.hydrate !== undefined) policy.hydrate = options.hydrate;
  if (options?.maxIssues !== undefined) policy.maxIssues = options.maxIssues;
  if (options?.priority !== undefined) {
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
> = {
  [TKey in keyof TExtensions]: TExtensions[TKey] extends AnyClassCapability
    ? NonConflictingCapability<TExtensions[TKey], TSchema, TInstance>
    : TExtensions[TKey] &
        // The built-ins named in the same call are part of `this`, so a method
        // may use a capability it was declared beside.
        ThisType<TInstance & CapabilitiesInCall<TSchema, TInstance, TExtensions>> & {
          readonly [TName in keyof TExtensions[TKey]]?: TExtensions[TKey][TName] extends OverwriteDescriptor
            ? TName extends keyof (TInstance & CapabilitiesInCall<TSchema, TInstance, TExtensions>)
              ? unknown
              : never
            : TName extends keyof TInstance
              ? never
              : unknown;
        };
};

type CapabilitiesInCall<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TExtensions extends readonly AnyClassExtension[],
> = UnionToIntersection<
  TExtensions[number] extends infer TExtension
    ? TExtension extends AnyClassCapability
      ? MethodsForCapability<TExtension, TSchema, TInstance>
      : never
    : never
>;

type AnyClassExtension = AnyClassCapability | ClassMethodsInput;

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
type MethodsForExtension<
  TExtension,
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
> = TExtension extends AnyClassCapability
  ? MethodsForCapability<TExtension, TSchema, TInstance>
  : {
      -readonly [TKey in keyof TExtension as TExtension[TKey] extends OverwriteDescriptor<infer TValue>
        ? IsSchemaInput<TValue> extends true
          ? never
          : TKey
        : TKey]: TExtension[TKey] extends OverwriteDescriptor<infer TValue> ? TValue : TExtension[TKey];
    };

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

type IsSchemaInput<TValue> = TValue extends ATS.AnyTypeSchema | { readonly schema: ATS.AnyTypeSchema } ? true : false;
type SchemaFromInput<TValue> = TValue extends { readonly schema: infer TSchema extends ATS.AnyTypeSchema }
  ? TSchema
  : TValue extends ATS.AnyTypeSchema
    ? TValue
    : never;
type PreservedManagedMarker<TPrevious> = TPrevious extends {
  readonly [TKey in typeof TIMESTAMPS_FIELD_MARKER]: true;
}
  ? { readonly [TKey in typeof TIMESTAMPS_FIELD_MARKER]: true }
  : TPrevious extends { readonly [TKey in typeof SOFT_DELETE_FIELD_MARKER]: true }
    ? { readonly [TKey in typeof SOFT_DELETE_FIELD_MARKER]: true }
    : TPrevious extends { readonly [TKey in typeof VERSIONED_FIELD_MARKER]: true }
      ? { readonly [TKey in typeof VERSIONED_FIELD_MARKER]: true }
      : {};
type SchemaOverwriteKeys<TExtension> =
  TExtension extends Record<string, unknown>
    ? {
        [TKey in keyof TExtension]: TExtension[TKey] extends OverwriteDescriptor<infer TValue>
          ? IsSchemaInput<TValue> extends true
            ? TKey
            : never
          : never;
      }[keyof TExtension]
    : never;
type ApplySchemaOverwrite<TSchema extends ATS.AnyTypeSchema, TExtension> =
  TSchema extends ATS.ObjectSchema<infer TShape, infer TUnknownKeys, infer TCatchall>
    ? TExtension extends Record<string, unknown>
      ? ATS.ObjectSchema<
          Omit<TShape, SchemaOverwriteKeys<TExtension>> & {
            [TKey in keyof TExtension as TExtension[TKey] extends OverwriteDescriptor<infer TValue>
              ? IsSchemaInput<TValue> extends true
                ? TKey
                : never
              : never]: TExtension[TKey] extends OverwriteDescriptor<infer TValue>
              ? SchemaFromInput<TValue> & PreservedManagedMarker<TShape[TKey & keyof TShape]>
              : never;
          },
          TUnknownKeys,
          TCatchall
        >
      : TSchema
    : TSchema;
// The runtime node is still `readonly`, but the public materialized value is
// the ordinary Date/number representation. `ReadonlySchema` would turn Date
// into `Readonly<Date>`, which is a needless type-level mutation of a scalar
// lifecycle value.
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
/** Create boundaries omit lifecycle state; hydrate boundaries keep it complete. */
type ClassInput<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.ObjectSchema<infer TShape, infer TUnknownKeys, infer TCatchall>
    ? Input<ATS.ObjectSchema<Omit<TShape, ManagedInputKeys<TShape>>, TUnknownKeys, TCatchall>>
    : Input<TSchema>;
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
type ApplyClassExtensionSchema<TSchema extends ATS.AnyTypeSchema, TExtension> = TExtension extends AnyClassCapability
  ? AddCapabilitySchema<TSchema, TExtension>
  : ApplySchemaOverwrite<TSchema, TExtension>;
type ApplySchemaOverwrites<
  TSchema extends ATS.AnyTypeSchema,
  TExtensions extends readonly AnyClassExtension[],
> = TExtensions extends readonly [infer THead, ...infer TTail extends readonly AnyClassExtension[]]
  ? ApplySchemaOverwrites<ApplyClassExtensionSchema<TSchema, THead>, TTail>
  : TSchema;
type OverwriteMemberKeys<TExtension> = TExtension extends AnyClassCapability
  ? never
  : TExtension extends Record<string, unknown>
    ? {
        [TKey in keyof TExtension]: TExtension[TKey] extends OverwriteDescriptor ? TKey : never;
      }[keyof TExtension]
    : never;
type AllOverwriteMemberKeys<TExtensions extends readonly AnyClassExtension[]> =
  TExtensions[number] extends infer TExtension ? OverwriteMemberKeys<TExtension> : never;
type LifecycleUpdateMethod<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TExtensions extends readonly AnyClassExtension[],
> = [Extract<TExtensions[number], TimestampCapability | SoftDeleteCapability | VersionedCapability>] extends [never]
  ? {}
  : "update" extends keyof TInstance
    ? {}
    : { update(patch: SchemaUpdate<ApplySchemaOverwrites<TSchema, TExtensions>>): void };
type ExtendedInstance<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TExtensions extends readonly AnyClassExtension[],
> = [AllOverwriteMemberKeys<TExtensions>] extends [never]
  ? TInstance &
      ATS.TypeofSchema<ApplySchemaOverwrites<TSchema, TExtensions>> &
      ExtensionMethods<TSchema, TInstance, TExtensions> &
      LifecycleUpdateMethod<TSchema, TInstance, TExtensions>
  : Omit<TInstance, AllOverwriteMemberKeys<TExtensions>> &
      ATS.TypeofSchema<ApplySchemaOverwrites<TSchema, TExtensions>> &
      ExtensionMethods<TSchema, TInstance, TExtensions> &
      LifecycleUpdateMethod<TSchema, TInstance, TExtensions>;

export interface RuntimeClass<TSchema extends ATS.AnyTypeSchema, TInstance = ATS.TypeofSchema<TSchema>> {
  new (input: ClassInput<TSchema>): TInstance;
  readonly schema: ATS.RuntimeTypeSchema<TSchema, TInstance>;
  create<TThis extends RuntimeClass<TSchema>>(this: TThis, input: ClassInput<TSchema>): InstanceType<TThis>;
  hydrate<TThis extends RuntimeClass<TSchema>>(this: TThis, state: Hydrate<TSchema>): InstanceType<TThis>;
  extends<const TExtensions extends readonly AnyClassExtension[]>(
    ...extensions: ClassExtensionArgs<TSchema, TInstance, TExtensions>
  ): RuntimeClass<ApplySchemaOverwrites<TSchema, TExtensions>, ExtendedInstance<TSchema, TInstance, TExtensions>>;
  factories<const TOptions extends FactoryOptions>(
    options: TOptions
  ): ConfiguredRuntimeClass<TSchema, TInstance, TOptions>;
  construction(mode: "constructor"): ConstructorRuntimeClass<TSchema, TInstance>;
  construction(mode: "factory"): FactoryRuntimeClass<TSchema, TInstance>;
  accessors<TThis extends RuntimeClass<TSchema, TInstance>>(this: TThis, options: AccessorOptions<TSchema>): TThis;
  identity<TKey extends Extract<keyof ATS.TypeofSchema<TSchema>, string>>(
    key: TKey
  ): RuntimeClass<TSchema, TInstance & IdentityMethods>;
  validate(policy?: FactoryValidationOptions): RuntimeClass<TSchema, TInstance>;
  assert(
    predicate: (query: QueryConditionBuilder<ATS.TypeofSchema<TSchema>>) => QueryConditionNode,
    options?: AssertionOptions
  ): RuntimeClass<TSchema, TInstance>;
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
export type ConstructorRuntimeClass<TSchema extends ATS.AnyTypeSchema, TInstance = ATS.TypeofSchema<TSchema>> = (new (
  input: ClassInput<TSchema>
) => TInstance) &
  Omit<RuntimeClass<TSchema, TInstance>, RuntimeClassConstructionMembers> & {
    extends<const TExtensions extends readonly AnyClassExtension[]>(
      ...extensions: ClassExtensionArgs<TSchema, TInstance, TExtensions>
    ): ConstructorRuntimeClass<
      ApplySchemaOverwrites<TSchema, TExtensions>,
      ExtendedInstance<TSchema, TInstance, TExtensions>
    >;
    factories<const TOptions extends FactoryOptions>(
      options: TOptions
    ): ConfiguredRuntimeClass<TSchema, TInstance, TOptions, "throw", JITValidationError, false, true>;
    construction(mode: "constructor"): ConstructionFixedConstructor<TSchema, TInstance>;
    construction(mode: "factory"): ConstructionFixedFactory<TSchema, TInstance>;
    accessors(
      options: AccessorOptions<TSchema>
    ): (new (input: ClassInput<TSchema>) => TInstance) & Omit<ConstructorRuntimeClass<TSchema, TInstance>, "accessors">;
    identity<TKey extends Extract<keyof ATS.TypeofSchema<TSchema>, string>>(
      key: TKey
    ): (new (
      input: ClassInput<TSchema>
    ) => TInstance & IdentityMethods) &
      Omit<ConstructorRuntimeClass<TSchema, TInstance & IdentityMethods>, "identity">;
  };

export interface FactoryOptions {
  readonly create?: string | false;
  readonly hydrate?: string | false;
}

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
  undefined extends ClassInput<TSchema> ? [] | [input: ClassInput<TSchema>] : [input: ClassInput<TSchema>];

type FactoryMethods<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TOptions extends FactoryOptions,
  TMode extends FactoryResultMode = "throw",
  TError = JITValidationError,
> = (TOptions extends {
  readonly create: infer TName extends string;
}
  ? {
      [TKey in TName]: <TThis extends RuntimeConstructor<TInstance>>(
        this: TThis,
        ...args: CreateArguments<TSchema>
      ) => FactoryOutcome<InstanceType<TThis>, TMode, TError>;
    }
  : TOptions extends { readonly create: false }
    ? {}
    : {
        create<TThis extends RuntimeConstructor<TInstance>>(
          this: TThis,
          ...args: CreateArguments<TSchema>
        ): FactoryOutcome<InstanceType<TThis>, TMode, TError>;
      }) &
  (TOptions extends { readonly hydrate: infer TName extends string }
    ? {
        [TKey in TName]: <TThis extends RuntimeConstructor<TInstance>>(
          this: TThis,
          state: Hydrate<TSchema>
        ) => FactoryOutcome<InstanceType<TThis>, TMode, TError>;
      }
    : TOptions extends { readonly hydrate: false }
      ? {}
      : {
          hydrate<TThis extends RuntimeConstructor<TInstance>>(
            this: TThis,
            state: Hydrate<TSchema>
          ): FactoryOutcome<InstanceType<TThis>, TMode, TError>;
        });

type ResolvedResultMode<TPolicy> = TPolicy extends {
  readonly result: infer TMode extends FactoryResultMode;
}
  ? TMode
  : "throw";
type ResolvedPolicyError<TPolicy, TError> = TPolicy extends {
  readonly error: (...args: never[]) => infer TNext;
}
  ? TNext
  : TError;
type ResolvedAssertionError<TOptions, TError> = TOptions extends {
  readonly error: (...args: never[]) => infer TNext;
}
  ? TError | TNext
  : TError | DomainAssertionError;

export type ConfiguredRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TOptions extends FactoryOptions,
  TMode extends FactoryResultMode = "throw",
  TError = JITValidationError,
  TValidated extends boolean = false,
  TFactoriesConfigured extends boolean = false,
> = (abstract new (
  input: ClassInput<TSchema>
) => TInstance) &
  Omit<RuntimeClass<TSchema, TInstance>, RuntimeClassConstructionMembers> &
  FactoryMethods<TSchema, TInstance, TOptions, TMode, TError> & {
    extends<const TExtensions extends readonly AnyClassExtension[]>(
      ...extensions: ClassExtensionArgs<TSchema, TInstance, TExtensions>
    ): ConfiguredRuntimeClass<
      ApplySchemaOverwrites<TSchema, TExtensions>,
      ExtendedInstance<TSchema, TInstance, TExtensions>,
      TOptions,
      TMode,
      TError,
      TValidated,
      TFactoriesConfigured
    >;
    accessors(
      options: AccessorOptions<TSchema>
    ): (abstract new (
      input: ClassInput<TSchema>
    ) => TInstance) &
      Omit<
        ConfiguredRuntimeClass<TSchema, TInstance, TOptions, TMode, TError, TValidated, TFactoriesConfigured>,
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
      ResolvedAssertionError<TAssertion, TError>,
      TValidated,
      TFactoriesConfigured
    >;
  } & (TValidated extends true
    ? object
    : {
        /** Fixes the factory validation policy exactly once for this artifact. */
        validate<const TPolicy extends FactoryValidationOptions = Record<never, never>>(
          policy?: TPolicy & FactoryValidationOptions
        ): ConfiguredRuntimeClass<
          TSchema,
          TInstance,
          TOptions,
          ResolvedResultMode<TPolicy>,
          ResolvedPolicyError<TPolicy, TError>,
          true,
          TFactoriesConfigured
        >;
      }) &
  (TValidated extends true
    ? object
    : TFactoriesConfigured extends true
      ? object
      : {
          construction(mode: "constructor"): ConstructionFixedConstructor<TSchema, TInstance>;
          construction(
            mode: "factory"
          ): (abstract new (
            input: ClassInput<TSchema>
          ) => TInstance) &
            Omit<
              ConfiguredRuntimeClass<TSchema, TInstance, TOptions, TMode, TError, false, TFactoriesConfigured>,
              "construction" | "factories"
            >;
        }) &
  (TFactoriesConfigured extends true
    ? object
    : {
        factories<const TNext extends FactoryOptions>(
          options: TNext
        ): ConfiguredRuntimeClass<TSchema, TInstance, TNext, TMode, TError, TValidated, true>;
      });

export type FactoryRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance = ATS.TypeofSchema<TSchema>,
> = ConfiguredRuntimeClass<TSchema, TInstance, {}>;

type ConstructionFixedConstructor<TSchema extends ATS.AnyTypeSchema, TInstance> = (new (
  input: ClassInput<TSchema>
) => TInstance) &
  Omit<ConstructorRuntimeClass<TSchema, TInstance>, "construction" | "factories">;

type ConstructionFixedFactory<TSchema extends ATS.AnyTypeSchema, TInstance> = (abstract new (
  input: ClassInput<TSchema>
) => TInstance) &
  Omit<FactoryRuntimeClass<TSchema, TInstance>, "construction" | "factories">;

type ScalarFactoryRuntimeClass<TSchema extends ATS.AnyTypeSchema, TInstance> = (abstract new (
  input: ClassInput<TSchema>
) => TInstance) &
  Omit<FactoryRuntimeClass<TSchema, TInstance>, "accessors" | "assert">;

type IdentifierRuntimeClass<TSchema extends ATS.AnyTypeSchema, TInstance> = ScalarFactoryRuntimeClass<
  TSchema,
  TInstance
> & {
  readonly schema: ATS.RuntimeTypeSchema<TSchema, TInstance, "value", true>;
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
> = (abstract new (
  input: ClassInput<TSchema>
) => TInstance) &
  Omit<RuntimeClass<TSchema, TInstance>, RuntimeClassConstructionMembers> & {
    extends<const TExtensions extends readonly AnyClassExtension[]>(
      ...extensions: ClassExtensionArgs<TSchema, TInstance, TExtensions>
    ): AbstractRuntimeClass<
      ApplySchemaOverwrites<TSchema, TExtensions>,
      ExtendedInstance<TSchema, TInstance, TExtensions>
    >;
    factories<const TOptions extends FactoryOptions>(
      options: TOptions
    ): ConfiguredRuntimeClass<TSchema, TInstance, TOptions, "throw", JITValidationError, false, true>;
    accessors(
      options: AccessorOptions<TSchema>
    ): (abstract new (
      input: ClassInput<TSchema>
    ) => TInstance) &
      Omit<AbstractRuntimeClass<TSchema, TInstance>, "accessors">;
    identity<TKey extends Extract<keyof ATS.TypeofSchema<TSchema>, string>>(
      key: TKey
    ): (abstract new (
      input: ClassInput<TSchema>
    ) => TInstance & IdentityMethods) &
      Omit<AbstractRuntimeClass<TSchema, TInstance & IdentityMethods>, "identity">;
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

type AggregateRuntimeClass<TSchema extends ATS.AnyTypeSchema, TInstance> = FactoryRuntimeClass<TSchema, TInstance>;
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
  readonly accessors: ResolvedAccessors | undefined;
  readonly capabilities: readonly AnyClassCapability[];
  readonly methods: readonly ClassMethodDefinition[];
  readonly lifecycle: LifecycleDefinition;
  readonly managedFields: readonly ManagedFieldDescriptor[];
  readonly members: ResolvedMemberTable;
  readonly policy: FactoryPolicyState;
}

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
  readonly factoryNames?: { readonly create: string | false; readonly hydrate: string | false };
  readonly constructionConfigured?: boolean;
  readonly factoriesConfigured?: boolean;
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
    accessors,
    capabilities: Object.freeze([...(seed?.capabilities ?? [])]),
    methods: Object.freeze([...(seed?.methods ?? [])]),
    lifecycle: seed?.lifecycle ?? baseState.lifecycle,
    managedFields: Object.freeze([...(seed?.managedFields ?? baseState.managedFields)]),
    members,
    policy: seed?.policy ?? createPolicyState(),
  };
  const policy: FactoryPolicyState = {
    ...state.policy,
    nestedErrors: collectNestedErrorCandidates(state.schema),
  };

  const objectSchema = resolveEffectiveObjectSchema(state.schema);
  const properties = Object.keys(objectSchema.def.props);
  const parse = compileValidator(state.schema).parse;
  const hydrateState = compileHydrator(state.schema);
  let safeParse: ((input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>) | undefined;
  let safeHydrate: ((input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>) | undefined;
  const policySafeParse = () => {
    safeParse ??= compileValidatorSelection(state.schema, ["safeParse"], {
      ...(policy.maxIssues === undefined ? {} : { maxIssues: policy.maxIssues }),
    }).safeParse as (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
    return safeParse;
  };
  const policySafeHydrate = () => {
    safeHydrate ??= compileSafeHydrator(state.schema, {
      ...(policy.maxIssues === undefined ? {} : { maxIssues: policy.maxIssues }),
    }) as (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
    return safeHydrate;
  };

  const constructionState = { mode: state.construction };
  const managedStorage = resolveManagedStorage(properties, state.accessors, state.managedFields);
  const classTarget = emitConstructor(
    properties,
    state.freezeInstances,
    state.aggregate,
    parse,
    constructionState,
    state.accessors,
    managedStorage
  ) as RuntimeClass<TSchema>;

  for (const capabilityValue of state.capabilities) capabilityValue.install(classTarget, state.schema);
  installLifecycleMethods(classTarget, state, managedStorage);
  for (const method of state.methods) installMethodDefinition(classTarget, method);

  function registerClass(): void {
    const mutation = lifecycleArtifact(state.lifecycle);
    registerArtifact(classTarget, {
      kind: "class",
      declaredSchema: state.declaredSchema,
      schema: state.schema,
      abstract: state.isAbstract,
      frozen: state.freezeInstances,
      aggregate: state.aggregate,
      construction: state.construction,
      representation: "object",
      capabilities: state.capabilities.map((capability) => capability.kind),
      managedFields: state.managedFields,
      lifecycle: state.lifecycle,
      resolvedMembers: state.members.entries(),
      ...(mutation === undefined ? {} : { mutation }),
      ...policyArtifact(policy),
      ...(state.methods.length === 0 ? {} : { methods: state.methods }),
      factories: state.factoryNames,
      accessors: state.accessors,
    });
  }

  function create<TThis extends RuntimeClass<TSchema>>(this: TThis, input: Input<TSchema>): InstanceType<TThis> {
    if (state.isAbstract && this === classTarget) {
      throw new JITError("INVALID_OPERATION", "Cannot create an instance of an abstract JIT class");
    }
    const construct = this as unknown as new (
      input: unknown,
      token: symbol,
      validated?: boolean
    ) => InstanceType<TThis>;
    if (!policy.configured || !policy.create) {
      if (
        state.lifecycle.timestamps === undefined &&
        state.lifecycle.softDelete === undefined &&
        state.lifecycle.versioned === undefined
      ) {
        return new construct(input, INTERNAL_CONSTRUCT);
      }
      return new construct(initializeCreatedLifecycle(parse(input), input, state.lifecycle), INTERNAL_CONSTRUCT, true);
    }
    const parsed = policySafeParse()(input);
    if (!parsed.success) return policyFailure(policy, policyError(policy, parsed.issues)) as InstanceType<TThis>;
    const created = initializeCreatedLifecycle(parsed.data, input, state.lifecycle);
    if (policy.assert !== undefined) {
      const failure = policy.assert(created);
      if (failure !== undefined) return policyFailure(policy, failure) as InstanceType<TThis>;
    }
    return policySuccess(policy, new construct(created, INTERNAL_CONSTRUCT, true)) as InstanceType<TThis>;
  }

  function hydrate<TThis extends RuntimeClass<TSchema>>(this: TThis, input: Hydrate<TSchema>): InstanceType<TThis> {
    if (state.isAbstract && this === classTarget) {
      throw new JITError("INVALID_OPERATION", "Cannot hydrate an instance of an abstract JIT class");
    }
    const construct = this as unknown as new (
      value: unknown,
      token: symbol,
      validated?: boolean
    ) => InstanceType<TThis>;
    if (!policy.configured || !policy.hydrate) {
      return new construct(hydrateState(input), INTERNAL_CONSTRUCT, true);
    }
    const parsed = policySafeHydrate()(input);
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
      }) as unknown as ATS.RuntimeTypeSchema<TSchema, ATS.TypeofSchema<TSchema>>,
    },
    extends: {
      enumerable: false,
      value: (...extensions: readonly (AnyClassCapability | ClassMethodsInput)[]) =>
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
        const next = {
          create: options.create === undefined ? state.factoryNames.create : options.create,
          hydrate: options.hydrate === undefined ? state.factoryNames.hydrate : options.hydrate,
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
    state.accessors,
    state
  );
}

function resolveClassExtensions(
  current: ClassDefinitionState,
  extensions: readonly (AnyClassCapability | ClassMethodsInput)[]
): ClassDefinitionState {
  let next: ClassDefinitionState = {
    ...current,
    capabilities: [...current.capabilities],
    methods: [...current.methods],
    managedFields: [...current.managedFields],
    members: current.members.clone(),
  };

  for (const extension of extensions) {
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
        next = { ...next, members, capabilities: [...next.capabilities, extension] };
      }
      continue;
    }

    const members = next.members.clone();
    const methods = [...next.methods];
    let schema = next.schema;
    for (const name of Object.getOwnPropertyNames(extension)) {
      const descriptor = Object.getOwnPropertyDescriptor(extension, name);
      if (descriptor === undefined) continue;
      const value = descriptor.value;
      if (isOverwriteDescriptor(value)) {
        const existing = members.get(name);
        if (existing === undefined) {
          throw new JITError(
            "CLASS_OVERWRITE_TARGET_NOT_FOUND",
            `Class member ${JSON.stringify(name)} does not exist. JIT.overwrite() can only replace an existing member.`
          );
        }
        if (isSchemaInputValue(value.value)) {
          if (existing.kind !== "field") {
            throw new JITError("CLASS_MEMBER_ALREADY_EXISTS", `Member ${JSON.stringify(name)} is not a schema field`);
          }
          schema = replaceSchemaField(schema, name, unwrapSchema(value.value as SchemaInput<ATS.AnyTypeSchema>));
          schema = reapplyManagedAfterOverwrite(schema, next.managedFields);
          const effectiveField = resolveEffectiveObjectSchema(schema).def.props[name];
          members.replace(name, {
            ...existing,
            source: "overwrite",
            schema: effectiveField,
          });
        } else {
          if (existing.kind === "field") {
            throw new JITError(
              "CLASS_MEMBER_ALREADY_EXISTS",
              `Member ${JSON.stringify(name)} is a schema field; use a schema value with JIT.overwrite(...)`
            );
          }
          const replacement = methodDefinitionFromValue(name, value.value);
          replaceMethod(methods, name, replacement);
          members.replace(name, { ...existing, source: "overwrite", descriptor: { value: replacement.source } });
        }
        continue;
      }

      if (members.has(name) || RESERVED_EXTENSION_NAMES.has(name)) {
        throw new JITError(
          "CLASS_MEMBER_ALREADY_EXISTS",
          `Class member ${JSON.stringify(name)} would shadow an existing member. Use ${JSON.stringify(`${name}: JIT.overwrite(...)`)} to replace it explicitly.`
        );
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
    next = { ...next, schema, methods, members };
  }
  validateManagedFields(next.schema, next.managedFields);
  return next;
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
      `Member ${JSON.stringify(name)} already exists. Existing source conflicts with ${owner}; use JIT.overwrite(...) explicitly.`
    );
  }
}

function isSchemaInputValue(value: unknown): value is SchemaInput<ATS.AnyTypeSchema> {
  return (
    (typeof value === "object" && value !== null && "schema" in value && typeof value.schema === "object") ||
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

function reapplyManagedAfterOverwrite(
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

function methodDefinitionFromValue(name: string, value: unknown): ClassMethodDefinition {
  if (typeof value !== "function") {
    throw new JITError(
      "INVALID_OPERATION",
      `Overwrite ${JSON.stringify(name)} must provide a method function or schema`
    );
  }
  return { name, kind: "method", source: value };
}

function replaceMethod(methods: ClassMethodDefinition[], name: string, replacement: ClassMethodDefinition): void {
  const index = methods.findIndex((method) => method.name === name);
  if (index === -1) methods.push(replacement);
  else methods[index] = replacement;
}

function installMethodDefinition(classTarget: Function, method: ClassMethodDefinition): void {
  const descriptor: PropertyDescriptor =
    method.kind === "method"
      ? { value: method.source, writable: false }
      : method.kind === "get"
        ? { get: method.source as () => unknown }
        : { set: method.source as (value: unknown) => void };
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

/** Applies create-only lifecycle semantics after the fused schema parse. */
function initializeCreatedLifecycle(
  value: unknown,
  input: unknown,
  lifecycle: LifecycleDefinition
): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return value as Record<string, unknown>;
  const result = value as Record<string, unknown>;
  const supplied = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : undefined;
  const timestamps = lifecycle.timestamps;
  if (timestamps !== undefined) {
    if (supplied?.[timestamps.createdAt] !== undefined) {
      result[timestamps.createdAt] = timestamps.clock === undefined ? new Date() : checkedClock(timestamps.clock);
    }
    result[timestamps.updatedAt] = null;
  }
  if (lifecycle.softDelete !== undefined) result[lifecycle.softDelete.field] = null;
  if (lifecycle.versioned !== undefined) result[lifecycle.versioned.field] = 0;
  return result;
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
  let constructionConfigured = false;
  let factoriesConfigured = false;

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
    if (!policy.configured || !policy.create) return new construct(args[0], INTERNAL_CONSTRUCT);
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
    if (!policy.configured || !policy.hydrate) {
      return new construct(hydrateState(state), INTERNAL_CONSTRUCT, true);
    }
    safeHydrate ??= compileSafeHydrator(schema, {
      ...(policy.maxIssues === undefined ? {} : { maxIssues: policy.maxIssues }),
    }) as (state: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
    const parsed = safeHydrate(state);
    if (!parsed.success) return policyFailure(policy, policyError(policy, parsed.issues)) as InstanceType<TThis>;
    return policySuccess(policy, new construct(parsed.data, INTERNAL_CONSTRUCT, true)) as InstanceType<TThis>;
  }

  const register = () =>
    registerArtifact(classTarget, {
      kind: "class",
      schema,
      abstract: isAbstract,
      frozen: true,
      aggregate: false,
      construction: constructionState.mode,
      representation: "value",
      ...policyArtifact(policy),
      capabilities: installedCapabilities,
      ...(installedMethods.length === 0 ? {} : { methods: installedMethods }),
      factories: factoryNames,
    });

  Object.defineProperties(classTarget, {
    [CLASS_TARGET]: { enumerable: false, value: true },
    schema: {
      enumerable: true,
      value: createSchema(TypeName.runtimeType, {
        innerType: schema,
        materialize: classTarget,
        representation: "value",
        identifier,
      }) as ATS.RuntimeTypeSchema<TSchema, ScalarValueObject<ATS.TypeofSchema<TSchema>>>,
    },
    create: { configurable: true, enumerable: false, value: create },
    hydrate: { configurable: true, enumerable: false, value: hydrate },
    extends: {
      enumerable: false,
      value: (...extensions: readonly (AnyClassCapability | ClassMethodsInput)[]) => {
        for (const extension of extensions) {
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
          installedMethods.push(...installMethods(classTarget, extension, SCALAR_MEMBERS, installedMethodNames));
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
        const next = {
          create: options.create === undefined ? factoryNames.create : options.create,
          hydrate: options.hydrate === undefined ? factoryNames.hydrate : options.hydrate,
        };
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

function emitConstructor(
  properties: readonly string[],
  freezeInstances: boolean,
  aggregate: boolean,
  parse: (input: unknown) => unknown,
  construction: { mode: ConstructionMode },
  accessors?: ResolvedAccessors,
  managedStorage: ReadonlyMap<string, ManagedStorageBinding> = new Map()
): unknown {
  const accessorByKey = new Map(accessors?.map((accessor) => [accessor.key, accessor]));
  const slots: string[] = [];
  const definitions: string[] = [];
  let slotIndex = 0;
  const assignments = properties.map((property) => {
    const accessor = accessorByKey.get(property);

    const managed = managedStorage.get(property);
    if (managed !== undefined) {
      if (accessor?.field === "private") {
        if (accessor.get !== false)
          definitions.push(`get [${JSON.stringify(accessor.get)}]() { return this[${managed.name}]; }`);
        if (accessor.set !== false)
          definitions.push(`set [${JSON.stringify(accessor.set)}](value) { this[${managed.name}] = value; }`);
      } else {
        definitions.push(`get [${JSON.stringify(property)}]() { return this[${managed.name}]; }`);
      }
      return `this[${managed.name}] = state${emitPropertyAccess("", property)};`;
    }

    if (accessor?.field !== "private") {
      return `this${emitPropertyAccess("", property)} = state${emitPropertyAccess("", property)};`;
    }

    const slot = `#p${slotIndex++}`;
    slots.push(slot);
    if (accessor.get !== false) definitions.push(`get [${JSON.stringify(accessor.get)}]() { return this.${slot}; }`);
    if (accessor.set !== false)
      definitions.push(`set [${JSON.stringify(accessor.set)}](value) { this.${slot} = value; }`);
    return `this.${slot} = state${emitPropertyAccess("", property)};`;
  });
  const managedAccessors = [...managedStorage.entries()]
    .filter(([field]) => accessorByKey.get(field)?.field !== "private")
    .map(
      ([field]) =>
        `Object.defineProperty(this, ${JSON.stringify(field)}, { get: Object.getOwnPropertyDescriptor(JITRuntimeClass.prototype, ${JSON.stringify(field)}).get, enumerable: true, configurable: false });`
    )
    .join(" ");
  const events = aggregate ? ' Object.defineProperty(this, "__jitEvents", { value: [], writable: true });' : "";
  const storageEntries = [...managedStorage.values()];
  const storageNames = storageEntries.map((entry) => entry.name);
  const storageValues = storageEntries.map((entry) => entry.value);
  const source = `return class JITRuntimeClass { ${slots.map((slot) => `${slot};`).join(" ")} constructor(input, token, validated) { if (__construction.mode === "factory" && token !== __construct && token !== true) throw new Error("This Runtime Type uses factory construction; call its create() or hydrate() factory"); const state = token === true || validated === true ? input : __parse(input); ${assignments.join(" ")}${managedAccessors.length === 0 ? "" : ` ${managedAccessors}`}${events}${freezeInstances ? " Object.freeze(this);" : ""} } ${definitions.join(" ")} };`;

  return globalThis.Function(
    ...storageNames,
    "__parse",
    "__construct",
    "__construction",
    source
  )(...storageValues, parse, INTERNAL_CONSTRUCT, construction);
}

function resolveManagedStorage(
  properties: readonly string[],
  _accessors: ResolvedAccessors | undefined,
  managedFields: readonly ManagedFieldDescriptor[]
): ReadonlyMap<string, ManagedStorageBinding> {
  const storage = new Map<string, ManagedStorageBinding>();
  for (let index = 0; index < managedFields.length; index++) {
    const field = managedFields[index]?.field;
    if (field === undefined || !properties.includes(field)) continue;
    storage.set(field, { name: `__managed${index}`, value: Symbol(`jit.${field}`) });
  }
  return storage;
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
export type { OverwriteDescriptor } from "../classes/overwrite.js";
export { overwrite } from "../classes/overwrite.js";
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
  return (
    "value" in (base as ATS.ObjectSchema).def.props
      ? (runtime.extends as (...extensions: AnyClassExtension[]) => RuntimeClass<TSchema>)(
          classType.equals,
          classType.hashCode
        )
      : (runtime.extends as (...extensions: AnyClassExtension[]) => RuntimeClass<TSchema>)(
          valueAccessorCapability,
          classType.equals,
          classType.hashCode
        )
  ) as ValueObjectRuntimeClass<TSchema>;
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
  return (
    "value" in (base as ATS.ObjectSchema).def.props
      ? (runtime.extends as (...extensions: AnyClassExtension[]) => RuntimeClass<TSchema>)(
          classType.equals,
          classType.hashCode
        )
      : (runtime.extends as (...extensions: AnyClassExtension[]) => RuntimeClass<TSchema>)(
          valueAccessorCapability,
          classType.equals,
          classType.hashCode
        )
  ) as ValueObjectRuntimeClass<TSchema>;
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
  TSchema extends ATS.RuntimeTypeSchema<ATS.AnyTypeSchema, unknown, "value", true>
    ? true
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
type IsUnion<TValue, TWhole = TValue> = TValue extends unknown ? ([TWhole] extends [TValue] ? false : true) : never;
type IdentityArguments<TSchema extends ATS.AnyTypeSchema> = [IdentityKeys<TSchema>] extends [never]
  ? [options: { readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string> }]
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

function resolveIdentityKey(schema: ATS.AnyTypeSchema, explicit: string | undefined): string {
  const base = resolveWrappers(schema).base;
  if (base.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", "Entity identity requires an object schema");
  }
  if (explicit !== undefined) return explicit;
  const candidates = Object.keys((base as ATS.ObjectSchema).def.props).filter((key) =>
    isIdentifierSchema((base as ATS.ObjectSchema).def.props[key])
  );
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new JITError(
      "INVALID_OPERATION",
      "Entity identity must be explicit when the schema has no unique identifier"
    );
  }
  throw new JITError(
    "INVALID_OPERATION",
    "Entity identity must be explicit when the schema has multiple unique identifiers"
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
  ...args: IdentityArguments<TSchema>
): FactoryRuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & IdentityMethods> {
  const unwrapped = unwrapSchema(schema);
  const identity = resolveIdentityKey(unwrapped, args[0]?.id);
  const runtime = createRuntimeClass(unwrapped, isAbstract, false, false, "factory");
  return (runtime.extends as (...extensions: AnyClassExtension[]) => RuntimeClass<TSchema>)(
    classType.identity(identity)
  ) as FactoryRuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & IdentityMethods>;
}

/** Concrete factory-first Entity with explicit or inferred identity semantics. */
export function entity<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  ...args: IdentityArguments<TSchema>
): FactoryRuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & IdentityMethods> {
  return createEntity(schema, false, ...args);
}

/** Abstract factory-first Entity base, intended exclusively for subclassing. */
export function abstractEntity<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  ...args: IdentityArguments<TSchema>
): FactoryRuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & IdentityMethods> {
  return createEntity(schema, true, ...args);
}

/** Aggregate Root preset using the same structural definition pipeline as entities. */
function createAggregateRoot<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  isAbstract: boolean,
  ...args: IdentityArguments<TSchema>
): AggregateRuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & IdentityMethods & AggregateMethods<TSchema>> {
  const unwrapped = unwrapSchema(schema);
  const identity = resolveIdentityKey(unwrapped, args[0]?.id);
  const runtime = createRuntimeClass(unwrapped, isAbstract, false, true, "factory");
  return (runtime.extends as (extension: AnyClassCapability) => RuntimeClass<TSchema>)(
    classType.identity(identity)
  ) as unknown as AggregateRuntimeClass<
    TSchema,
    ATS.TypeofSchema<TSchema> & IdentityMethods & AggregateMethods<TSchema>
  >;
}

/** Concrete Aggregate Root with controlled mutation and an ordered event buffer. */
export function aggregateRoot<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  ...args: IdentityArguments<TSchema>
): AggregateRuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & IdentityMethods & AggregateMethods<TSchema>> {
  return createAggregateRoot(schema, false, ...args);
}

/** Abstract Aggregate Root base, intended exclusively for subclassing. */
export function abstractAggregateRoot<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  ...args: IdentityArguments<TSchema>
): AggregateRuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & IdentityMethods & AggregateMethods<TSchema>> {
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

  for (const name of Object.keys(methods)) {
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
      configurable: false,
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

function definePrototype(prototype: object, key: string, value: Function, configurable = false): void {
  Object.defineProperty(prototype, key, {
    configurable,
    enumerable: false,
    value,
    writable: false,
  });
}
