import { addMember, initialEffectiveSchema, resolveEffectiveObjectSchema } from "../classes/effective-schema.js";
import type { ResolvedMemberTable } from "../classes/members.js";
import {
  compileHydrator,
  compileMaterializer,
  compileSafeHydrator,
  compileValidator,
  compileValidatorSelection,
} from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import { Object_hasOwn } from "../shared/utils.js";
import type { RuntimeClassOperationContext } from "./class-core-operations.js";
import { resolveRuntimeClassPolicy } from "./class-core-result-policy.js";
import type { ClassDefinitionState, ClassStateSeed } from "./class-core-state.js";
import {
  compileNoConstructorInitializers,
  createClassLayoutPlan,
  emitConstructor,
  installTrustedMaterializer,
  type ManagedStorageBinding,
  type ResolvedAccessors,
  removeNoConstructorFields,
  resolveManagedStorage,
  TRUSTED_MATERIALIZER,
} from "./class-layout.js";
import { clonePolicyState, type FactoryPolicyState, type SafeParse } from "./class-policy.js";
import type { ConstructionMode, RuntimeClass } from "./class-types.js";

export interface RuntimeClassBuild<TSchema extends ATS.AnyTypeSchema> {
  readonly state: ClassDefinitionState;
  readonly policy: FactoryPolicyState;
  readonly objectSchema: ReturnType<typeof resolveEffectiveObjectSchema>;
  readonly properties: readonly string[];
  readonly creationSchema: ATS.AnyTypeSchema;
  readonly hydrateSchema: ATS.AnyTypeSchema;
  readonly boundaryInput: (input: unknown) => unknown;
  readonly parse: (input: unknown) => unknown;
  readonly hydrateInput: (input: unknown) => unknown;
  readonly materialize: (input: unknown) => unknown;
  readonly materializeHydrated: (input: unknown) => unknown;
  readonly policySafeParse: () => (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
  readonly policySafeHydrate: () => (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
  readonly initializers: ReadonlyMap<string, () => unknown>;
  readonly managedStorage: ReadonlyMap<string, ManagedStorageBinding>;
  readonly layout: ReturnType<typeof createClassLayoutPlan>;
  readonly classTarget: RuntimeClass<TSchema>;
  readonly operationContext: RuntimeClassOperationContext<TSchema>;
}

interface RuntimeClassSchemas {
  readonly creation: ATS.AnyTypeSchema;
  readonly hydrate: ATS.AnyTypeSchema;
  readonly noConstructorFields: readonly string[];
}

interface RuntimeClassParsers<TSchema extends ATS.AnyTypeSchema> {
  readonly boundaryInput: (input: unknown) => unknown;
  readonly parse: (input: unknown) => unknown;
  readonly hydrateInput: (input: unknown) => unknown;
  readonly materialize: (input: unknown) => unknown;
  readonly materializeHydrated: (input: unknown) => unknown;
  readonly policySafeParse: () => (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
  readonly policySafeHydrate: () => (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
  readonly prime: () => void;
}

export function createRuntimeClassState<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  isAbstract: boolean,
  freezeInstances: boolean,
  aggregate: boolean,
  construction: ConstructionMode,
  encapsulateFields: boolean,
  accessors: ResolvedAccessors | undefined,
  seed: ClassStateSeed | undefined
): ClassDefinitionState {
  const baseState = initialEffectiveSchema(schema);
  const members = seed?.members?.clone() ?? baseState.members;
  if (aggregate) addAggregateMembers(members);
  return {
    declaredSchema: seed?.declaredSchema ?? schema,
    schema,
    isAbstract,
    freezeInstances,
    aggregate,
    construction,
    ...runtimeClassConstructionFields(construction, seed),
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
}

function addAggregateMembers(members: ResolvedMemberTable): void {
  for (const name of ["raise", "peekEvents", "pullEvents", "commit"])
    addMember(members, name, "preset", "ddd.aggregateRoot", "method");
}

function runtimeClassConstructionFields(
  construction: ConstructionMode,
  seed: ClassStateSeed | undefined
): Pick<
  ClassDefinitionState,
  "factoryValidationOptIn" | "constructionConfigured" | "factoriesConfigured" | "factoryNames" | "customFactories"
> {
  return {
    factoryValidationOptIn: seed?.factoryValidationOptIn ?? false,
    constructionConfigured: seed?.constructionConfigured ?? false,
    factoriesConfigured: seed?.factoriesConfigured ?? false,
    factoryNames: seed?.factoryNames ?? defaultFactoryNames(construction),
    customFactories: seed?.customFactories ?? {},
  };
}

function defaultFactoryNames(construction: ConstructionMode): { create: string | false; hydrate: string | false } {
  return construction === "factory" ? { create: "create", hydrate: "hydrate" } : { create: false, hydrate: false };
}

export function prepareRuntimeClass<TSchema extends ATS.AnyTypeSchema>(
  state: ClassDefinitionState
): RuntimeClassBuild<TSchema> {
  const policy = resolveRuntimeClassPolicy(state);
  const objectSchema = resolveEffectiveObjectSchema(state.schema);
  const properties = Object.keys(objectSchema.def.props);
  const schemas = createRuntimeSchemas(state);
  const parsers = createRuntimeParsers<TSchema>(schemas, policy);
  const initializers = compileNoConstructorInitializers(state.schema, state.fieldPolicies);
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
  const classTarget = emitConstructor(layout, state.freezeInstances, state.aggregate, parsers.parse, {
    mode: state.construction,
  }) as RuntimeClass<TSchema>;
  installTrustedMaterializer(classTarget, layout, state.freezeInstances, state.aggregate, TRUSTED_MATERIALIZER);
  parsers.prime();
  const operationContext: RuntimeClassOperationContext<TSchema> = {
    state,
    policy,
    classTarget,
    boundaryInput: parsers.boundaryInput,
    parse: parsers.parse,
    hydrateInput: parsers.hydrateInput,
    materialize: parsers.materialize,
    materializeHydrated: parsers.materializeHydrated,
    policySafeParse: parsers.policySafeParse,
    policySafeHydrate: parsers.policySafeHydrate,
  };
  return {
    state,
    policy,
    objectSchema,
    properties,
    creationSchema: schemas.creation,
    hydrateSchema: schemas.hydrate,
    boundaryInput: parsers.boundaryInput,
    parse: parsers.parse,
    hydrateInput: parsers.hydrateInput,
    materialize: parsers.materialize,
    materializeHydrated: parsers.materializeHydrated,
    policySafeParse: parsers.policySafeParse,
    policySafeHydrate: parsers.policySafeHydrate,
    initializers,
    managedStorage,
    layout,
    classTarget,
    operationContext,
  };
}

function createRuntimeSchemas(state: ClassDefinitionState): RuntimeClassSchemas {
  const noConstructorFields = [...state.fieldPolicies.entries()]
    .filter(([, policy]) => policy.noConstructor)
    .map(([field]) => field);
  return {
    creation: removeNoConstructorFields(state.schema, state.fieldPolicies),
    hydrate: removeNoConstructorFields(state.schema, state.fieldPolicies),
    noConstructorFields,
  };
}

function createRuntimeParsers<TSchema extends ATS.AnyTypeSchema>(
  schemas: RuntimeClassSchemas,
  policy: FactoryPolicyState
): RuntimeClassParsers<TSchema> {
  let parseCreation: ((input: unknown) => unknown) | undefined;
  let hydrateState: ((input: unknown) => unknown) | undefined;
  let materializeCreation: ((input: unknown) => unknown) | undefined;
  let materializeHydrate: ((input: unknown) => unknown) | undefined;
  let safeParse: ((input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>) | undefined;
  let safeHydrate: ((input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>) | undefined;
  const boundaryInput = createBoundaryInput(schemas.noConstructorFields);
  const parse = (input: unknown): unknown => {
    parseCreation ??= compileValidator(schemas.creation).parse;
    return parseCreation(boundaryInput(input));
  };
  const hydrateInput = (input: unknown): unknown => {
    hydrateState ??= compileHydrator(schemas.hydrate);
    return hydrateState(boundaryInput(input));
  };
  const materialize = (input: unknown): unknown => {
    materializeCreation ??= compileMaterializer(schemas.creation);
    return materializeCreation(boundaryInput(input));
  };
  const materializeHydrated = (input: unknown): unknown => {
    materializeHydrate ??= compileMaterializer(schemas.hydrate, { resolveDefaults: false });
    return materializeHydrate(boundaryInput(input));
  };
  const policySafeParse = () => {
    safeParse ??= compileValidatorSelection(schemas.creation, ["safeParse"], {
      ...(policy.maxIssues === undefined ? {} : { maxIssues: policy.maxIssues }),
    }).safeParse as (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
    return safeParse;
  };
  const policySafeHydrate = () => {
    safeHydrate ??= compileSafeHydrator(schemas.hydrate, {
      ...(policy.maxIssues === undefined ? {} : { maxIssues: policy.maxIssues }),
    }) as (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
    return safeHydrate;
  };
  return {
    boundaryInput,
    parse,
    hydrateInput,
    materialize,
    materializeHydrated,
    policySafeParse,
    policySafeHydrate,
    prime: () => {
      parseCreation = compileValidator(schemas.creation).parse;
      hydrateState = compileHydrator(schemas.hydrate);
    },
  };
}

function createBoundaryInput(noConstructorFields: readonly string[]): (input: unknown) => unknown {
  return (input: unknown): unknown => {
    if (noConstructorFields.length === 0 || input === null || typeof input !== "object") return input;
    if (!noConstructorFields.some((field) => Object_hasOwn(input, field))) return input;
    const copy = { ...(input as Record<string, unknown>) };
    for (const field of noConstructorFields) delete copy[field];
    return copy;
  };
}
