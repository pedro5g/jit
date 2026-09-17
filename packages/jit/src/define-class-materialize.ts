import { resolveWrappers } from "./compiler/resolvers/resolve-wrappers.js";
import type { QueryConditionNode } from "./core/ast/index.js";
import type * as ATS from "./core/ats/index.js";
import { createSchema, TypeName } from "./core/ats/index.js";
import { type FactoryReturnModeInput, normalizeFactoryReturnMode } from "./core/factory-policy.js";
import { defineClassExtensions } from "./define-class-extensions.js";
import {
  defineClassAssertion,
  definedLifecycleMutation,
  definedPolicyBase,
  removeDefinedNoConstructorFields,
  resolveDefinedPolicy,
} from "./define-class-policy.js";
import type { DefinedCapability, DefinedClassState } from "./define-class-state.js";
import { defineArtifactFailure, resolveDefinedFactoryName } from "./define-class-state.js";
import { JITError } from "./errors/index.js";
import type {
  AssertionOptions,
  ClassMethodsInput,
  ClassMixin,
  FactoryOptions,
  FactoryValidationOptions,
} from "./factories/class.js";
import type { QueryConditionBuilder } from "./factories/query.js";
import { registerArtifact } from "./runtime/artifact-registry.js";

export function defineRuntimeClass(state: DefinedClassState): unknown {
  const policy = resolveDefinedPolicy(state);
  const resolvedState = policy === state.policy ? state : { ...state, policy };
  const base = resolveWrappers(resolvedState.schema).base;
  const target = function definedRuntimeClass(): never {
    return defineArtifactFailure();
  };
  const materialize = function materializeDefinedClass(): never {
    return defineArtifactFailure();
  } as unknown as new (
    input: unknown,
    validated?: boolean
  ) => unknown;
  const mutation = definedLifecycleMutation(resolvedState.lifecycle);
  const creationSchema = removeDefinedNoConstructorFields(resolvedState.schema, resolvedState.fieldPolicies);
  const hydrateSchema = removeDefinedNoConstructorFields(resolvedState.schema, resolvedState.fieldPolicies);
  const domainStateLayout = createDefinedDomainStateLayout(resolvedState, base);

  registerDefinedClassArtifact(
    target,
    resolvedState,
    policy,
    creationSchema,
    hydrateSchema,
    mutation,
    domainStateLayout
  );
  defineDefinedClassSurface(target, materialize, resolvedState, policy);
  return target;
}

function createDefinedDomainStateLayout(
  state: DefinedClassState,
  base: ATS.AnyTypeSchema
):
  | {
      readonly storage: "symbol";
      readonly mutableFields: readonly string[];
      readonly readonlyFields: readonly string[];
    }
  | undefined {
  if (!state.encapsulateFields || base.type !== TypeName.object) return undefined;
  const fields = Object.keys((base as ATS.ObjectSchema).def.props);
  return {
    storage: "symbol",
    mutableFields: fields.filter((field) => !resolveWrappers((base as ATS.ObjectSchema).def.props[field]).readonly),
    readonlyFields: fields.filter((field) => resolveWrappers((base as ATS.ObjectSchema).def.props[field]).readonly),
  };
}

function registerDefinedClassArtifact(
  target: Function,
  state: DefinedClassState,
  policy: ReturnType<typeof resolveDefinedPolicy>,
  creationSchema: ATS.AnyTypeSchema,
  hydrateSchema: ATS.AnyTypeSchema,
  mutation: ReturnType<typeof definedLifecycleMutation>,
  domainStateLayout: ReturnType<typeof createDefinedDomainStateLayout>
): void {
  registerArtifact(target, {
    kind: "class",
    declaredSchema: state.declaredSchema,
    schema: state.schema,
    creationSchema,
    wireSchema: hydrateSchema,
    abstract: state.abstract,
    frozen: state.frozen || state.representation === "value",
    aggregate: state.aggregate,
    construction: state.construction,
    factoryValidationOptIn: state.factoryValidationOptIn,
    representation: state.representation,
    capabilities: state.capabilities,
    managedFields: state.managedFields,
    hydrateSchema,
    encapsulateFields: state.encapsulateFields,
    ...(domainStateLayout === undefined ? {} : { domainStateLayout }),
    ...(state.fieldPolicies.length === 0 ? {} : { fieldPolicies: state.fieldPolicies }),
    lifecycle: state.lifecycle,
    resolvedMembers: state.members.entries(),
    ...(mutation === undefined ? {} : { mutation }),
    ...(state.methods.length === 0 ? {} : { methods: state.methods }),
    ...(policy === undefined ? {} : { policy: { ...policy, validationConfigured: state.validationConfigured } }),
    ...(state.customFactories === undefined ? {} : { customFactories: state.customFactories }),
    ...(state.domainEvent === undefined ? {} : { domainEvent: state.domainEvent }),
    factories: state.factories,
    accessors: state.accessors as never,
  });
}

