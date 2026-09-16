import { type ClassMemberDefinition, isClassMemberDescriptor } from "../classes/member-descriptors.js";
import { isOverrideDescriptor } from "../classes/override.js";
import { compileEqual } from "../compiler/equal.js";
import { compileHash } from "../compiler/hash.js";
import {
  compileHydrator,
  compileMaterializer,
  compileSafeHydrator,
  compileValidator,
  compileValidatorSelection,
} from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import type { Hydrate } from "../core/ats/representations.js";
import { JITError, JITValidationError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import type { ClassMethodDefinition, InstalledScalarMethod } from "./class-core-state.js";
import {
  definePrototype,
  installFactory,
  installMethodDefinition,
  resolveFactoryOption,
} from "./class-core-support.js";
import { CLASS_TARGET } from "./class-core-symbols.js";
import {
  createClassExtensionBuilder,
  isClassCapability,
  isClassExtensionFactory,
  isClassMixin,
  RESERVED_EXTENSION_NAMES,
  SCALAR_MEMBERS,
} from "./class-extensions.js";
import { INTERNAL_CONSTRUCT, TRUSTED_MATERIALIZER } from "./class-layout.js";
import type { FactoryPolicyState } from "./class-policy.js";
import {
  applyValidationPolicy,
  clonePolicyState,
  policyArtifact,
  policyError,
  policyFailure,
  policySuccess,
  runtimeTypeTraits,
  type SafeParse,
} from "./class-policy.js";
import type {
  AnyClassCapability,
  AnyClassExtension,
  ClassMethodsInput,
  ClassMixin,
  ConstructionMode,
  CreateArguments,
  FactoryOptions,
  FactoryValidationOptions,
  RuntimeClass,
  ScalarFactoryRuntimeClass,
  ScalarValueObject,
} from "./class-types.js";

interface ScalarClassSeed {
  readonly policy?: FactoryPolicyState;
  readonly capabilities?: readonly AnyClassCapability[];
  readonly methods?: readonly InstalledScalarMethod[];
  readonly factoryNames?: { readonly create: string | false; readonly hydrate: string | false };
  readonly customFactories?: { readonly create?: Function; readonly hydrate?: Function };
  readonly construction?: ConstructionMode;
  readonly constructionConfigured?: boolean;
  readonly factoriesConfigured?: boolean;
}

/** @internal Materializes the shared scalar Value Object runtime artifact. */
export function createScalarValueObject<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  identifier: boolean,
  isAbstract: boolean,
  seed?: ScalarClassSeed
): ScalarFactoryRuntimeClass<TSchema, ScalarValueObject<ATS.TypeofSchema<TSchema>>> {
  const parse = compileValidator(schema).parse;
  const hydrateState = compileHydrator(schema);
  const materialize = compileMaterializer(schema);
  const materializeHydrated = compileMaterializer(schema, { resolveDefaults: false });
  const policy = clonePolicyState(seed?.policy);
  let safeParse: ((input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>) | undefined;
  let safeHydrate: ((state: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>) | undefined;
  const equal = compileEqual(schema) as (left: unknown, right: unknown) => boolean;
  const hash = compileHash(schema) as (value: unknown) => number;
  const constructionState: { mode: ConstructionMode } = { mode: seed?.construction ?? "factory" };
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
  const installedCapabilities = [
    "equals",
    "hashCode",
    ...(seed?.capabilities ?? []).map((capability) => capability.kind),
  ];
  const installedCapabilityValues = [...(seed?.capabilities ?? [])];
  const installedMethods: {
    readonly name: string;
    readonly kind: "method" | "get" | "set";
    readonly source: Function;
  }[] = [...(seed?.methods ?? [])];
  const installedMethodNames = new Set<string>(SCALAR_MEMBERS);
  for (const method of installedMethods) installedMethodNames.add(method.name);
  let factoryNames: { create: string | false; hydrate: string | false } = seed?.factoryNames ?? {
    create: "create",
    hydrate: "hydrate",
  };
  let customFactories: { create?: Function; hydrate?: Function } = seed?.customFactories ?? {};
  let constructionConfigured = seed?.constructionConfigured ?? false;
  let factoriesConfigured = seed?.factoriesConfigured ?? false;

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
        policy.validationConfigured && policy.create
          ? (() => {
              safeParse ??= compileValidatorSelection(schema, ["safeParse"], {}).safeParse as (
                input: unknown
              ) => SafeParse<ATS.TypeofSchema<TSchema>>;
              return safeParse(args[0]);
            })()
          : policy.configured && !policy.create
            ? { success: true as const, data: parse(args[0]) }
            : { success: true as const, data: materialize(args[0]) };
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
    if (!policy.configured) return new construct(materialize(args[0]), INTERNAL_CONSTRUCT, true);
    if (!policy.create) return new construct(args[0], INTERNAL_CONSTRUCT);
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
        policy.validationConfigured && policy.hydrate
          ? (() => {
              safeHydrate ??= compileSafeHydrator(schema) as (state: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
              return safeHydrate(state);
            })()
          : policy.configured && !policy.hydrate
            ? { success: true as const, data: hydrateState(state) }
            : { success: true as const, data: materializeHydrated(state) };
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
    if (!policy.configured) {
      return new construct(materializeHydrated(state), INTERNAL_CONSTRUCT, true);
    }
    if (!policy.hydrate) {
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
      factoryValidationOptIn: true,
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
      value: (...extensions: readonly AnyClassExtension[]) => {
        for (const rawExtension of extensions) {
          let extension: AnyClassCapability | ClassMethodsInput | ClassMixin;
          if (isClassExtensionFactory(rawExtension)) extension = rawExtension(createClassExtensionBuilder());
          else if (isClassMixin(rawExtension)) extension = rawExtension();
          else extension = rawExtension;
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
            installedCapabilityValues.push(extension);
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
        const nextPolicy = clonePolicyState(policy);
        applyValidationPolicy(nextPolicy, options);
        return createScalarValueObject(schema, identifier, isAbstract, {
          policy: nextPolicy,
          capabilities: installedCapabilityValues,
          methods: installedMethods,
          factoryNames,
          customFactories,
          construction: constructionState.mode,
          constructionConfigured,
          factoriesConfigured,
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
  for (const capability of seed?.capabilities ?? []) capability.install(classTarget, schema);
  for (const method of seed?.methods ?? []) {
    const descriptor: PropertyDescriptor = {
      configurable: true,
      enumerable: false,
    };
    if (method.kind === "method") descriptor.value = method.source;
    else if (method.kind === "get") descriptor.get = method.source as () => unknown;
    else descriptor.set = method.source as (value: unknown) => void;
    Object.defineProperty(classTarget.prototype, method.name, descriptor);
  }
  register();
  return classTarget as unknown as ScalarFactoryRuntimeClass<TSchema, ScalarValueObject<ATS.TypeofSchema<TSchema>>>;
}

/** Provides the JIT class factory operation for the supplied input. */

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
