import {
  compileHydrator,
  compileMaterializer,
  compileSafeHydrator,
  compileValidator,
  compileValidatorSelection,
} from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import { INTERNAL_CONSTRUCT, TRUSTED_MATERIALIZER } from "./class-layout.js";
import type { SafeParse } from "./class-policy.js";
import type { ConstructionMode, ScalarFactoryRuntimeClass, ScalarValueObject } from "./class-types.js";

export interface ScalarRuntimeKernel<TSchema extends ATS.AnyTypeSchema> {
  readonly parse: (input: unknown) => unknown;
  readonly hydrateState: (input: unknown) => unknown;
  readonly materialize: (input: unknown) => unknown;
  readonly materializeHydrated: (input: unknown) => unknown;
  readonly classTarget: ScalarFactoryRuntimeClass<TSchema, ScalarValueObject<ATS.TypeofSchema<TSchema>>>;
  readonly safeParse: (maxIssues: number | undefined) => (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
  readonly safeHydrate: (maxIssues: number | undefined) => (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
}

export function createScalarRuntimeKernel<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  constructionState: { mode: ConstructionMode }
): ScalarRuntimeKernel<TSchema> {
  const parse = compileValidator(schema).parse;
  const hydrateState = compileHydrator(schema);
  const materialize = compileMaterializer(schema);
  const materializeHydrated = compileMaterializer(schema, { resolveDefaults: false });
  const classTarget = createScalarClassTarget<TSchema>(parse, constructionState);
  let safeParse: ((input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>) | undefined;
  let safeHydrate: ((state: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>) | undefined;
  const safeParseForPolicy = (maxIssues: number | undefined) => {
    safeParse ??= compileValidatorSelection(schema, ["safeParse"], {
      ...(maxIssues === undefined ? {} : { maxIssues }),
    }).safeParse as (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
    return safeParse;
  };
  const safeHydrateForPolicy = (maxIssues: number | undefined) => {
    safeHydrate ??= compileSafeHydrator(schema, {
      ...(maxIssues === undefined ? {} : { maxIssues }),
    }) as (input: unknown) => SafeParse<ATS.TypeofSchema<TSchema>>;
    return safeHydrate;
  };
  return {
    parse,
    hydrateState,
    materialize,
    materializeHydrated,
    classTarget,
    safeParse: safeParseForPolicy,
    safeHydrate: safeHydrateForPolicy,
  };
}

function createScalarClassTarget<TSchema extends ATS.AnyTypeSchema>(
  parse: (input: unknown) => unknown,
  constructionState: { mode: ConstructionMode }
): ScalarFactoryRuntimeClass<TSchema, ScalarValueObject<ATS.TypeofSchema<TSchema>>> {
  const source = `return class JITScalarValueObject { constructor(input, token, validated) { if (__construction.mode === "factory" && token !== __construct && token !== true) throw new Error("This Runtime Type uses factory construction; call its create() or hydrate() factory"); this.value = token === true || validated === true ? input : __parse(input); Object.freeze(this); } };`;
  const classTarget = globalThis.Function(
    "__parse",
    "__construct",
    "__construction",
    source
  )(parse, INTERNAL_CONSTRUCT, constructionState) as ScalarFactoryRuntimeClass<
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
  return classTarget;
}
