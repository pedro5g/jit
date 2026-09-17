import type * as ATS from "../core/ats/index.js";
import type { Hydrate } from "../core/ats/representations.js";
import { JITError, JITValidationError } from "../errors/index.js";
import { INTERNAL_CONSTRUCT } from "./class-layout.js";
import { type FactoryPolicyState, policyError, policyFailure, policySuccess, type SafeParse } from "./class-policy.js";
import type { CreateArguments, FactoryConstructionContext } from "./class-types.js";

type ScalarConstructor<TInstance = unknown> = abstract new (...args: never[]) => TInstance;

export interface ScalarOperationContext<TSchema extends ATS.AnyTypeSchema> {
  readonly classTarget: Function;
  readonly isAbstract: boolean;
  readonly policy: FactoryPolicyState;
  readonly parse: (input: unknown) => unknown;
  readonly hydrateState: (input: unknown) => unknown;
  readonly materialize: (input: unknown) => unknown;
  readonly materializeHydrated: (input: unknown) => unknown;
  readonly safeParse: (maxIssues: number | undefined) => (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
  readonly safeHydrate: (maxIssues: number | undefined) => (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
  readonly customFactories: () => { readonly create?: Function; readonly hydrate?: Function };
}

export function createScalarInstance<TSchema extends ATS.AnyTypeSchema, TThis extends ScalarConstructor>(
  context: ScalarOperationContext<TSchema>,
  receiver: TThis,
  args: CreateArguments<TSchema>
): InstanceType<TThis> {
  assertScalarConstruction(context, receiver, "create");
  const construct = receiver as unknown as new (
    input: unknown,
    token: symbol,
    validated?: boolean
  ) => InstanceType<TThis>;
  const factory = context.customFactories().create;
  if (factory !== undefined) return createWithFactory(context, receiver, construct, args[0], factory);
  if (!context.policy.configured) return new construct(context.materialize(args[0]), INTERNAL_CONSTRUCT, true);
  if (!context.policy.create) return new construct(args[0], INTERNAL_CONSTRUCT);
  if (context.policy.maxIssues === undefined) return createFailFast(context, construct, args[0]);
  const parsed = context.safeParse(context.policy.maxIssues)(args[0]);
  if (!parsed.success)
    return policyFailure(context.policy, policyError(context.policy, parsed.issues)) as InstanceType<TThis>;
  return policySuccess(context.policy, new construct(parsed.data, INTERNAL_CONSTRUCT, true)) as InstanceType<TThis>;
}

export function hydrateScalarInstance<TSchema extends ATS.AnyTypeSchema, TThis extends ScalarConstructor>(
  context: ScalarOperationContext<TSchema>,
  receiver: TThis,
  state: Hydrate<TSchema>
): InstanceType<TThis> {
  assertScalarConstruction(context, receiver, "hydrate");
  const construct = receiver as unknown as new (
    input: unknown,
    token: symbol,
    validated?: boolean
  ) => InstanceType<TThis>;
  const factory = context.customFactories().hydrate;
  if (factory !== undefined) return hydrateWithFactory(context, receiver, construct, state, factory);
  if (!context.policy.configured) {
    return new construct(context.materializeHydrated(state), INTERNAL_CONSTRUCT, true);
  }
  if (!context.policy.hydrate) return new construct(context.hydrateState(state), INTERNAL_CONSTRUCT, true);
  if (context.policy.maxIssues === undefined) return hydrateFailFast(context, construct, state);
  const parsed = context.safeHydrate(context.policy.maxIssues)(state);
  if (!parsed.success)
    return policyFailure(context.policy, policyError(context.policy, parsed.issues)) as InstanceType<TThis>;
  return policySuccess(context.policy, new construct(parsed.data, INTERNAL_CONSTRUCT, true)) as InstanceType<TThis>;
}

function assertScalarConstruction<TSchema extends ATS.AnyTypeSchema>(
  context: ScalarOperationContext<TSchema>,
  receiver: Function,
  operation: "create" | "hydrate"
): void {
  if (context.isAbstract && receiver === context.classTarget) {
    throw new JITError("INVALID_OPERATION", `Cannot ${operation} an instance of an abstract JIT class`);
  }
}

function createFailFast<TSchema extends ATS.AnyTypeSchema, TInstance>(
  context: ScalarOperationContext<TSchema>,
  construct: new (input: unknown, token: symbol, validated?: boolean) => TInstance,
  input: unknown
): TInstance {
  try {
    return policySuccess(context.policy, new construct(context.parse(input), INTERNAL_CONSTRUCT, true)) as TInstance;
  } catch (error) {
    if (!(error instanceof JITValidationError)) throw error;
    return policyFailure(context.policy, policyError(context.policy, error.issues)) as TInstance;
  }
}

function hydrateFailFast<TSchema extends ATS.AnyTypeSchema, TInstance>(
  context: ScalarOperationContext<TSchema>,
  construct: new (input: unknown, token: symbol, validated?: boolean) => TInstance,
  input: unknown
): TInstance {
  try {
    return policySuccess(
      context.policy,
      new construct(context.hydrateState(input), INTERNAL_CONSTRUCT, true)
    ) as TInstance;
  } catch (error) {
    if (!(error instanceof JITValidationError)) throw error;
    return policyFailure(context.policy, policyError(context.policy, error.issues)) as TInstance;
  }
}

function createWithFactory<TSchema extends ATS.AnyTypeSchema, TThis extends ScalarConstructor>(
  context: ScalarOperationContext<TSchema>,
  receiver: TThis,
  construct: new (input: unknown, token: symbol, validated?: boolean) => InstanceType<TThis>,
  input: unknown,
  factory: Function
): InstanceType<TThis> {
  const parsed =
    context.policy.validationConfigured && context.policy.create
      ? context.safeParse(undefined)(input)
      : context.policy.configured && !context.policy.create
        ? { success: true as const, data: context.parse(input) }
        : { success: true as const, data: context.materialize(input) };
  if (!parsed.success)
    return policyFailure(context.policy, policyError(context.policy, parsed.issues)) as InstanceType<TThis>;
  const result = factory.call(receiver, parsed.data, scalarConstructionContext(construct));
  return newScalarFactoryResult(context.policy, receiver, construct, result);
}

function hydrateWithFactory<TSchema extends ATS.AnyTypeSchema, TThis extends ScalarConstructor>(
  context: ScalarOperationContext<TSchema>,
  receiver: TThis,
  construct: new (input: unknown, token: symbol, validated?: boolean) => InstanceType<TThis>,
  input: Hydrate<TSchema>,
  factory: Function
): InstanceType<TThis> {
  const parsed =
    context.policy.validationConfigured && context.policy.hydrate
      ? context.safeHydrate(undefined)(input)
      : context.policy.configured && !context.policy.hydrate
        ? { success: true as const, data: context.hydrateState(input) }
        : { success: true as const, data: context.materializeHydrated(input) };
  if (!parsed.success)
    return policyFailure(context.policy, policyError(context.policy, parsed.issues)) as InstanceType<TThis>;
  const result = factory.call(receiver, parsed.data, scalarConstructionContext(construct));
  return newScalarFactoryResult(context.policy, receiver, construct, result);
}

function scalarConstructionContext<TInstance>(
  construct: new (input: unknown, token: symbol, validated?: boolean) => TInstance
): FactoryConstructionContext<TInstance> {
  return { construct: (value: unknown) => new construct(value, INTERNAL_CONSTRUCT, true) };
}

function newScalarFactoryResult<TThis extends ScalarConstructor>(
  policy: FactoryPolicyState,
  receiver: TThis,
  construct: new (input: unknown, token: symbol, validated?: boolean) => InstanceType<TThis>,
  result: unknown
): InstanceType<TThis> {
  const instance =
    result instanceof receiver ? (result as InstanceType<TThis>) : new construct(result, INTERNAL_CONSTRUCT, true);
  return policy.configured ? (policySuccess(policy, instance) as InstanceType<TThis>) : instance;
}
