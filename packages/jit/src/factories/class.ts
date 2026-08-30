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
import { type CompiledArtifact, registerArtifact, setClassMutationArtifact } from "../runtime/artifact-registry.js";
import * as Transform from "../transforms/index.js";
import { createConditionBuilder, type QueryConditionBuilder } from "./query.js";

type ObjectSchema<TSchema extends ATS.AnyTypeSchema> = TSchema & {
  readonly def: ATS.ObjectDef<ATS.SchemaShape>;
};

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
}

/** A successful or rejected factory call, in the shape the policy declared. */
export type FactoryOutcome<TInstance, TMode extends FactoryResultMode, TError> = TMode extends "result"
  ? { readonly ok: true; readonly value: TInstance } | { readonly ok: false; readonly error: TError }
  : TMode extends "tuple"
    ? readonly [TError, undefined] | readonly [undefined, TInstance]
    : TInstance;

interface AssertionOutcome {
  readonly error?: unknown;
  readonly issues?: readonly AssertionIssue[];
}

interface FactoryPolicyState {
  mode: FactoryResultMode;
  error: ((issues: readonly ValidationIssue[]) => unknown) | undefined;
  create: boolean;
  hydrate: boolean;
  configured: boolean;
  maxIssues: number | undefined;
  assertions: AssertionDescriptor[];
  assertionErrors: (AssertionErrorFactory | undefined)[];
  assert: ((value: unknown) => unknown) | undefined;
}

function createPolicyState(): FactoryPolicyState {
  return {
    mode: "throw",
    error: undefined,
    create: true,
    hydrate: true,
    configured: false,
    maxIssues: undefined,
    assertions: [],
    assertionErrors: [],
    assert: undefined,
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
    // A declared error type is reported as it is; otherwise every invariant
    // that did not hold travels in one error, the way schema issues do.
    return outcome.error ?? assertionError(outcome.issues ?? []);
  };
}

function policySuccess(policy: FactoryPolicyState, value: unknown): unknown {
  if (policy.mode === "result") return { ok: true, value };
  if (policy.mode === "tuple") return [undefined, value];
  return value;
}

function policyFailure(policy: FactoryPolicyState, error: unknown): never | unknown {
  if (policy.mode === "result") return { ok: false, error };
  if (policy.mode === "tuple") return [error, undefined];
  throw error;
}

function policyError(policy: FactoryPolicyState, issues: readonly ValidationIssue[]): unknown {
  return policy.error === undefined ? new JITValidationError(issues) : policy.error(issues);
}

/**
 * The reconstructive form of a configured policy.
 *
 * An unconfigured class contributes nothing, so its artifact — and the module
 * AOT generates from it — is exactly what it was before policies existed.
 */
