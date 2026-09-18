import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { createRuntimeClassState, prepareRuntimeClass } from "./class-core-materialize.js";
import { createClassInstance, hydrateClassInstance } from "./class-core-operations.js";
import type { ClassDefinitionState, ClassStateSeed } from "./class-core-state.js";
import {
  installRuntimeClassFeatures,
  installRuntimeClassSurface,
  registerRuntimeClassArtifact,
} from "./class-core-surface.js";
import { CLASS_TARGET } from "./class-core-symbols.js";
import type { ResolvedAccessors } from "./class-layout.js";
import type { AbstractRuntimeClass, ConstructionMode, ConstructorRuntimeClass, RuntimeClass } from "./class-types.js";

export { isFailure } from "./class-policy.js";

type RuntimeClassTarget = RuntimeClass<ATS.AnyTypeSchema> & {
  readonly [CLASS_TARGET]: true;
};

/** Resolves the class target without making the internal marker public. */
export function getRuntimeClassTarget(value: unknown): RuntimeClassTarget | undefined {
  if (typeof value !== "function" || !(CLASS_TARGET in value)) return undefined;
  return value as RuntimeClassTarget;
}

/** Materializes a constructor-first Runtime Class from a schema. */
export function classFactory<TSchema extends ATS.AnyTypeSchema>(
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

/** Materializes an abstract Runtime Class base from a schema. */
export function abstractClass<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): AbstractRuntimeClass<TSchema> {
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
