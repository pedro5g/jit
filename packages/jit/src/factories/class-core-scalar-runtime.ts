import { compileEqual } from "../compiler/equal.js";
import { compileHash } from "../compiler/hash.js";
import type * as ATS from "../core/ats/index.js";
import type { Hydrate } from "../core/ats/representations.js";
import {
  createScalarInstance,
  hydrateScalarInstance,
  type ScalarOperationContext,
} from "./class-core-scalar-operations.js";
import { createScalarRuntimeKernel } from "./class-core-scalar-runtime-kernel.js";
import {
  installScalarSurface,
  type MutableScalarSurface,
  registerScalarArtifact,
} from "./class-core-scalar-surface.js";
import type { InstalledScalarMethod, ScalarClassSeed } from "./class-core-state.js";
import { definePrototype, installMethodDefinition } from "./class-core-support.js";
import { SCALAR_MEMBERS } from "./class-extensions.js";
import { clonePolicyState } from "./class-policy.js";
import type {
  AnyClassCapability,
  ConstructionMode,
  CreateArguments,
  RuntimeClass,
  ScalarFactoryRuntimeClass,
  ScalarValueObject,
} from "./class-types.js";

interface ScalarFactoryState {
  readonly policy: ReturnType<typeof clonePolicyState>;
  readonly constructionState: { mode: ConstructionMode };
  readonly installedCapabilities: string[];
  readonly installedCapabilityValues: AnyClassCapability[];
  readonly installedMethods: InstalledScalarMethod[];
  readonly installedMethodNames: Set<string>;
  factoryNames: { create: string | false; hydrate: string | false };
  customFactories: { create?: Function; hydrate?: Function };
  constructionConfigured: boolean;
  factoriesConfigured: boolean;
}

function createScalarFactoryState(seed: ScalarClassSeed | undefined): ScalarFactoryState {
  const installedCapabilityValues = [...(seed?.capabilities ?? [])];
  const installedMethods: InstalledScalarMethod[] = [...(seed?.methods ?? [])];
  const installedMethodNames = new Set<string>(SCALAR_MEMBERS);
  for (const method of installedMethods) installedMethodNames.add(method.name);
  return {
    policy: clonePolicyState(seed?.policy),
    constructionState: { mode: seed?.construction ?? "factory" },
    installedCapabilities: ["equals", "hashCode", ...installedCapabilityValues.map((capability) => capability.kind)],
    installedCapabilityValues,
    installedMethods,
    installedMethodNames,
    factoryNames: seed?.factoryNames ?? { create: "create", hydrate: "hydrate" },
    customFactories: seed?.customFactories ?? {},
    constructionConfigured: seed?.constructionConfigured ?? false,
    factoriesConfigured: seed?.factoriesConfigured ?? false,
  };
}

/** @internal Materializes the shared scalar Value Object runtime artifact. */
export function createScalarValueObject<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  identifier: boolean,
  isAbstract: boolean,
  seed?: ScalarClassSeed
): ScalarFactoryRuntimeClass<TSchema, ScalarValueObject<ATS.TypeofSchema<TSchema>>> {
  const factoryState = createScalarFactoryState(seed);
  const { policy } = factoryState;
  const constructionState = factoryState.constructionState;
  const kernel = createScalarRuntimeKernel(schema, constructionState);
  const { parse, hydrateState, materialize, materializeHydrated, classTarget } = kernel;
  const equal = compileEqual(schema) as (left: unknown, right: unknown) => boolean;
  const hash = compileHash(schema) as (value: unknown) => number;
  const operationContext: ScalarOperationContext<TSchema> = {
    classTarget,
    isAbstract,
    policy,
    parse,
    hydrateState,
    materialize,
    materializeHydrated,
    safeParse: kernel.safeParse,
    safeHydrate: kernel.safeHydrate,
    customFactories: () => factoryState.customFactories,
  };
  const create = function create<TThis extends RuntimeClass<TSchema>>(
    this: TThis,
    ...args: CreateArguments<TSchema>
  ): InstanceType<TThis> {
    return createScalarInstance(operationContext, this, args);
  };
  const hydrate = function hydrate<TThis extends RuntimeClass<TSchema>>(
    this: TThis,
    state: Hydrate<TSchema>
  ): InstanceType<TThis> {
    return hydrateScalarInstance(operationContext, this, state);
  };
  const surface = Object.assign(factoryState, {
    schema,
    identifier,
    isAbstract,
    classTarget,
    policy,
    constructionState,
    factoryNames: factoryState.factoryNames,
    customFactories: factoryState.customFactories,
    constructionConfigured: factoryState.constructionConfigured,
    factoriesConfigured: factoryState.factoriesConfigured,
    create,
    hydrate,
    recreate: (nextSeed: ScalarClassSeed) => createScalarValueObject(schema, identifier, isAbstract, nextSeed),
  }) as MutableScalarSurface<TSchema>;
  installScalarSurface(surface);
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
  for (const capability of factoryState.installedCapabilityValues) capability.install(classTarget, schema);
  for (const method of factoryState.installedMethods) installMethodDefinition(classTarget, method);
  registerScalarArtifact(surface);
  return classTarget;
}
