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
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { createRuntimeClassState, prepareRuntimeClass } from "./class-core-materialize.js";
import { createClassInstance, hydrateClassInstance } from "./class-core-operations.js";
import type { ClassDefinitionState, ClassStateSeed } from "./class-core-state.js";
import { capability, definePrototype } from "./class-core-support.js";
import {
  installRuntimeClassFeatures,
  installRuntimeClassSurface,
  registerRuntimeClassArtifact,
} from "./class-core-surface.js";
import { CLASS_TARGET } from "./class-core-symbols.js";
import { CLASS_MIXIN } from "./class-extensions.js";
import { INTERNAL_CONSTRUCT, type ResolvedAccessors } from "./class-layout.js";
import { isFailure } from "./class-policy.js";

export { createScalarValueObject } from "./class-core-scalar.js";
export { isIdentifierSchema } from "./class-core-schema.js";
export type { IdentityState } from "./class-core-state.js";
export { capability, definePrototype, installFactory, removeFactorySurface } from "./class-core-support.js";
export { CLASS_TARGET } from "./class-core-symbols.js";

import type {
  AbstractRuntimeClass,
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
  const state = createRuntimeClassState(
    schema,
    isAbstract,
    freezeInstances,
    aggregate,
    construction,
    encapsulateFields,
    accessors,
    seed
  );
  const build = prepareRuntimeClass<TSchema>(state);
  installRuntimeClassFeatures(build);
  const create = function create<TThis extends RuntimeClass<TSchema>>(
    this: TThis,
    input: import("../core/ats/input.js").Input<TSchema>
  ): InstanceType<TThis> {
    return createClassInstance(build.operationContext, this, input);
  };
  const hydrate = function hydrate<TThis extends RuntimeClass<TSchema>>(
    this: TThis,
    input: import("../core/ats/representations.js").Hydrate<TSchema>
  ): InstanceType<TThis> {
    return hydrateClassInstance(build.operationContext, this, input);
  };
  installRuntimeClassSurface(build, materializeClassState, create, hydrate);
  registerRuntimeClassArtifact(build);
  return build.classTarget;
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