function policyArtifact(policy: FactoryPolicyState): { readonly policy?: ClassPolicyArtifact } {
  if (!policy.configured) return {};
  const bindings = policy.assertions.flatMap((descriptor) => descriptor.bindings);

  return {
    policy: {
      result: policy.mode,
      create: policy.create,
      hydrate: policy.hydrate,
      ...(policy.maxIssues === undefined ? {} : { maxIssues: policy.maxIssues }),
      ...(policy.error === undefined ? {} : { error: policy.error }),
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
  if (options?.maxIssues !== undefined && (!Number.isSafeInteger(options.maxIssues) || options.maxIssues < 1)) {
    throw new RangeError("maxIssues must be a positive safe integer");
  }
  policy.configured = true;
  if (options?.result !== undefined) policy.mode = options.result;
  if (options?.error !== undefined) policy.error = options.error;
  if (options?.create !== undefined) policy.create = options.create;
  if (options?.hydrate !== undefined) policy.hydrate = options.hydrate;
  if (options?.maxIssues !== undefined) policy.maxIssues = options.maxIssues;
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
  policy.assertions.push(
    resolveAssertionDescriptor({
      condition,
      bindings: builder.bindings,
      ...(options?.rule === undefined ? {} : { rule: options.rule }),
      ...(options?.code === undefined ? {} : { code: options.code }),
      ...(options?.message === undefined ? {} : { message: options.message }),
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
    ? TExtensions[TKey]
    : TExtensions[TKey] &
        // The built-ins named in the same call are part of `this`, so a method
        // may use a capability it was declared beside.
        ThisType<TInstance & CapabilitiesInCall<TSchema, TInstance, TExtensions>> & {
          readonly [TName in keyof TInstance]?: never;
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

/** Methods an extension contributes, keeping declared signatures intact. */
type MethodsForExtension<
  TExtension,
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
> = TExtension extends AnyClassCapability
  ? MethodsForCapability<TExtension, TSchema, TInstance>
  : { -readonly [TKey in keyof TExtension]: TExtension[TKey] };

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

export interface RuntimeClass<TSchema extends ATS.AnyTypeSchema, TInstance = ATS.TypeofSchema<TSchema>> {
  new (input: Input<TSchema>): TInstance;
  readonly schema: ATS.RuntimeTypeSchema<TSchema, TInstance>;
  create<TThis extends RuntimeClass<TSchema>>(this: TThis, input: Input<TSchema>): InstanceType<TThis>;
  hydrate<TThis extends RuntimeClass<TSchema>>(this: TThis, state: Hydrate<TSchema>): InstanceType<TThis>;
  extends<const TExtensions extends readonly AnyClassExtension[]>(
    ...extensions: ClassExtensionArgs<TSchema, TInstance, TExtensions>
  ): RuntimeClass<TSchema, TInstance & ExtensionMethods<TSchema, TInstance, TExtensions>>;
  factories<const TOptions extends FactoryOptions>(
    options: TOptions
  ): ConfiguredRuntimeClass<TSchema, TInstance, TOptions>;
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
  | "accessors"
  | "identity"
  | "validate"
  | "assert";

/** The default `JIT.class` surface: direct construction, no static factories. */
export type ConstructorRuntimeClass<TSchema extends ATS.AnyTypeSchema, TInstance = ATS.TypeofSchema<TSchema>> = (new (
  input: Input<TSchema>
) => TInstance) &
  Omit<RuntimeClass<TSchema, TInstance>, RuntimeClassConstructionMembers> & {
    extends<const TExtensions extends readonly AnyClassExtension[]>(
      ...extensions: ClassExtensionArgs<TSchema, TInstance, TExtensions>
    ): ConstructorRuntimeClass<TSchema, TInstance & ExtensionMethods<TSchema, TInstance, TExtensions>>;
    factories<const TOptions extends FactoryOptions>(
      options: TOptions
    ): ConfiguredRuntimeClass<TSchema, TInstance, TOptions>;
    accessors(options: AccessorOptions<TSchema>): ConstructorRuntimeClass<TSchema, TInstance>;
    identity<TKey extends Extract<keyof ATS.TypeofSchema<TSchema>, string>>(
      key: TKey
    ): ConstructorRuntimeClass<TSchema, TInstance & IdentityMethods>;
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
  undefined extends Input<TSchema> ? [] | [input: Input<TSchema>] : [input: Input<TSchema>];

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

type ResolvedResultMode<TPolicy> = TPolicy extends { readonly result: infer TMode extends FactoryResultMode }
  ? TMode
  : "throw";
type ResolvedPolicyError<TPolicy, TError> = TPolicy extends { readonly error: (...args: never[]) => infer TNext }
  ? TNext
  : TError;
type ResolvedAssertionError<TOptions, TError> = TOptions extends { readonly error: (...args: never[]) => infer TNext }
  ? TError | TNext
  : TError | DomainAssertionError;

export type ConfiguredRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TOptions extends FactoryOptions,
  TMode extends FactoryResultMode = "throw",
  TError = JITValidationError,
> = (abstract new (
  input: Input<TSchema>
) => TInstance) &
  Omit<RuntimeClass<TSchema, TInstance>, RuntimeClassConstructionMembers> &
  FactoryMethods<TSchema, TInstance, TOptions, TMode, TError> & {
    extends<const TExtensions extends readonly AnyClassExtension[]>(
      ...extensions: ClassExtensionArgs<TSchema, TInstance, TExtensions>
    ): ConfiguredRuntimeClass<
      TSchema,
      TInstance & ExtensionMethods<TSchema, TInstance, TExtensions>,
      TOptions,
      TMode,
      TError
    >;
    factories<const TNext extends FactoryOptions>(
      options: TNext
    ): ConfiguredRuntimeClass<TSchema, TInstance, TNext, TMode, TError>;
    accessors(options: AccessorOptions<TSchema>): ConfiguredRuntimeClass<TSchema, TInstance, TOptions, TMode, TError>;
    identity<TKey extends Extract<keyof ATS.TypeofSchema<TSchema>, string>>(
      key: TKey
    ): ConfiguredRuntimeClass<TSchema, TInstance & IdentityMethods, TOptions, TMode, TError>;
    /**
     * Fixes how a rejected input is reported. The choice belongs to the
     * artifact, not to the call, so the factory signature says exactly which
     * shape a caller gets.
     */
    validate<const TPolicy extends FactoryValidationOptions = Record<never, never>>(
      policy?: TPolicy & FactoryValidationOptions
    ): ConfiguredRuntimeClass<
      TSchema,
      TInstance,
      TOptions,
      ResolvedResultMode<TPolicy>,
      ResolvedPolicyError<TPolicy, TError>
    >;
    /** Adds one domain invariant, written in the shared condition builder. */
    assert<const TAssertion extends AssertionOptions = Record<never, never>>(
      predicate: (query: QueryConditionBuilder<ATS.TypeofSchema<TSchema>>) => QueryConditionNode,
      options?: TAssertion
    ): ConfiguredRuntimeClass<TSchema, TInstance, TOptions, TMode, ResolvedAssertionError<TAssertion, TError>>;
  };

export type FactoryRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance = ATS.TypeofSchema<TSchema>,
> = ConfiguredRuntimeClass<TSchema, TInstance, {}>;

type IdentifierRuntimeClass<TSchema extends ATS.AnyTypeSchema, TInstance> = FactoryRuntimeClass<TSchema, TInstance> & {
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
  input: Input<TSchema>
) => TInstance) &
  Omit<RuntimeClass<TSchema, TInstance>, RuntimeClassConstructionMembers> & {
    extends<const TExtensions extends readonly AnyClassExtension[]>(
      ...extensions: ClassExtensionArgs<TSchema, TInstance, TExtensions>
    ): AbstractRuntimeClass<TSchema, TInstance & ExtensionMethods<TSchema, TInstance, TExtensions>>;
    factories<const TOptions extends FactoryOptions>(
      options: TOptions
    ): ConfiguredRuntimeClass<TSchema, TInstance, TOptions>;
    accessors(options: AccessorOptions<TSchema>): AbstractRuntimeClass<TSchema, TInstance>;
    identity<TKey extends Extract<keyof ATS.TypeofSchema<TSchema>, string>>(
      key: TKey
    ): AbstractRuntimeClass<TSchema, TInstance & IdentityMethods>;
  };

/** An immutable, tree-shakeable operation that installs one prototype capability. */
export interface ClassCapability<TMethods extends object = object> {
  readonly kind: string;
  install(classTarget: Function, schema: ATS.AnyTypeSchema): void;
  readonly __methods?: TMethods;
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
type IdentityMethods = { sameIdentity(other: unknown): boolean; identity(): unknown };
type ValueAccessor<TValue> = { readonly value: TValue };
export interface ScalarValueObject<TValue> extends EqualsMethods, HashCodeMethods {
  readonly value: TValue;
}
type DateKeys<TSchema extends ATS.AnyTypeSchema> = {
  [TKey in keyof ATS.TypeofSchema<TSchema>]: ATS.TypeofSchema<TSchema>[TKey] extends Date ? TKey : never;
}[keyof ATS.TypeofSchema<TSchema>] &
  string;
type NullableDateKeys<TSchema extends ATS.AnyTypeSchema> = {
  [TKey in keyof ATS.TypeofSchema<TSchema>]: ATS.TypeofSchema<TSchema>[TKey] extends Date | null ? TKey : never;
}[keyof ATS.TypeofSchema<TSchema>] &
  string;
type NumberKeys<TSchema extends ATS.AnyTypeSchema> = {
  [TKey in keyof ATS.TypeofSchema<TSchema>]: ATS.TypeofSchema<TSchema>[TKey] extends number ? TKey : never;
}[keyof ATS.TypeofSchema<TSchema>] &
  string;
export interface TimestampOptions<TSchema extends ATS.AnyTypeSchema> {
  readonly updatedAt: DateKeys<TSchema>;
  readonly createdAt?: DateKeys<TSchema>;
  readonly touch?: "mutation" | "manual";
}
export interface SoftDeleteOptions<TSchema extends ATS.AnyTypeSchema> {
  readonly field: NullableDateKeys<TSchema>;
}
export interface VersionedOptions<TSchema extends ATS.AnyTypeSchema> {
  readonly field: NumberKeys<TSchema>;
}
declare class AggregateProtectedMethods<TSchema extends ATS.AnyTypeSchema> {
  protected update(patch: SchemaUpdate<TSchema>): void;
  protected raise(event: unknown): void;
}

type AggregateMethods<TSchema extends ATS.AnyTypeSchema> = AggregateProtectedMethods<TSchema> & {
  peekEvents(): readonly unknown[];
  pullEvents(): unknown[];
  commit(publisher: EventPublisher): Promise<void>;
  softDelete(): void;
  restore(): void;
  readonly isDeleted: boolean;
};
type AggregateRuntimeClass<TSchema extends ATS.AnyTypeSchema, TInstance> = FactoryRuntimeClass<TSchema, TInstance> & {
  timestamps(options: TimestampOptions<TSchema>): AggregateRuntimeClass<TSchema, TInstance>;
  softDelete(options: SoftDeleteOptions<TSchema>): AggregateRuntimeClass<TSchema, TInstance>;
  versioned(options: VersionedOptions<TSchema>): AggregateRuntimeClass<TSchema, TInstance>;
};
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

function createRuntimeClass<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  isAbstract: boolean,
  freezeInstances: boolean,
  aggregate: boolean,
  construction: ConstructionMode,
  accessors?: ResolvedAccessors
): RuntimeClass<TSchema> {
  const resolved = resolveWrappers(schema).base;

  if (resolved.type !== TypeName.object) {
    throw new JITError("INVALID_OPERATION", "JIT.class() requires an object schema");
  }

  const objectSchema = resolved as ObjectSchema<TSchema>;
  const properties = Object.keys(objectSchema.def.props);
  const parse = compileValidator(schema).parse;
  const hydrateState = compileHydrator(schema);
  const constructionState = { mode: construction };
  const policy = createPolicyState();
  // Compiled only when a policy needs the issues rather than an exception, so
  // an unconfigured class pays for nothing it does not use.
  let safeParse: ((input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>) | undefined;
  let safeHydrate: ((state: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>) | undefined;
  const policySafeParse = () => {
    safeParse ??= compileValidatorSelection(schema, ["safeParse"], {
      ...(policy.maxIssues === undefined ? {} : { maxIssues: policy.maxIssues }),
    }).safeParse as (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
    return safeParse;
  };
  const policySafeHydrate = () => {
    safeHydrate ??= compileSafeHydrator(schema, {
      ...(policy.maxIssues === undefined ? {} : { maxIssues: policy.maxIssues }),
    }) as (state: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
    return safeHydrate;
  };
  const registerClass = () =>
    registerArtifact(classTarget, {
      kind: "class",
      schema,
      abstract: isAbstract,
      frozen: freezeInstances,
      aggregate,
      construction: constructionState.mode,
      representation: "object",
      ...policyArtifact(policy),
      capabilities: installedCapabilities,
      ...(installedMethods.length === 0 ? {} : { methods: installedMethods }),
      factories: factoryNames,
      accessors,
    });
  const classTarget = emitConstructor(
    properties,
    freezeInstances,
    aggregate,
    parse,
    constructionState,
    accessors
  ) as RuntimeClass<TSchema>;
  const installedCapabilities: string[] = [];
  const installedCapabilityValues: AnyClassCapability[] = [];
  const installedMethods: {
    readonly name: string;
    readonly kind: "method" | "get" | "set";
    readonly source: Function;
  }[] = [];
  const installedMethodNames = new Set<string>();
  const schemaNames: ReadonlySet<string> = new Set(properties);
  let factoryNames: { create: string | false; hydrate: string | false } =
    construction === "factory" ? { create: "create", hydrate: "hydrate" } : { create: false, hydrate: false };

  function create<TThis extends RuntimeClass<TSchema>>(this: TThis, input: Input<TSchema>): InstanceType<TThis> {
    if (isAbstract && this === classTarget) {
      throw new JITError("INVALID_OPERATION", "Cannot create an instance of an abstract JIT class");
    }
    const construct = this as unknown as new (
      input: unknown,
      token: symbol,
      validated?: boolean
    ) => InstanceType<TThis>;
    // The unconfigured path is the one that existed before policies: the
    // constructor parses, and nothing extra runs.
    if (!policy.configured || !policy.create) return new construct(input, INTERNAL_CONSTRUCT);
    const parsed = policySafeParse()(input);
    if (!parsed.success) return policyFailure(policy, policyError(policy, parsed.issues)) as InstanceType<TThis>;
    if (policy.assert !== undefined) {
      const failure = policy.assert(parsed.data);
      if (failure !== undefined) return policyFailure(policy, failure) as InstanceType<TThis>;
    }
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
    const parsed = policySafeHydrate()(state);
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
        innerType: schema,
        materialize: classTarget,
        representation: "object",
        identifier: false,
      }) as ATS.RuntimeTypeSchema<TSchema, ATS.TypeofSchema<TSchema>>,
    },
    extends: {
      enumerable: false,
      value: (...extensions: readonly (AnyClassCapability | ClassMethodsInput)[]) => {
        for (const extension of extensions) {
          if (isClassCapability(extension)) {
            // The names a capability defines are read back from the prototype
            // rather than from a table, so a later extension collides with a
            // clear message instead of a raw redefinition error.
            const before = new Set(Object.getOwnPropertyNames(classTarget.prototype));
            extension.install(classTarget, schema);
            for (const name of Object.getOwnPropertyNames(classTarget.prototype)) {
              if (!before.has(name)) installedMethodNames.add(name);
            }
            installedCapabilities.push(extension.kind);
            installedCapabilityValues.push(extension);
            continue;
          }
          installedMethods.push(...installMethods(classTarget, extension, schemaNames, installedMethodNames));
        }
        registerClass();
        return classTarget;
      },
    },
    validate: {
      enumerable: false,
      value: (options?: FactoryValidationOptions) => {
        applyValidationPolicy(policy, options);
        registerClass();
        return classTarget;
      },
    },
    assert: {
      enumerable: false,
      value: (predicate: (query: QueryConditionBuilder<never>) => QueryConditionNode, options?: AssertionOptions) => {
        applyAssertion(policy, schema, predicate, options);
        registerClass();
        return classTarget;
      },
    },
    factories: {
      configurable: true,
      enumerable: false,
      value: (options: FactoryOptions) => {
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
        constructionState.mode = "factory";
        installFactory(classTarget, factoryNames.create, next.create, create);
        installFactory(classTarget, factoryNames.hydrate, next.hydrate, hydrate);
        factoryNames = next;
        registerArtifact(classTarget, {
          kind: "class",
          schema,
          abstract: isAbstract,
          frozen: freezeInstances,
          aggregate,
          construction: constructionState.mode,
          representation: "object",
          ...policyArtifact(policy),
          ...(installedMethods.length === 0 ? {} : { methods: installedMethods }),
          capabilities: installedCapabilities,
          factories: factoryNames,
          accessors,
        });
        return classTarget;
      },
    },
    accessors: {
      enumerable: false,
      value: (options: AccessorOptions<TSchema>) => {
        const next = createRuntimeClass(
          schema,
          isAbstract,
          freezeInstances,
          aggregate,
          constructionState.mode,
          resolveAccessors(properties, options)
        );

        next.extends(...installedCapabilityValues);
        return constructionState.mode === "factory" ? (next.factories(factoryNames) as RuntimeClass<TSchema>) : next;
      },
    },
    identity: {
      enumerable: false,
      value: (key: Extract<keyof ATS.TypeofSchema<TSchema>, string>) => {
        const identity = classType.identity(key);
        identity.install(classTarget, schema);
        installedCapabilities.push(identity.kind);
        installedCapabilityValues.push(identity);
        registerArtifact(classTarget, {
          kind: "class",
          schema,
          abstract: isAbstract,
          frozen: freezeInstances,
          aggregate,
          construction: constructionState.mode,
          representation: "object",
          ...policyArtifact(policy),
          ...(installedMethods.length === 0 ? {} : { methods: installedMethods }),
          capabilities: installedCapabilities,
          factories: factoryNames,
          accessors,
        });
        return classTarget;
      },
    },
  });
  installFactory(classTarget, false, factoryNames.create, create);
  installFactory(classTarget, false, factoryNames.hydrate, hydrate);
  registerClass();

  return classTarget;
}

function installFactory<TSchema extends ATS.AnyTypeSchema>(
  classTarget: RuntimeClass<TSchema>,
  previous: string | false,
  next: string | false,
  factory: Function
): void {
  if (previous !== false && previous !== next) Reflect.deleteProperty(classTarget, previous);
  if (next === false) return;
  if (next === "schema" || next === "use" || next === "factories" || next === "accessors" || next === "identity") {
    throw new JITError("INVALID_OPERATION", `Factory name ${JSON.stringify(next)} is reserved`);
  }
  Object.defineProperty(classTarget, next, { configurable: true, enumerable: false, value: factory });
}

function createScalarValueObject<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  identifier: boolean,
  isAbstract: boolean
): FactoryRuntimeClass<TSchema, ScalarValueObject<ATS.TypeofSchema<TSchema>>> {
  const parse = compileValidator(schema).parse;
  const hydrateState = compileHydrator(schema);
  const policy = createPolicyState();
  let safeParse: ((input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>) | undefined;
  let safeHydrate: ((state: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>) | undefined;
  const equal = compileEqual(schema) as (left: unknown, right: unknown) => boolean;
  const hash = compileHash(schema) as (value: unknown) => number;
  const source = `return class JITScalarValueObject { constructor(input, token, validated) { if (token !== __construct && token !== true) throw new Error("This Runtime Type uses factory construction; call its create() or hydrate() factory"); this.value = token === true || validated === true ? input : __parse(input); Object.freeze(this); } };`;
  const classTarget = globalThis.Function("__parse", "__construct", source)(parse, INTERNAL_CONSTRUCT) as RuntimeClass<
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
      construction: "factory",
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
        factoryNames = next;
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
  return classTarget as unknown as FactoryRuntimeClass<TSchema, ScalarValueObject<ATS.TypeofSchema<TSchema>>>;
}

function emitConstructor(
  properties: readonly string[],
  freezeInstances: boolean,
  aggregate: boolean,
  parse: (input: unknown) => unknown,
  construction: { mode: ConstructionMode },
  accessors?: ResolvedAccessors
): unknown {
  const accessorByKey = new Map(accessors?.map((accessor) => [accessor.key, accessor]));
  const slots: string[] = [];
  const definitions: string[] = [];
  let slotIndex = 0;
  const assignments = properties.map((property) => {
    const accessor = accessorByKey.get(property);

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
  const events = aggregate ? ' Object.defineProperty(this, "__jitEvents", { value: [], writable: true });' : "";
  const source = `return class JITRuntimeClass { ${slots.map((slot) => `${slot};`).join(" ")} constructor(input, token, validated) { if (__construction.mode === "factory" && token !== __construct && token !== true) throw new Error("This Runtime Type uses factory construction; call its create() or hydrate() factory"); const state = token === true || validated === true ? input : __parse(input); ${assignments.join(" ")}${events}${freezeInstances ? " Object.freeze(this);" : ""} } ${definitions.join(" ")} };`;

  return globalThis.Function(
    "__parse",
    "__construct",
    "__construction",
    source
  )(parse, INTERNAL_CONSTRUCT, construction);
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
    definePrototype(prototype, "equals", compileEqualMethod(schema));
  }),
  hashCode: capability<HashCodeMethods>("hashCode", (prototype, schema) => {
    const hash = compileHash(schema);
    definePrototype(prototype, "hashCode", function hashCode(this: unknown) {
      return hash(this);
    });
  }),
  with: (() => {
    const base = capability<object>("with", (prototype, schema) => {
      const update = compileUpdate(schema);
      definePrototype(prototype, "with", function withPatch(this: object, patch: UpdatePatch<unknown>) {
        const next = update(this, patch);
        return new (this.constructor as new (state: object, token: symbol) => object)(
          next as object,
          INTERNAL_CONSTRUCT
        );
      });
    });
    return Object.freeze({ ...base, __with: true as const });
  })(),
  diff: capability<DiffMethods>("diff", (prototype, schema) => {
    const diff = compileDiff(schema);
    definePrototype(prototype, "diff", function diffInstance(this: unknown, other: unknown) {
      return diff(this, other);
    });
  }),
  clone: (() => {
    const base = capability<object>("clone", (prototype, schema) => {
      const clone = compileClone(schema);
      definePrototype(prototype, "clone", function cloneInstance(this: object) {
        return new (this.constructor as new (state: object, token: symbol, validated: boolean) => object)(
          clone(this) as object,
          INTERNAL_CONSTRUCT,
          true
        );
      });
    });
    return Object.freeze({ ...base, __clone: true as const });
  })(),
  identity(key: string): ClassCapability<IdentityMethods> {
    return capability<IdentityMethods>(`identity:${key}`, (prototype, schema) => {
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
      definePrototype(prototype, "identity", function identity(this: Record<string, unknown>) {
        return this[key];
      });
      definePrototype(prototype, "sameIdentity", function sameIdentity(this: Record<string, unknown>, other: unknown) {
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
      });
    });
  },
});
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
): FactoryRuntimeClass<TSchema, ValueObjectInstance<TSchema>> {
  const unwrapped = unwrapSchema(schema);
  const base = resolveWrappers(unwrapped).base;
  if (base.type !== TypeName.object) {
    if (!isPrimitiveLikeSchema(base)) {
      throw new JITError("INVALID_OPERATION", "Scalar Value Objects require a primitive-like schema");
    }
    return createScalarValueObject(unwrapped, false, false) as FactoryRuntimeClass<
      TSchema,
      ValueObjectInstance<TSchema>
    >;
  }
  const runtime = createRuntimeClass(unwrapped, false, true, false, "factory");
  return (
    "value" in (base as ATS.ObjectSchema).def.props
      ? runtime.extends(classType.equals, classType.hashCode)
      : runtime.extends(valueAccessorCapability, classType.equals, classType.hashCode)
  ) as FactoryRuntimeClass<TSchema, ValueObjectInstance<TSchema>>;
}

type ObjectValueAccessor<TValue extends object> = "value" extends keyof TValue
  ? object
  : ValueAccessor<Readonly<TValue>>;
type ValueObjectInstance<TSchema extends ATS.AnyTypeSchema> =
  ATS.TypeofSchema<TSchema> extends object
    ? ATS.TypeofSchema<TSchema> & EqualsMethods & HashCodeMethods & ObjectValueAccessor<ATS.TypeofSchema<TSchema>>
    : ScalarValueObject<ATS.TypeofSchema<TSchema>>;

valueObject.abstract = function abstractValueObject<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): FactoryRuntimeClass<TSchema, ValueObjectInstance<TSchema>> {
  const unwrapped = unwrapSchema(schema);
  const base = resolveWrappers(unwrapped).base;
  if (base.type !== TypeName.object) {
    if (!isPrimitiveLikeSchema(base)) {
      throw new JITError("INVALID_OPERATION", "Scalar Value Objects require a primitive-like schema");
    }
    return createScalarValueObject(unwrapped, false, true) as FactoryRuntimeClass<
      TSchema,
      ValueObjectInstance<TSchema>
    >;
  }
  const runtime = createRuntimeClass(unwrapped, true, true, false, "factory");
  return (
    "value" in (base as ATS.ObjectSchema).def.props
      ? runtime.extends(classType.equals, classType.hashCode)
      : runtime.extends(valueAccessorCapability, classType.equals, classType.hashCode)
  ) as FactoryRuntimeClass<TSchema, ValueObjectInstance<TSchema>>;
};

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

type IdentityKeys<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.ObjectSchema<infer TShape>
    ? {
        [TKey in keyof TShape]: TShape[TKey] extends ATS.RuntimeTypeSchema<ATS.AnyTypeSchema, unknown, "value", true>
          ? TKey
          : never;
      }[keyof TShape] &
        string
    : never;
type IsUnion<TValue, TWhole = TValue> = TValue extends unknown ? ([TWhole] extends [TValue] ? false : true) : never;
type IdentityArguments<TSchema extends ATS.AnyTypeSchema> = [IdentityKeys<TSchema>] extends [never]
  ? [options: { readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string> }]
  : IsUnion<IdentityKeys<TSchema>> extends true
    ? [options: { readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string> }]
    : [options?: { readonly id: Extract<keyof ATS.TypeofSchema<TSchema>, string> }];

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

/** Entity preset: an abstract class with explicit or unambiguous inferred identity semantics. */
export function entity<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  ...args: IdentityArguments<TSchema>
): FactoryRuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & IdentityMethods> {
  const unwrapped = unwrapSchema(schema);
  const identity = resolveIdentityKey(unwrapped, args[0]?.id);
  return createRuntimeClass(unwrapped, true, false, false, "factory").extends(
    classType.identity(identity)
  ) as FactoryRuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & IdentityMethods>;
}

/** Abstract entity preset with ordered domain events and compiled in-place updates. */
export function aggregateRoot<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  ...args: IdentityArguments<TSchema>
): AggregateRuntimeClass<TSchema, ATS.TypeofSchema<TSchema> & IdentityMethods & AggregateMethods<TSchema>> {
  const unwrapped = unwrapSchema(schema);
  const identity = resolveIdentityKey(unwrapped, args[0]?.id);
  const aggregate = createRuntimeClass(unwrapped, true, false, true, "factory").extends(
    classType.identity(identity)
  ) as unknown as AggregateRuntimeClass<
    TSchema,
    ATS.TypeofSchema<TSchema> & IdentityMethods & AggregateMethods<TSchema>
  >;
  const base = resolveWrappers(unwrapped).base as ATS.ObjectSchema;
  const fields = Object.keys(base.def.props);
  const readonlyFields = fields.filter((field) => resolveWrappers(base.def.props[field]).readonly);
  const updateBindings = new Map<string, string | null>();
  const updateNames: string[] = [];
  const updateValues: ((value: unknown, patch: unknown) => unknown)[] = [];

  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (readonlyFields.includes(field)) continue;
    if (isPrimitiveLikeSchema(resolveWrappers(base.def.props[field]).base)) {
      updateBindings.set(field, null);
      continue;
    }
    const name = `__update${index}`;
    updateBindings.set(field, name);
    updateNames.push(name);
    updateValues.push(compileUpdate(base.def.props[field]) as (value: unknown, patch: unknown) => unknown);
  }
  let updatedAt: string | undefined;
  let deletedAt: string | undefined;
  let version: string | undefined;
  const installMutation = () => {
    const mutation = buildAggregateMutationPlan({
      fields,
      readonlyFields,
      ...(updatedAt === undefined ? {} : { updatedAt }),
      ...(version === undefined ? {} : { version }),
    });
    const assign = globalThis.Function(
      ...updateNames,
      `return function update(patch) { ${emitAggregateMutationBody(mutation, updateBindings)} };`
    )(...updateValues) as (this: object, patch: SchemaUpdate<TSchema>) => void;

    Object.defineProperty(aggregate.prototype, "update", {
      configurable: true,
      enumerable: false,
      value: assign,
    });
  };

  installMutation();
  Object.defineProperty(aggregate, "timestamps", {
    configurable: false,
    enumerable: false,
    value: (timestamp: TimestampOptions<TSchema>) => {
      const field = timestamp.updatedAt;
      const schemaForField = base.def.props[field];
      if (!schemaForField || resolveWrappers(schemaForField).base.type !== TypeName.date) {
        throw new JITError("INVALID_OPERATION", `Timestamp field ${JSON.stringify(field)} must be a Date schema`);
      }
      if (timestamp.touch !== undefined && timestamp.touch !== "mutation" && timestamp.touch !== "manual") {
        throw new JITError("INVALID_OPERATION", "Timestamp touch must be mutation or manual");
      }
      updatedAt = timestamp.touch === "manual" ? undefined : field;
      installMutation();
      setClassMutationArtifact(aggregate, {
        ...(updatedAt === undefined ? {} : { updatedAt }),
        ...(deletedAt === undefined ? {} : { deletedAt }),
        ...(version === undefined ? {} : { version }),
      });
      return aggregate;
    },
  });
  Object.defineProperty(aggregate, "softDelete", {
    configurable: false,
    enumerable: false,
    value: (options: SoftDeleteOptions<TSchema>) => {
      const field = options.field;
      const schemaForField = base.def.props[field];
      const resolved = schemaForField && resolveWrappers(schemaForField);
      if (!resolved || resolved.base.type !== TypeName.date || !resolved.nullable) {
        throw new JITError(
          "INVALID_OPERATION",
          `Soft-delete field ${JSON.stringify(field)} must be a nullable Date schema`
        );
      }
      deletedAt = field;
      definePrototype(aggregate.prototype, "softDelete", function softDelete(this: Record<string, unknown>) {
        const now = new Date();
        this[field] = now;
        if (updatedAt !== undefined) this[updatedAt] = now;
      });
      definePrototype(aggregate.prototype, "restore", function restore(this: Record<string, unknown>) {
        this[field] = null;
        if (updatedAt !== undefined) this[updatedAt] = new Date();
      });
      Object.defineProperty(aggregate.prototype, "isDeleted", {
        configurable: false,
        enumerable: false,
        get(this: Record<string, unknown>) {
          return this[field] !== null;
        },
      });
      setClassMutationArtifact(aggregate, {
        ...(updatedAt === undefined ? {} : { updatedAt }),
        deletedAt,
        ...(version === undefined ? {} : { version }),
      });
      return aggregate;
    },
  });
  Object.defineProperty(aggregate, "versioned", {
    configurable: false,
    enumerable: false,
    value: (options: VersionedOptions<TSchema>) => {
      const field = options.field;
      const schemaForField = base.def.props[field];
      const type = schemaForField && resolveWrappers(schemaForField).base.type;
      if (type !== TypeName.int && type !== TypeName.number) {
        throw new JITError(
          "INVALID_OPERATION",
          `Version field ${JSON.stringify(field)} must be a number or int schema`
        );
      }
      version = field;
      installMutation();
      setClassMutationArtifact(aggregate, {
        ...(updatedAt === undefined ? {} : { updatedAt }),
        ...(deletedAt === undefined ? {} : { deletedAt }),
        version,
      });
      return aggregate;
    },
  });
  definePrototype(aggregate.prototype, "raise", function raise(this: { __jitEvents: unknown[] }, event: unknown) {
    this.__jitEvents[this.__jitEvents.length] = event;
  });
  definePrototype(aggregate.prototype, "peekEvents", function peekEvents(this: { __jitEvents: unknown[] }) {
    return this.__jitEvents.slice();
  });
  definePrototype(aggregate.prototype, "pullEvents", function pullEvents(this: { __jitEvents: unknown[] }) {
    const events = this.__jitEvents;
    this.__jitEvents = [];
    return events;
  });
  definePrototype(
    aggregate.prototype,
    "commit",
    async function commit(this: { __jitEvents: unknown[] }, publisher: EventPublisher): Promise<void> {
      const pending = this.__jitEvents;
      for (let index = 0; index < pending.length; index++) await publisher.publish(pending[index]);
      this.__jitEvents.splice(0, pending.length);
    }
  );
  return aggregate;
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
  ) => DomainEventState<TPayload, TType, TVersion> & { readonly "~event": StandardEvent }) & {
    create(input: Input<TPayload>): DomainEventState<TPayload, TType, TVersion> & { readonly "~event": StandardEvent };
    hydrate(
      state: Hydrate<EventSchema<TPayload, TType, TVersion>>
    ): DomainEventState<TPayload, TType, TVersion> & { readonly "~event": StandardEvent };
    readonly type: TType;
    readonly version: TVersion;
  };

/** Creates an immutable, versioned domain-event class from a payload schema. */
export function domainEvent<TPayload extends ATS.AnyTypeSchema, TType extends string, TVersion extends number>(
  type: TType,
  options: { readonly version: TVersion; readonly payload: SchemaInput<TPayload> }
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
    value: Object.freeze({ version: 1, type, schemaVersion: options.version } satisfies StandardEvent),
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
  install: (prototype: object, schema: ATS.AnyTypeSchema) => void
): ClassCapability<TMethods> {
  return Object.freeze({
    kind,
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
): { readonly name: string; readonly kind: "method" | "get" | "set"; readonly source: Function }[] {
  const recorded: { name: string; kind: "method" | "get" | "set"; source: Function }[] = [];

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
    Object.defineProperty(classTarget.prototype, name, { ...descriptor, enumerable: false, configurable: false });
    installed.add(name);
    if (descriptor.get !== undefined) recorded.push({ name, kind: "get", source: descriptor.get });
    if (descriptor.set !== undefined) recorded.push({ name, kind: "set", source: descriptor.set });
    if (descriptor.get === undefined && descriptor.set === undefined) {
      recorded.push({ name, kind: "method", source: descriptor.value as Function });
    }
  }
  return recorded;
}

function definePrototype(prototype: object, key: string, value: Function): void {
  Object.defineProperty(prototype, key, { configurable: false, enumerable: false, value, writable: false });
}
