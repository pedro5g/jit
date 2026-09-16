import type { ClassFactoryMemberDescriptor, ClassMemberDescriptor } from "../classes/member-descriptors.js";
import type { QueryConditionNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import type { CompareNumericLiteral } from "../core/builder/types.js";
import type { FactoryReturnMode } from "../core/factory-policy.js";
import type { JITValidationError } from "../errors/index.js";
import type {
  AnyClassExtension,
  AssertionOptions,
  AssertionTraits,
  ClassExtensionArgs,
  ClassRuntimeTraits,
  FactoryValidationOptions,
} from "./class-types-extension.js";
import type {
  AccessorOptions,
  ConfiguredRuntimeClass,
  ConstructionFixedConstructor,
  ConstructionFixedFactory,
  FactoryRuntimeClass,
} from "./class-types-factory.js";
import type {
  ApplySchemaOverrides,
  ClassConstructorInput,
  ClassCreateInput,
  ClassHydrateInput,
  ExtendedInstance,
} from "./class-types-schema.js";
import type { QueryConditionBuilder } from "./query.js";

/** Describes the shared runtime class contract before construction is fixed. */
export interface RuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance = ATS.TypeofSchema<TSchema>,
  TTraits extends ATS.RuntimeTypeTraits = ClassRuntimeTraits,
  TEncapsulated extends boolean = false,
> {
  /** Constructs an instance through the class's direct construction boundary. */
  new (input: ClassConstructorInput<TSchema>): TInstance;
  readonly schema: ATS.RuntimeTypeSchema<TSchema, TInstance, TTraits["representation"], TTraits["identifier"], TTraits>;
  /** Creates an instance through the configured factory boundary. */
  create<TThis extends RuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>>(
    this: TThis,
    input: ClassCreateInput<TSchema>
  ): InstanceType<TThis>;
  /** Hydrates an instance from persisted state without regenerating defaults. */
  hydrate<TThis extends RuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>>(
    this: TThis,
    state: ClassHydrateInput<TSchema>
  ): InstanceType<TThis>;
  /** Adds fields, methods or capabilities to the generated prototype. */
  extends<const TExtensions extends readonly AnyClassExtension[]>(
    ...extensions: TExtensions & ClassExtensionArgs<TSchema, TInstance, TExtensions, TEncapsulated>
  ): RuntimeClass<
    ApplySchemaOverrides<TSchema, TExtensions>,
    ExtendedInstance<TSchema, TInstance, TExtensions, TEncapsulated>,
    TTraits,
    TEncapsulated
  >;
  /** Opens the factory configuration boundary. */
  factories<const TOptions extends FactoryOptions>(
    options: TOptions
  ): ConfiguredRuntimeClass<
    TSchema,
    TInstance,
    TOptions,
    "throw",
    JITValidationError,
    false,
    false,
    TTraits,
    TEncapsulated
  >;
  /** Keeps direct construction as the class boundary. */
  construction(mode: "constructor"): ConstructorRuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>;
  /** Uses factory construction as the class boundary. */
  construction(mode: "factory"): FactoryRuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>;
  /** Adds schema-backed accessors to the generated class. */
  accessors<TThis extends RuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>>(
    this: TThis,
    options: AccessorOptions<TSchema>
  ): TThis;
  /** Enables the selected factory validation policy. */
  validate(policy?: FactoryValidationOptions): RuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>;
  /** Adds a domain assertion evaluated through the configured factory policy. */
  assert(
    predicate: (query: QueryConditionBuilder<ATS.TypeofSchema<TSchema>>) => QueryConditionNode,
    options?: AssertionOptions
  ): RuntimeClass<TSchema, TInstance, AssertionTraits<TTraits, TTraits["factoryPolicy"]["errorType"]>, TEncapsulated>;
}

// A failure policy applies to factories, so a constructor-first class does not
// carry one: `.factories()` is the step that opens that boundary.
/** @internal Type helper shared by the runtime-class type contracts. */
export type RuntimeClassConstructionMembers =
  | "create"
  | "hydrate"
  | "extends"
  | "factories"
  | "construction"
  | "accessors"
  | "validate"
  | "assert";

/** The default `JIT.class` surface: direct construction, no static factories. */
export type ConstructorRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance = ATS.TypeofSchema<TSchema>,
  TTraits extends ATS.RuntimeTypeTraits = ClassRuntimeTraits,
  TEncapsulated extends boolean = false,
> = (new (
  input: ClassConstructorInput<TSchema>
) => TInstance) &
  Omit<RuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>, RuntimeClassConstructionMembers> & {
    extends<const TExtensions extends readonly AnyClassExtension[]>(
      ...extensions: TExtensions & ClassExtensionArgs<TSchema, TInstance, TExtensions, TEncapsulated>
    ): ConstructorRuntimeClass<
      ApplySchemaOverrides<TSchema, TExtensions>,
      ExtendedInstance<TSchema, TInstance, TExtensions, TEncapsulated>,
      TTraits,
      TEncapsulated
    >;
    factories<const TOptions extends FactoryOptions>(
      options: TOptions
    ): ConfiguredRuntimeClass<
      TSchema,
      TInstance,
      TOptions,
      "throw",
      JITValidationError,
      false,
      true,
      TTraits,
      TEncapsulated
    >;
    construction(mode: "constructor"): ConstructionFixedConstructor<TSchema, TInstance, TTraits, TEncapsulated>;
    construction(mode: "factory"): ConstructionFixedFactory<TSchema, TInstance, TTraits, TEncapsulated>;
    accessors(
      options: AccessorOptions<TSchema>
    ): (new (
      input: ClassConstructorInput<TSchema>
    ) => TInstance) &
      Omit<ConstructorRuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>, "accessors">;
  };

/** Describes the JIT factory options contract used by the public API. */
export interface FactoryOptions {
  readonly create?: string | false | ClassMemberDescriptor<ClassFactoryMemberDescriptor>;
  readonly hydrate?: string | false | ClassMemberDescriptor<ClassFactoryMemberDescriptor>;
}

type FactoryModeCandidate<TMode extends FactoryReturnMode = FactoryReturnMode, TPriority extends number = number> = {
  readonly mode: TMode;
  readonly priority: TPriority;
};

type NestedFactoryModeCandidates<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.RuntimeTypeSchema<ATS.AnyTypeSchema, unknown, "object" | "value", boolean, infer TTraits>
    ? TTraits["factoryPolicy"] extends { readonly configured: true }
      ? TTraits["factoryPolicy"] extends { readonly resultModeExplicit: true | false }
        ? TTraits["factoryPolicy"] extends { readonly resultModeExplicit: true }
          ? FactoryModeCandidate<
              Extract<TTraits["factoryPolicy"]["resultMode"], FactoryReturnMode>,
              TTraits["factoryPolicy"]["priority"]
            >
          : TTraits["factoryPolicy"] extends { readonly resultModeInherited: true }
            ? FactoryModeCandidate<
                Extract<TTraits["factoryPolicy"]["resultMode"], FactoryReturnMode>,
                TTraits["factoryPolicy"]["priority"]
              >
            : never
        : never
      : never
    : TSchema extends ATS.ObjectSchema<infer TShape>
      ? NestedFactoryModeCandidates<TShape[keyof TShape]>
      : TSchema extends ATS.ArraySchema<infer TElement> | ATS.SetSchema<infer TElement>
        ? NestedFactoryModeCandidates<TElement>
        : TSchema extends ATS.LazySchema<infer TInner>
          ? NestedFactoryModeCandidates<TInner>
          : TSchema extends
                | ATS.OptionalSchema<infer TInner>
                | ATS.NullableSchema<infer TInner>
                | ATS.NullishSchema<infer TInner>
                | ATS.DefaultSchema<infer TInner>
                | ATS.BrandSchema<infer TInner>
                | ATS.ReadonlySchema<infer TInner>
                | ATS.RefineSchema<infer TInner>
                | ATS.CoerceSchema<infer TInner>
                | ATS.PipeSchema<infer TInner>
                | ATS.TransformSchema<infer TInner>
            ? NestedFactoryModeCandidates<TInner>
            : never;

type ModeRank<TMode extends FactoryReturnMode> = TMode extends "tuple" ? 0 : TMode extends "either" ? 1 : 2;
type IsHigherModeCandidate<TLeft, TRight> = TLeft extends FactoryModeCandidate
  ? TRight extends FactoryModeCandidate
    ? CompareNumericLiteral<TLeft["priority"], TRight["priority"]> extends "gt"
      ? true
      : CompareNumericLiteral<TLeft["priority"], TRight["priority"]> extends "eq"
        ? ModeRank<TLeft["mode"]> extends ModeRank<TRight["mode"]>
          ? false
          : ModeRank<TLeft["mode"]> extends 2
            ? true
            : ModeRank<TRight["mode"]> extends 2
              ? false
              : ModeRank<TLeft["mode"]> extends 1
                ? true
                : false
        : false
    : false
  : false;
type HasHigherModeCandidate<TCandidate, TAll> = TAll extends unknown ? IsHigherModeCandidate<TAll, TCandidate> : never;
type HighestModeCandidates<TAll, TCandidate = TAll> = TCandidate extends FactoryModeCandidate
  ? true extends HasHigherModeCandidate<TCandidate, TAll>
    ? never
    : TCandidate
  : never;
type InheritedFactoryModeFor<TSchema extends ATS.AnyTypeSchema> = [NestedFactoryModeCandidates<TSchema>] extends [never]
  ? "throw"
  : HighestModeCandidates<NestedFactoryModeCandidates<TSchema>>["mode"];

type DeclaredFactoryError<TError> = unknown extends TError ? never : [TError] extends [undefined] ? never : TError;

/** @internal Type helper shared by the runtime-class type contracts. */
export type NestedFactoryErrors<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.RuntimeTypeSchema<ATS.AnyTypeSchema, unknown, "object" | "value", boolean, infer TTraits>
    ? TTraits["factoryPolicy"] extends { readonly configured: true; readonly errorType: infer TError }
      ? DeclaredFactoryError<TError>
      : never
    : TSchema extends ATS.ObjectSchema<infer TShape>
      ? NestedFactoryErrors<TShape[keyof TShape]>
      : TSchema extends ATS.ArraySchema<infer TElement> | ATS.SetSchema<infer TElement>
        ? NestedFactoryErrors<TElement>
        : TSchema extends ATS.LazySchema<infer TInner>
          ? NestedFactoryErrors<TInner>
          : TSchema extends
                | ATS.OptionalSchema<infer TInner>
                | ATS.NullableSchema<infer TInner>
                | ATS.NullishSchema<infer TInner>
                | ATS.DefaultSchema<infer TInner>
                | ATS.BrandSchema<infer TInner>
                | ATS.ReadonlySchema<infer TInner>
                | ATS.RefineSchema<infer TInner>
                | ATS.CoerceSchema<infer TInner>
                | ATS.PipeSchema<infer TInner>
                | ATS.TransformSchema<infer TInner>
            ? NestedFactoryErrors<TInner>
            : never;

/** @internal Type helper used by the runtime-class implementation. */
/** @internal Type helper shared by the runtime-class type contracts. */
export type InitialRuntimeTypeTraits<TSchema extends ATS.AnyTypeSchema> = [
  NestedFactoryModeCandidates<TSchema>,
] extends [never]
  ? ClassRuntimeTraits
  : ATS.RuntimeTypeTraits<
      "object",
      false,
      ATS.RuntimeTypeFactoryPolicyTraits<
        InheritedFactoryModeFor<TSchema>,
        true,
        unknown,
        NestedFactoryModeCandidates<TSchema>["priority"]
      > & {
        readonly resultModeExplicit: false;
        readonly resultModeInherited: true;
        readonly hasAssertions: false;
      }
    >;

/** @internal Type helper shared by the runtime-class type contracts. */
export type InheritedFactoryMode<TSchema extends ATS.AnyTypeSchema> = InheritedFactoryModeFor<TSchema>;