function defineDefinedClassSurface(
  target: Function,
  materialize: new (input: unknown, validated?: boolean) => unknown,
  state: DefinedClassState,
  policy: ReturnType<typeof resolveDefinedPolicy>
): void {
  const assertion = policy?.assertions === undefined ? undefined : () => undefined;
  Object.defineProperties(target, {
    schema: {
      enumerable: true,
      value: createSchema(TypeName.runtimeType, {
        innerType: state.schema,
        materialize,
        representation: state.representation,
        identifier: state.identifier,
        traits: definedRuntimeTraits(state, policy),
        assertion,
      }),
    },
    create: { enumerable: false, value: defineArtifactFailure },
    hydrate: { enumerable: false, value: defineArtifactFailure },
    extends: {
      enumerable: false,
      value: (...extensions: readonly (DefinedCapability | ClassMethodsInput | ClassMixin)[]) =>
        defineRuntimeClass(defineClassExtensions(state, extensions)),
    },
    ...(state.aggregate ? { events: { enumerable: false, value: () => target } } : {}),
    construction: {
      enumerable: false,
      value: (mode: "constructor" | "factory") => {
        if (policy !== undefined) {
          throw new JITError("INVALID_OPERATION", "Construction must be configured before validation or assertions");
        }
        return defineRuntimeClass({
          ...state,
          construction: mode,
          factories: mode === "factory" ? { create: "create", hydrate: "hydrate" } : { create: false, hydrate: false },
        });
      },
    },
    factories: {
      enumerable: false,
      value: (options: FactoryOptions) => configureDefinedFactories(state, options),
    },
    accessors: { enumerable: false, value: () => defineRuntimeClass(state) },
    validate: {
      enumerable: false,
      value: (options?: FactoryValidationOptions) => configureDefinedValidation(state, options),
    },
    assert: {
      enumerable: false,
      value: (predicate: (query: QueryConditionBuilder<unknown>) => QueryConditionNode, options?: AssertionOptions) =>
        defineRuntimeClass(defineClassAssertion(state, predicate, options)),
    },
  });
}

function definedRuntimeTraits(
  state: DefinedClassState,
  policy: ReturnType<typeof resolveDefinedPolicy>
): ATS.RuntimeTypeTraits<"object" | "value", boolean> {
  return {
    representation: state.representation,
    identifier: state.identifier,
    factoryPolicy: {
      configured: policy !== undefined,
      resultMode: policy?.result ?? "throw",
      resultModeExplicit: policy?.resultModeExplicit === true,
      resultModeInherited: policy?.resultModeInherited === true,
      errorType: undefined,
      priority: policy?.errorPriority ?? 1000,
      hasAssertions: policy?.assertions !== undefined,
      validationConfigured: state.validationConfigured,
    },
  } as unknown as ATS.RuntimeTypeTraits<"object" | "value", boolean>;
}

function configureDefinedFactories(state: DefinedClassState, options: FactoryOptions): unknown {
  const create = resolveDefinedFactoryName(options.create, "create", "create");
  const hydrate = resolveDefinedFactoryName(options.hydrate, "hydrate", "hydrate");
  return defineRuntimeClass({
    ...state,
    construction: "factory",
    factories: { create: create.name, hydrate: hydrate.name },
    customFactories: {
      ...(state.customFactories ?? {}),
      ...(create.implementation === undefined ? {} : { create: create.implementation }),
      ...(hydrate.implementation === undefined ? {} : { hydrate: hydrate.implementation }),
    },
  });
}

function configureDefinedValidation(state: DefinedClassState, options: FactoryValidationOptions | undefined): unknown {
  if (state.validationConfigured) {
    throw new JITError("INVALID_OPERATION", "Factory validation is already configured for this Runtime Class");
  }
  validateDefinedPolicyOptions(options);
  const previous = definedPolicyBase(state);
  return defineRuntimeClass({
    ...state,
    validationConfigured: true,
    policy: {
      ...previous,
      result:
        options?.result === undefined
          ? previous.result
          : normalizeFactoryReturnMode(options.result as FactoryReturnModeInput),
      create: options?.create ?? previous.create,
      hydrate: options?.hydrate ?? previous.hydrate,
      ...(options?.result === undefined ? {} : { resultModeExplicit: true, resultModeInherited: false }),
      ...(options?.maxIssues === undefined ? {} : { maxIssues: options.maxIssues }),
      ...(options?.priority === undefined ? {} : { errorPriority: options.priority, errorPriorityExplicit: true }),
      ...(options?.error === undefined ? {} : { error: options.error }),
    },
  });
}

function validateDefinedPolicyOptions(options: FactoryValidationOptions | undefined): void {
  if (options?.maxIssues !== undefined && (!Number.isSafeInteger(options.maxIssues) || options.maxIssues < 1)) {
    throw new RangeError("maxIssues must be a positive safe integer");
  }
  if (options?.priority !== undefined && !Number.isFinite(options.priority)) {
    throw new RangeError("priority must be a finite number");
  }
}
