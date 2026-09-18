import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { installScalarExtension } from "./class-core-scalar-extensions.js";
import type { ScalarClassSeed, ScalarConfigurationState } from "./class-core-state.js";
import { assertConstructionConfiguration, installFactory, resolveFactoryOption } from "./class-core-support.js";
import { CLASS_TARGET } from "./class-core-symbols.js";
import {
  createClassExtensionBuilder,
  isClassCapability,
  isClassExtensionFactory,
  isClassMixin,
} from "./class-extensions.js";
import { applyValidationPolicy, clonePolicyState, policyArtifact, runtimeTypeTraits } from "./class-policy.js";
import type {
  AnyClassCapability,
  AnyClassExtension,
  ClassMethodsInput,
  ClassMixin,
  ConstructionMode,
  FactoryOptions,
  FactoryValidationOptions,
  RuntimeClass,
  ScalarFactoryRuntimeClass,
  ScalarValueObject,
} from "./class-types.js";

export interface MutableScalarSurface<TSchema extends ATS.AnyTypeSchema> extends ScalarConfigurationState {
  readonly schema: TSchema;
  readonly identifier: boolean;
  readonly isAbstract: boolean;
  readonly classTarget: ScalarFactoryRuntimeClass<TSchema, ScalarValueObject<ATS.TypeofSchema<TSchema>>>;
  readonly create: Function;
  readonly hydrate: Function;
  readonly recreate: (seed: ScalarClassSeed) => unknown;
}

export function installScalarSurface<TSchema extends ATS.AnyTypeSchema>(state: MutableScalarSurface<TSchema>): void {
  Object.defineProperties(state.classTarget, {
    [CLASS_TARGET]: { enumerable: false, value: true },
    schema: {
      configurable: true,
      enumerable: true,
      value: scalarSchema(state),
    },
    create: { configurable: true, enumerable: false, value: state.create },
    hydrate: { configurable: true, enumerable: false, value: state.hydrate },
    extends: {
      enumerable: false,
      value: (...extensions: readonly AnyClassExtension[]) => extendScalar(state, extensions),
    },
    factories: {
      enumerable: false,
      value: (options: FactoryOptions) => configureScalarFactories(state, options),
    },
    construction: {
      enumerable: false,
      value: (mode: ConstructionMode) => configureScalarConstruction(state, mode),
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
        const nextPolicy = clonePolicyState(state.policy);
        applyValidationPolicy(nextPolicy, options);
        return state.recreate({
          policy: nextPolicy,
          capabilities: state.installedCapabilityValues,
          methods: state.installedMethods,
          factoryNames: state.factoryNames,
          customFactories: state.customFactories,
          construction: state.constructionState.mode,
          constructionConfigured: state.constructionConfigured,
          factoriesConfigured: state.factoriesConfigured,
        });
      },
    },
    assert: {
      enumerable: false,
      value: () => {
        throw new JITError("INVALID_OPERATION", "Assertions describe object fields; refine the scalar schema instead");
      },
    },
  });
  installScalarFactory(state.classTarget, false, state.factoryNames.create, state.create);
  installScalarFactory(state.classTarget, false, state.factoryNames.hydrate, state.hydrate);
}

export function registerScalarArtifact<TSchema extends ATS.AnyTypeSchema>(state: MutableScalarSurface<TSchema>): void {
  Object.defineProperty(state.classTarget, "schema", {
    configurable: true,
    enumerable: true,
    value: scalarSchema(state),
  });
  registerArtifact(state.classTarget, {
    kind: "class",
    schema: state.schema,
    wireSchema: state.schema,
    abstract: state.isAbstract,
    frozen: true,
    aggregate: false,
    construction: state.constructionState.mode,
    factoryValidationOptIn: true,
    representation: "value",
    ...policyArtifact(state.policy),
    capabilities: state.installedCapabilities,
    ...(state.installedMethods.length === 0 ? {} : { methods: state.installedMethods }),
    factories: state.factoryNames,
    ...(state.customFactories.create === undefined && state.customFactories.hydrate === undefined
      ? {}
      : { customFactories: state.customFactories }),
  });
}

function scalarSchema<TSchema extends ATS.AnyTypeSchema>(
  state: MutableScalarSurface<TSchema>
): ATS.RuntimeTypeSchema<
  TSchema,
  ScalarValueObject<ATS.TypeofSchema<TSchema>>,
  "value",
  boolean,
  ATS.RuntimeTypeTraits<"value", boolean>
> {
  return createSchema(TypeName.runtimeType, {
    innerType: state.schema,
    materialize: state.classTarget,
    representation: "value",
    identifier: state.identifier,
    traits: runtimeTypeTraits("value", state.identifier, state.policy),
    assertion: undefined,
  }) as unknown as ATS.RuntimeTypeSchema<
    TSchema,
    ScalarValueObject<ATS.TypeofSchema<TSchema>>,
    "value",
    boolean,
    ATS.RuntimeTypeTraits<"value", boolean>
  >;
}

