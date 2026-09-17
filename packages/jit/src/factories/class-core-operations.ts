import type * as ATS from "../core/ats/index.js";
import type { Input } from "../core/ats/input.js";
import type { Hydrate } from "../core/ats/representations.js";
import { JITError, JITValidationError } from "../errors/index.js";
import type { ClassDefinitionState } from "./class-core-state.js";
import { INTERNAL_CONSTRUCT } from "./class-layout.js";
import { type FactoryPolicyState, policyError, policyFailure, policySuccess, type SafeParse } from "./class-policy.js";
import type { FactoryConstructionContext, RuntimeClass } from "./class-types.js";

export interface RuntimeClassOperationContext<TSchema extends ATS.AnyTypeSchema> {
  readonly state: ClassDefinitionState;
  readonly policy: FactoryPolicyState;
  readonly classTarget: RuntimeClass<TSchema>;
  readonly boundaryInput: (input: unknown) => unknown;
  readonly parse: (input: unknown) => unknown;
  readonly hydrateInput: (input: unknown) => unknown;
  readonly materialize: (input: unknown) => unknown;
  readonly materializeHydrated: (input: unknown) => unknown;
  readonly policySafeParse: () => (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
  readonly policySafeHydrate: () => (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
}

export function createClassInstance<TSchema extends ATS.AnyTypeSchema, TThis extends RuntimeClass<TSchema>>(
  context: RuntimeClassOperationContext<TSchema>,
  receiver: TThis,
  input: Input<TSchema>
): InstanceType<TThis> {
  const { state, policy, classTarget } = context;
  assertCanCreate(state, receiver, classTarget);
  const construct = receiver as unknown as new (
    input: unknown,
    token: symbol,
    validated?: boolean
  ) => InstanceType<TThis>;
  const customFactory = state.customFactories.create;
  if (customFactory !== undefined) return createWithCustomFactory(context, receiver, construct, input, customFactory);
  if (!policy.configured && state.factoryValidationOptIn) {
    return new construct(context.materialize(input), INTERNAL_CONSTRUCT, true);
  }
  if (!policy.configured) return createWithoutPolicy(context, construct, input);
  if (!policy.validationConfigured && policy.create) {
    return createWithMaterialization(context, construct, input);
  }
  if (!policy.create) return createWithoutFactoryValidation(context, construct, input);
  if (policy.maxIssues === undefined && policy.assert === undefined) {
    return createWithFailFastValidation(context, construct, input);
  }
  return createWithDiagnosticValidation(context, construct, input);
}

export function hydrateClassInstance<TSchema extends ATS.AnyTypeSchema, TThis extends RuntimeClass<TSchema>>(
  context: RuntimeClassOperationContext<TSchema>,
  receiver: TThis,
  input: Hydrate<TSchema>
): InstanceType<TThis> {
  const { state, policy, classTarget } = context;
  assertCanHydrate(state, receiver, classTarget);
  const construct = receiver as unknown as new (
    input: unknown,
    token: symbol,
    validated?: boolean
  ) => InstanceType<TThis>;
  const customFactory = state.customFactories.hydrate;
  if (customFactory !== undefined) return hydrateWithCustomFactory(context, receiver, construct, input, customFactory);
  if (!policy.configured && state.factoryValidationOptIn) {
    return new construct(context.materializeHydrated(input), INTERNAL_CONSTRUCT, true);
  }
  if (!policy.configured) return new construct(context.hydrateInput(input), INTERNAL_CONSTRUCT, true);
  if (!policy.validationConfigured && policy.hydrate) {
    return hydrateWithMaterialization(context, construct, input);
  }
  if (!policy.hydrate) return new construct(context.hydrateInput(input), INTERNAL_CONSTRUCT, true);
  if (policy.maxIssues === undefined && policy.assert === undefined) {
    return hydrateWithFailFastValidation(context, construct, input);
  }
  return hydrateWithDiagnosticValidation(context, construct, input);
}

function assertCanCreate<TSchema extends ATS.AnyTypeSchema>(
  state: ClassDefinitionState,
  receiver: RuntimeClass<TSchema>,
  classTarget: RuntimeClass<TSchema>
): void {
  if (state.isAbstract && receiver === classTarget) {
    throw new JITError("INVALID_OPERATION", "Cannot create an instance of an abstract JIT class");
  }
  assertIdentity(state);
}

function assertCanHydrate<TSchema extends ATS.AnyTypeSchema>(
  state: ClassDefinitionState,
  receiver: RuntimeClass<TSchema>,
  classTarget: RuntimeClass<TSchema>
): void {
  if (state.isAbstract && receiver === classTarget) {
    throw new JITError("INVALID_OPERATION", "Cannot hydrate an instance of an abstract JIT class");
  }
  assertIdentity(state);
}

function assertIdentity(state: ClassDefinitionState): void {
  if (state.identity.state === "pending") {
    throw new JITError("DDD_IDENTITY_MISSING", "Entity identity is pending a structural identifier extension");
  }
  if (state.identity.state === "ambiguous") {
    throw new JITError("DDD_IDENTITY_AMBIGUOUS", "Entity identity has multiple structural identifier candidates");
  }
}

function createWithoutPolicy<TSchema extends ATS.AnyTypeSchema, TInstance>(
  context: RuntimeClassOperationContext<TSchema>,
  construct: new (input: unknown, token: symbol, validated?: boolean) => TInstance,
  input: Input<TSchema>
): TInstance {
  const { state } = context;
  if (
    state.lifecycle.timestamps === undefined &&
    state.lifecycle.softDelete === undefined &&
    state.lifecycle.versioned === undefined
  ) {
    return new construct(input, INTERNAL_CONSTRUCT);
  }
  return new construct(context.parse(input), INTERNAL_CONSTRUCT, true);
}

function createWithoutFactoryValidation<TSchema extends ATS.AnyTypeSchema, TInstance>(
  context: RuntimeClassOperationContext<TSchema>,
  construct: new (input: unknown, token: symbol, validated?: boolean) => TInstance,
  input: Input<TSchema>
): TInstance {
  return createWithoutPolicy(context, construct, input);
}

function createWithMaterialization<TSchema extends ATS.AnyTypeSchema, TInstance>(
  context: RuntimeClassOperationContext<TSchema>,
  construct: new (input: unknown, token: symbol, validated?: boolean) => TInstance,
  input: Input<TSchema>
): TInstance {
  const { policy } = context;
  let materialized: unknown;
  try {
    materialized = context.materialize(input);
  } catch (error) {
    if (error instanceof JITValidationError)
      return policyFailure(policy, policyError(policy, error.issues)) as TInstance;
    throw error;
  }
  const assertionFailure = runAssertion(policy, materialized);
  if (assertionFailure !== undefined) return policyFailure(policy, assertionFailure) as TInstance;
  return policySuccess(policy, new construct(materialized, INTERNAL_CONSTRUCT, true)) as TInstance;
}

function createWithFailFastValidation<TSchema extends ATS.AnyTypeSchema, TInstance>(
  context: RuntimeClassOperationContext<TSchema>,
  construct: new (input: unknown, token: symbol, validated?: boolean) => TInstance,
  input: Input<TSchema>
): TInstance {
  const { policy } = context;
  try {
    return policySuccess(policy, new construct(context.parse(input), INTERNAL_CONSTRUCT, true)) as TInstance;
  } catch (error) {
    if (!(error instanceof JITValidationError)) throw error;
    return policyFailure(policy, policyError(policy, error.issues)) as TInstance;
  }
}

function createWithDiagnosticValidation<TSchema extends ATS.AnyTypeSchema, TInstance>(
  context: RuntimeClassOperationContext<TSchema>,
  construct: new (input: unknown, token: symbol, validated?: boolean) => TInstance,
  input: Input<TSchema>
): TInstance {
  const { policy } = context;
  const parsed = context.policySafeParse()(context.boundaryInput(input));
  if (!parsed.success) return policyFailure(policy, policyError(policy, parsed.issues)) as TInstance;
  const assertionFailure = runAssertion(policy, parsed.data);
  if (assertionFailure !== undefined) return policyFailure(policy, assertionFailure) as TInstance;
  return policySuccess(policy, new construct(parsed.data, INTERNAL_CONSTRUCT, true)) as TInstance;
}

function createWithCustomFactory<TSchema extends ATS.AnyTypeSchema, TThis extends RuntimeClass<TSchema>>(
  context: RuntimeClassOperationContext<TSchema>,
  receiver: TThis,
  construct: new (input: unknown, token: symbol, validated?: boolean) => InstanceType<TThis>,
  input: Input<TSchema>,
  factory: Function
): InstanceType<TThis> {
  const { policy } = context;
  const parsed =
    policy.validationConfigured && policy.create
      ? context.policySafeParse()(context.boundaryInput(input))
      : policy.configured && !policy.create
        ? { success: true as const, data: context.parse(input) }
        : { success: true as const, data: context.materialize(input) };
  if (!parsed.success) return policyFailure(policy, policyError(policy, parsed.issues)) as InstanceType<TThis>;
  const assertionFailure = runAssertion(policy, parsed.data);
  if (assertionFailure !== undefined) return policyFailure(policy, assertionFailure) as InstanceType<TThis>;
  const result = factory.call(receiver, parsed.data, constructionContext(construct));
  return finishCustomFactoryResult(context, receiver, construct, result);
}

function hydrateWithCustomFactory<TSchema extends ATS.AnyTypeSchema, TThis extends RuntimeClass<TSchema>>(
  context: RuntimeClassOperationContext<TSchema>,
  receiver: TThis,
  construct: new (input: unknown, token: symbol, validated?: boolean) => InstanceType<TThis>,
  input: Hydrate<TSchema>,
  factory: Function
): InstanceType<TThis> {
  const { policy } = context;
  const parsed =
    policy.validationConfigured && policy.hydrate
      ? context.policySafeHydrate()(context.boundaryInput(input))
      : policy.configured && !policy.hydrate
        ? { success: true as const, data: context.hydrateInput(input) }
        : { success: true as const, data: context.materializeHydrated(input) };
  if (!parsed.success) return policyFailure(policy, policyError(policy, parsed.issues)) as InstanceType<TThis>;
  const assertionFailure = runAssertion(policy, parsed.data);
  if (assertionFailure !== undefined) return policyFailure(policy, assertionFailure) as InstanceType<TThis>;
  const result = factory.call(receiver, parsed.data, constructionContext(construct));
  return finishCustomFactoryResult(context, receiver, construct, result);
}

function constructionContext<TInstance>(
  construct: new (input: unknown, token: symbol, validated?: boolean) => TInstance
): FactoryConstructionContext<TInstance> {
  return {
    construct: (value: unknown) => new construct(value, INTERNAL_CONSTRUCT, true),
  };
}

function finishCustomFactoryResult<TSchema extends ATS.AnyTypeSchema, TThis extends RuntimeClass<TSchema>>(
  context: RuntimeClassOperationContext<TSchema>,
  receiver: TThis,
  construct: new (input: unknown, token: symbol, validated?: boolean) => InstanceType<TThis>,
  result: unknown
): InstanceType<TThis> {
  const { policy } = context;
  let instance: InstanceType<TThis>;
  if (result instanceof receiver) {
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
  return policy.configured ? (policySuccess(policy, instance) as InstanceType<TThis>) : instance;
}

function hydrateWithMaterialization<TSchema extends ATS.AnyTypeSchema, TInstance>(
  context: RuntimeClassOperationContext<TSchema>,
  construct: new (input: unknown, token: symbol, validated?: boolean) => TInstance,
  input: Hydrate<TSchema>
): TInstance {
  const { policy } = context;
  let materialized: unknown;
  try {
    materialized = context.materializeHydrated(input);
  } catch (error) {
    if (error instanceof JITValidationError)
      return policyFailure(policy, policyError(policy, error.issues)) as TInstance;
    throw error;
  }
  const assertionFailure = runAssertion(policy, materialized);
  if (assertionFailure !== undefined) return policyFailure(policy, assertionFailure) as TInstance;
  return policySuccess(policy, new construct(materialized, INTERNAL_CONSTRUCT, true)) as TInstance;
}

function hydrateWithFailFastValidation<TSchema extends ATS.AnyTypeSchema, TInstance>(
  context: RuntimeClassOperationContext<TSchema>,
  construct: new (input: unknown, token: symbol, validated?: boolean) => TInstance,
  input: Hydrate<TSchema>
): TInstance {
  const { policy } = context;
  try {
    return policySuccess(policy, new construct(context.hydrateInput(input), INTERNAL_CONSTRUCT, true)) as TInstance;
  } catch (error) {
    if (!(error instanceof JITValidationError)) throw error;
    return policyFailure(policy, policyError(policy, error.issues)) as TInstance;
  }
}

function hydrateWithDiagnosticValidation<TSchema extends ATS.AnyTypeSchema, TInstance>(
  context: RuntimeClassOperationContext<TSchema>,
  construct: new (input: unknown, token: symbol, validated?: boolean) => TInstance,
  input: Hydrate<TSchema>
): TInstance {
  const { policy } = context;
  const parsed = context.policySafeHydrate()(context.boundaryInput(input));
  if (!parsed.success) return policyFailure(policy, policyError(policy, parsed.issues)) as TInstance;
  const assertionFailure = runAssertion(policy, parsed.data);
  if (assertionFailure !== undefined) return policyFailure(policy, assertionFailure) as TInstance;
  return policySuccess(policy, new construct(parsed.data, INTERNAL_CONSTRUCT, true)) as TInstance;
}

function runAssertion(policy: FactoryPolicyState, value: unknown): unknown | undefined {
  return policy.assert === undefined ? undefined : policy.assert(value);
}
