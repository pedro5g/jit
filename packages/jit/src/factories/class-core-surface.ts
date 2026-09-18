import { resolveEffectiveObjectSchema } from "../classes/effective-schema.js";
import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import { compileSerializeWithRootAccess } from "../compiler/serialize.js";
import type { QueryConditionNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { capabilityMemberNames, resolveClassExtensions } from "./class-core-extensions-resolution.js";
import { installLifecycleMethods, lifecycleArtifact } from "./class-core-lifecycle.js";
import type { RuntimeClassBuild } from "./class-core-materialize.js";
import type { ClassDefinitionState } from "./class-core-state.js";
import {
  assertConstructionConfiguration,
  definePrototype,
  installFactory,
  installMethodDefinition,
  resolveFactoryOption,
} from "./class-core-support.js";
import { CLASS_TARGET } from "./class-core-symbols.js";
import { installFieldDescriptorAccessors, resolveAccessors } from "./class-layout.js";
import {
  applyAssertion,
  applyValidationPolicy,
  clonePolicyState,
  policyArtifact,
  runtimeTypeTraits,
} from "./class-policy.js";
import type {
  AccessorOptions,
  AnyClassCapability,
  AnyClassExtension,
  AssertionOptions,
  ConstructionMode,
  FactoryOptions,
  FactoryValidationOptions,
  RuntimeClass,
} from "./class-types.js";

export type RuntimeClassMaterializer = (state: ClassDefinitionState) => RuntimeClass<ATS.AnyTypeSchema>;

export function installRuntimeClassFeatures<TSchema extends ATS.AnyTypeSchema>(
  build: RuntimeClassBuild<TSchema>
): void {
  for (const capability of build.state.capabilities) {
    if (capability.kind === "class.json") installJsonCapability(build, capability);
    else capability.install(build.classTarget, build.state.schema);
  }
  installLifecycleMethods(build.classTarget, build.state, build.managedStorage, build.layout.domainState);
  installFieldDescriptorAccessors(build.classTarget, build.state.fieldPolicies);
  for (const method of build.state.methods) installMethodDefinition(build.classTarget, method);
}

function installJsonCapability<TSchema extends ATS.AnyTypeSchema>(
  build: RuntimeClassBuild<TSchema>,
  capability: AnyClassCapability
): void {
  const method = capabilityMemberNames(capability)[0] ?? "toJson";
  const jsonFields = Object.keys(resolveEffectiveObjectSchema(build.hydrateSchema).def.props);
  const rootPropertyAccess = new Map<string, string>();
  const bindings: symbol[] = [];
  for (const field of jsonFields) {
    const managed = build.managedStorage.get(field);
    if (managed === undefined) rootPropertyAccess.set(field, `value[${JSON.stringify(field)}]`);
    else {
      const index = bindings.length;
      bindings.push(managed.value);
      rootPropertyAccess.set(field, `value[__root${index}]`);
    }
  }
  const stringify = compileSerializeWithRootAccess(build.hydrateSchema, rootPropertyAccess, bindings);
  definePrototype(
    build.classTarget.prototype,
    method,
    function toJson(this: unknown) {
      return stringify(this as never);
    },
    true
  );
}

export function registerRuntimeClassArtifact<TSchema extends ATS.AnyTypeSchema>(
  build: RuntimeClassBuild<TSchema>
): void {
  const { state, policy, classTarget, objectSchema, properties } = build;
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
    creationSchema: build.creationSchema,
    wireSchema: build.hydrateSchema,
    abstract: state.isAbstract,
    frozen: state.freezeInstances,
    aggregate: state.aggregate,
    construction: state.construction,
    factoryValidationOptIn: state.factoryValidationOptIn,
    representation: "object",
    capabilities: state.capabilities.map((capability) => capability.kind),
    managedFields: state.managedFields,
    hydrateSchema: build.hydrateSchema,
    encapsulateFields: state.encapsulateFields,
    ...(domainStateLayout === undefined ? {} : { domainStateLayout }),
    ...(state.fieldPolicies.size === 0 ? {} : { fieldPolicies: serializedFieldPolicies(state) }),
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

function serializedFieldPolicies(state: ClassDefinitionState) {
  return [...state.fieldPolicies.entries()].map(([name, policy]) => ({
    name,
    visibility: policy.visibility,
    getter: policy.getter !== false,
    setter: policy.setter !== false,
    noConstructor: policy.noConstructor,
  }));
}

export function installRuntimeClassSurface<TSchema extends ATS.AnyTypeSchema>(
  build: RuntimeClassBuild<TSchema>,
  materialize: RuntimeClassMaterializer,
  create: Function,
  hydrate: Function
): void {
  const { state, classTarget, properties } = build;
  Object.defineProperties(classTarget, {
    [CLASS_TARGET]: { enumerable: false, value: true },
    schema: { enumerable: true, value: runtimeClassSchema(build) },
    extends: {
      enumerable: false,
      value: (...extensions: readonly AnyClassExtension[]) => materialize(resolveClassExtensions(state, extensions)),
    },
    ...(state.aggregate ? { events: { enumerable: false, value: () => classTarget } } : {}),
    validate: {
      enumerable: false,
      value: (options?: FactoryValidationOptions) => {
        const nextPolicy = clonePolicyState(state.policy);
        applyValidationPolicy(nextPolicy, options);
        return materialize({ ...state, policy: nextPolicy });
      },
    },
    assert: {
      enumerable: false,
      value: (
        predicate: (query: import("./query.js").QueryConditionBuilder<never>) => QueryConditionNode,
        options?: AssertionOptions
      ) => {
        const nextPolicy = clonePolicyState(state.policy);
        applyAssertion(nextPolicy, state.schema, predicate, options);
        return materialize({ ...state, policy: nextPolicy });
      },
    },
    factories: {
      enumerable: false,
      value: (options: FactoryOptions) => configureFactories(state, options, materialize),
    },
    construction: {
      enumerable: false,
      value: (mode: ConstructionMode) => configureConstruction(state, mode, materialize),
    },
    accessors: {
      enumerable: false,
      value: (options: AccessorOptions<TSchema>) => configureAccessors(state, properties, options, materialize),
    },
  });
  installFactory(classTarget, false, state.factoryNames.create, create);
  installFactory(classTarget, false, state.factoryNames.hydrate, hydrate);
}

function runtimeClassSchema<TSchema extends ATS.AnyTypeSchema>(
  build: RuntimeClassBuild<TSchema>
): ATS.RuntimeTypeSchema<TSchema, ATS.TypeofSchema<TSchema>, "object", false, ATS.RuntimeTypeTraits<"object", false>> {
  const { state, policy, classTarget } = build;
  return createSchema(TypeName.runtimeType, {
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
  >;
}

function configureFactories(
  state: ClassDefinitionState,
  options: FactoryOptions,
  materialize: RuntimeClassMaterializer
): RuntimeClass<ATS.AnyTypeSchema> {
  if (state.factoriesConfigured)
    throw new JITError("INVALID_OPERATION", "Factories are already configured for this Runtime Class");
  if (state.constructionConfigured)
    throw new JITError("INVALID_OPERATION", "Construction is already configured for this Runtime Class");
  const createOption = resolveFactoryOption(options.create, state.factoryNames.create, "create");
  const hydrateOption = resolveFactoryOption(options.hydrate, state.factoryNames.hydrate, "hydrate");
  const names = { create: createOption.name, hydrate: hydrateOption.name };
  if (names.create === false && names.hydrate === false) {
    throw new JITError("INVALID_OPERATION", "Factory construction requires at least one create or hydrate factory");
  }
  return materialize({
    ...state,
    construction: "factory",
    factoriesConfigured: true,
    factoryNames: names,
    customFactories: mergeCustomFactories(state, createOption.implementation, hydrateOption.implementation),
  });
}

function mergeCustomFactories(
  state: ClassDefinitionState,
  create: Function | undefined,
  hydrate: Function | undefined
): { readonly create?: Function; readonly hydrate?: Function } {
  return {
    ...(state.customFactories.create === undefined && create === undefined
      ? {}
      : { create: create ?? state.customFactories.create }),
    ...(state.customFactories.hydrate === undefined && hydrate === undefined
      ? {}
      : { hydrate: hydrate ?? state.customFactories.hydrate }),
  };
}

function configureConstruction(
  state: ClassDefinitionState,
  mode: ConstructionMode,
  materialize: RuntimeClassMaterializer
): RuntimeClass<ATS.AnyTypeSchema> {
  assertConstructionConfiguration(state, mode);
  return materialize({
    ...state,
    construction: mode,
    constructionConfigured: true,
    factoryNames: mode === "factory" ? { create: "create", hydrate: "hydrate" } : { create: false, hydrate: false },
  });
}

function configureAccessors<TSchema extends ATS.AnyTypeSchema>(
  state: ClassDefinitionState,
  properties: readonly string[],
  options: AccessorOptions<TSchema>,
  materialize: RuntimeClassMaterializer
): RuntimeClass<ATS.AnyTypeSchema> {
  if (state.accessors !== undefined) {
    throw new JITError("INVALID_OPERATION", "Accessors are already configured for this Runtime Class");
  }
  return materialize({ ...state, accessors: resolveAccessors(properties, options) });
}