function extendScalar<TSchema extends ATS.AnyTypeSchema>(
  state: MutableScalarSurface<TSchema>,
  extensions: readonly AnyClassExtension[]
): ScalarFactoryRuntimeClass<TSchema, ScalarValueObject<ATS.TypeofSchema<TSchema>>> {
  for (const rawExtension of extensions) {
    const extension = resolveScalarExtension(rawExtension);
    if (isClassCapability(extension)) {
      installScalarCapability(state, extension);
      continue;
    }
    installScalarExtension(
      state.classTarget,
      extension as ClassMethodsInput,
      state.installedMethods,
      state.installedMethodNames
    );
  }
  registerScalarArtifact(state);
  return state.classTarget;
}

function resolveScalarExtension(extension: AnyClassExtension): AnyClassCapability | ClassMethodsInput | ClassMixin {
  if (isClassExtensionFactory(extension)) return extension(createClassExtensionBuilder());
  if (isClassMixin(extension)) return extension();
  return extension;
}

function installScalarCapability<TSchema extends ATS.AnyTypeSchema>(
  state: MutableScalarSurface<TSchema>,
  capability: AnyClassCapability
): void {
  if (state.installedCapabilities.includes(capability.kind)) {
    throw new JITError("INVALID_OPERATION", `Class capability ${JSON.stringify(capability.kind)} is already installed`);
  }
  const before = new Set(Object.getOwnPropertyNames(state.classTarget.prototype));
  capability.install(state.classTarget, state.schema);
  for (const name of Object.getOwnPropertyNames(state.classTarget.prototype)) {
    if (!before.has(name)) state.installedMethodNames.add(name);
  }
  state.installedCapabilities.push(capability.kind);
  state.installedCapabilityValues.push(capability);
}

function configureScalarFactories<TSchema extends ATS.AnyTypeSchema>(
  state: MutableScalarSurface<TSchema>,
  options: FactoryOptions
): ScalarFactoryRuntimeClass<TSchema, ScalarValueObject<ATS.TypeofSchema<TSchema>>> {
  if (state.factoriesConfigured)
    throw new JITError("INVALID_OPERATION", "Factories are already configured for this Runtime Class");
  if (state.constructionConfigured)
    throw new JITError("INVALID_OPERATION", "Construction is already configured for this Runtime Class");
  const createOption = resolveFactoryOption(options.create, state.factoryNames.create, "create");
  const hydrateOption = resolveFactoryOption(options.hydrate, state.factoryNames.hydrate, "hydrate");
  const next = { create: createOption.name, hydrate: hydrateOption.name };
  if (next.create === false && next.hydrate === false) {
    throw new JITError("INVALID_OPERATION", "Factory construction requires at least one create or hydrate factory");
  }
  installScalarFactory(state.classTarget, state.factoryNames.create, next.create, state.create);
  installScalarFactory(state.classTarget, state.factoryNames.hydrate, next.hydrate, state.hydrate);
  state.factoriesConfigured = true;
  state.factoryNames = next;
  state.customFactories = {
    ...(createOption.implementation === undefined ? {} : { create: createOption.implementation }),
    ...(hydrateOption.implementation === undefined ? {} : { hydrate: hydrateOption.implementation }),
  };
  registerScalarArtifact(state);
  return state.classTarget;
}

function configureScalarConstruction<TSchema extends ATS.AnyTypeSchema>(
  state: MutableScalarSurface<TSchema>,
  mode: ConstructionMode
): ScalarFactoryRuntimeClass<TSchema, ScalarValueObject<ATS.TypeofSchema<TSchema>>> {
  assertConstructionConfiguration(state, mode);
  state.constructionConfigured = true;
  state.constructionState.mode = mode;
  if (mode === "factory") {
    installScalarFactory(state.classTarget, state.factoryNames.create, "create", state.create);
    installScalarFactory(state.classTarget, state.factoryNames.hydrate, "hydrate", state.hydrate);
    state.factoryNames = { create: "create", hydrate: "hydrate" };
  } else {
    installScalarFactory(state.classTarget, state.factoryNames.create, false, state.create);
    installScalarFactory(state.classTarget, state.factoryNames.hydrate, false, state.hydrate);
    state.factoryNames = { create: false, hydrate: false };
  }
  registerScalarArtifact(state);
  return state.classTarget;
}

function installScalarFactory(
  classTarget: Function,
  previous: string | false,
  next: string | false,
  factory: Function
): void {
  installFactory(classTarget as unknown as RuntimeClass<ATS.AnyTypeSchema>, previous, next, factory);
}
