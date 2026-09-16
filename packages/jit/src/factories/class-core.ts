import { addMember, initialEffectiveSchema, resolveEffectiveObjectSchema } from "../classes/effective-schema.js";
import {
  classFactory as classFactoryDescriptor,
  classGetter,
  classMethod,
  classNoConstructor,
  classPrivate,
  classProtected,
  classPublic,
  classSetter,
} from "../classes/member-descriptors.js";
import { override } from "../classes/override.js";
import { compileCloneMethod } from "../compiler/clone.js";
import { compileDiffMethod } from "../compiler/diff.js";
import { compileEqualMethod } from "../compiler/equal.js";
import { compileHashMethod } from "../compiler/hash.js";
import { compileUpdate, type UpdatePatch } from "../compiler/index.js";
import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import { schemaChildren } from "../compiler/schema-recursion.js";
import { compileSerializeWithRootAccess } from "../compiler/serialize.js";
import {
  compileHydrator,
  compileMaterializer,
  compileSafeHydrator,
  compileValidator,
  compileValidatorSelection,
} from "../compiler/validate.js";
import type { QueryConditionNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import type { Input } from "../core/ats/input.js";
import type { Hydrate } from "../core/ats/representations.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import {
  type FactoryPolicyCandidate,
  type FactoryReturnMode,
  selectFactoryPolicyCandidate,
} from "../core/factory-policy.js";
import { JITError, JITValidationError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { Object_hasOwn } from "../shared/utils.js";
import { capabilityMemberNames, resolveClassExtensions } from "./class-core-extensions-resolution.js";
import { installLifecycleMethods, lifecycleArtifact } from "./class-core-lifecycle.js";
import type { ClassDefinitionState, ClassStateSeed } from "./class-core-state.js";
import {
  capability,
  definePrototype,
  installFactory,
  installMethodDefinition,
  resolveFactoryOption,
} from "./class-core-support.js";
import { CLASS_TARGET } from "./class-core-symbols.js";
import { CLASS_MIXIN } from "./class-extensions.js";
import {
  compileNoConstructorInitializers,
  createClassLayoutPlan,
  emitConstructor,
  INTERNAL_CONSTRUCT,
  installFieldDescriptorAccessors,
  installTrustedMaterializer,
  type ResolvedAccessors,
  removeNoConstructorFields,
  resolveAccessors,
  resolveManagedStorage,
  TRUSTED_MATERIALIZER,
} from "./class-layout.js";
import {
  applyAssertion,
  applyValidationPolicy,
  clonePolicyState,
  collectNestedErrorCandidates,
  isFailure,
  policyArtifact,
  policyError,
  policyFailure,
  policySuccess,
  runtimeTypeTraits,
  type SafeParse,
} from "./class-policy.js";
import type { QueryConditionBuilder } from "./query.js";

export { createScalarValueObject } from "./class-core-scalar.js";
export { isIdentifierSchema } from "./class-core-schema.js";
export type { IdentityState } from "./class-core-state.js";
export { capability, definePrototype, installFactory, removeFactorySurface } from "./class-core-support.js";
export { CLASS_TARGET } from "./class-core-symbols.js";

import type {
  AbstractRuntimeClass,
  AccessorOptions,
  AnyClassExtension,
  AssertionOptions,
  CallableClassCapability,
  ClassCloneCapability,
  ClassJsonCapability,
  ClassJsonOptions,
  ClassMethodsInput,
  ClassMixin,
  ClassMixinDefinition,
  ClassWithCapability,
  ConstructionMode,
  ConstructorRuntimeClass,
  DiffMethods,
  EqualsMethods,
  FactoryConstructionContext,
  FactoryOptions,
  FactoryValidationOptions,
  HashCodeMethods,
  MixinThisSurface,
  RuntimeClass,
} from "./class-types.js";

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
export type { FactoryReturnMode } from "../core/factory-policy.js";
export type {
  AbstractRuntimeClass,
  AccessorMember,
  AccessorOptions,
  AccessorVisibility,
  AggregateRuntimeClass,
  AnyDomainEvent,
  AssertionOptions,
  CallableClassCapability,
  ClassCapability,
  ClassConstructorInput,
  ClassCreateInput,
  ClassExtensionArgs,
  ClassExtensionBuilder,
  ClassExtensionFieldBuilder,
  ClassHydrateInput,
  ClassJsonCapability,
  ClassJsonOptions,
  ClassMethodsInput,
  ClassMixin,
  ClassMixinDefinition,
  ConfiguredRuntimeClass,
  ConstructionMode,
  ConstructorRuntimeClass,
  DomainEventBrand,
  DomainState,
  DomainStateCarrier,
  EventPublisher,
  FactoryConstructionContext,
  FactoryEither,
  FactoryFailure,
  FactoryOptions,
  FactoryOutcome,
  FactoryRuntimeClass,
  FactoryValidationOptions,
  InternalInstance,
  PendingEntityRuntimeClass,
  PublicInstance,
  RuntimeClass,
  ScalarValueObject,
  SoftDeleteCapability,
  SoftDeleteOptions,
  StandardEvent,
  TimestampCapability,
  TimestampOptions,
  VersionedCapability,
  VersionedOptions,
} from "./class-types.js";

type RuntimeClassTarget = RuntimeClass<ATS.AnyTypeSchema> & {
  readonly [CLASS_TARGET]: true;
};

/** Resolves the class target without making the internal marker public. */
export function getRuntimeClassTarget(value: unknown): RuntimeClassTarget | undefined {
  if (typeof value !== "function" || !(CLASS_TARGET in value)) return undefined;
  return value as RuntimeClassTarget;
}

export function classMixin<
  const TRequires extends ClassMethodsInput = {},
  const TFields extends ClassMethodsInput = {},
  const TMethods extends ClassMethodsInput = {},
>(definition: {
  readonly requires?: TRequires;
  readonly fields?: TFields;
  readonly methods?: TMethods & ThisType<MixinThisSurface<TFields, TRequires>>;
}): ClassMixin<TFields & TMethods, TRequires>;
/** Creates a reusable structural class extension with shared methods. */
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
export function createRuntimeClass<TSchema extends ATS.AnyTypeSchema>(
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
    factoryValidationOptIn: seed?.factoryValidationOptIn ?? false,
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
    policy: clonePolicyState(seed?.policy),
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
  let materializeCreation: ((input: unknown) => unknown) | undefined;
  const materialize = (input: unknown): unknown => {
    materializeCreation ??= compileMaterializer(creationSchema);
    return materializeCreation(boundaryInput(input));
  };
  let materializeHydrate: ((input: unknown) => unknown) | undefined;
  const materializeHydrated = (input: unknown): unknown => {
    materializeHydrate ??= compileMaterializer(hydrateSchema, { resolveDefaults: false });
    return materializeHydrate(boundaryInput(input));
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
  const classTarget = emitConstructor(
    layout,
    state.freezeInstances,
    state.aggregate,
    parse,
    constructionState
  ) as RuntimeClass<TSchema>;
  installTrustedMaterializer(classTarget, layout, state.freezeInstances, state.aggregate, TRUSTED_MATERIALIZER);
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
  installLifecycleMethods(classTarget, state, managedStorage, layout.domainState);
  installFieldDescriptorAccessors(classTarget, state.fieldPolicies);
  for (const method of state.methods) installMethodDefinition(classTarget, method);

  function registerClass(): void {
    const mutation = lifecycleArtifact(state.lifecycle);
    const domainStateLayout = state.encapsulateFields
      ? {
          storage: "symbol" as const,
          mutableFields: properties.filter((field) => !resolveWrappers(objectSchema.def.props[field]).readonly),
          readonlyFields: properties.filter((field) => resolveWrappers(objectSchema.def.props[field]).readonly),
        }
      : undefined;
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
      factoryValidationOptIn: state.factoryValidationOptIn,
      representation: "object",
      capabilities: state.capabilities.map((capability) => capability.kind),
      managedFields: state.managedFields,
      hydrateSchema,
      encapsulateFields: state.encapsulateFields,
      ...(domainStateLayout === undefined ? {} : { domainStateLayout }),
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
        policy.validationConfigured && policy.create
          ? policySafeParse()(boundaryInput(input))
          : policy.configured && !policy.create
            ? { success: true as const, data: parse(input) }
            : { success: true as const, data: materialize(input) };
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
    if (!policy.configured && state.factoryValidationOptIn) {
      return new construct(materialize(input), INTERNAL_CONSTRUCT, true);
    }
    if (!policy.configured) {
      if (
        state.lifecycle.timestamps === undefined &&
        state.lifecycle.softDelete === undefined &&
        state.lifecycle.versioned === undefined
      ) {
        return new construct(input, INTERNAL_CONSTRUCT);
      }
      return new construct(parse(input), INTERNAL_CONSTRUCT, true);
    }
    if (!policy.validationConfigured && policy.create) {
      let materialized: unknown;
      try {
        materialized = materialize(input);
      } catch (error) {
        if (policy.configured && error instanceof JITValidationError) {
          return policyFailure(policy, policyError(policy, error.issues)) as InstanceType<TThis>;
        }
        throw error;
      }
      if (policy.assert !== undefined) {
        const failure = policy.assert(materialized);
        if (failure !== undefined) return policyFailure(policy, failure) as InstanceType<TThis>;
      }
      return policySuccess(policy, new construct(materialized, INTERNAL_CONSTRUCT, true)) as InstanceType<TThis>;
    }
    if (!policy.create) {
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
        policy.validationConfigured && policy.hydrate
          ? policySafeHydrate()(boundaryInput(input))
          : policy.configured && !policy.hydrate
            ? { success: true as const, data: hydrateInput(input) }
            : { success: true as const, data: materializeHydrated(input) };
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
    if (!policy.configured && state.factoryValidationOptIn) {
      return new construct(materializeHydrated(input), INTERNAL_CONSTRUCT, true);
    }
    if (!policy.configured) return new construct(hydrateInput(input), INTERNAL_CONSTRUCT, true);
    if (!policy.validationConfigured && policy.hydrate) {
      let materialized: unknown;
      try {
        materialized = materializeHydrated(input);
      } catch (error) {
        if (policy.configured && error instanceof JITValidationError) {
          return policyFailure(policy, policyError(policy, error.issues)) as InstanceType<TThis>;
        }
        throw error;
      }
      if (policy.assert !== undefined) {
        const failure = policy.assert(materialized);
        if (failure !== undefined) return policyFailure(policy, failure) as InstanceType<TThis>;
      }
      return policySuccess(policy, new construct(materialized, INTERNAL_CONSTRUCT, true)) as InstanceType<TThis>;
    }
    if (!policy.hydrate) {
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
      value: (...extensions: readonly AnyClassExtension[]) =>
        materializeClassState(resolveClassExtensions(state, extensions)),
    },
    ...(state.aggregate
      ? {
          events: {
            enumerable: false,
            value: (...eventTypes: readonly Function[]) => {
              void eventTypes;
              return classTarget;
            },
          },
        }
      : {}),
    validate: {
      enumerable: false,
      value: (options?: FactoryValidationOptions) => {
        const policy = clonePolicyState(state.policy);
        applyValidationPolicy(policy, options);
        return materializeClassState({ ...state, policy });
      },
    },
    assert: {
      enumerable: false,
      value: (predicate: (query: QueryConditionBuilder<never>) => QueryConditionNode, options?: AssertionOptions) => {
        const policy = clonePolicyState(state.policy);
        applyAssertion(policy, state.schema, predicate, options);
        return materializeClassState({ ...state, policy });
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
/** Provides the JIT class factory operation for the supplied input. */
export interface ClassFactory {
  /** Creates a constructor-first Runtime Class from a schema. */
  <TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): ConstructorRuntimeClass<TSchema>;
  /** Creates an abstract Runtime Class base from a schema. */
  abstract<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): AbstractRuntimeClass<TSchema>;
  readonly equals: CallableClassCapability<EqualsMethods>;
  readonly hashCode: CallableClassCapability<HashCodeMethods>;
  readonly with: ClassWithCapability;
  readonly diff: CallableClassCapability<DiffMethods>;
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
}

/** Runtime type factory. Capabilities are installed separately on the prototype. */
export const classType: ClassFactory = Object.assign(classFactory, {
  abstract: abstractClass,
  equals: capability<EqualsMethods>("equals", (prototype, schema) => {
    definePrototype(prototype, "equals", compileEqualMethod(schema), true);
  }),
  hashCode: capability<HashCodeMethods>("hashCode", (prototype, schema) => {
    definePrototype(prototype, "hashCode", compileHashMethod(schema), true);
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
    return base as ClassWithCapability;
  })(),
  diff: capability<DiffMethods>("diff", (prototype, schema) => {
    definePrototype(prototype, "diff", compileDiffMethod(schema), true);
  }),
  clone: (() => {
    const base = capability<object>("clone", (prototype, schema) => {
      definePrototype(prototype, "clone", compileCloneMethod(schema), true);
    });
    return base as ClassCloneCapability;
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
});
export type { OverrideDescriptor } from "../classes/override.js";
export { override } from "../classes/override.js";
/** Provides the JIT class operation for the supplied input. */
export { classType as class };
