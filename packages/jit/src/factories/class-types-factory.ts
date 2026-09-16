import type { ClassFactoryMemberDescriptor, ClassMemberDescriptor } from "../classes/member-descriptors.js";
import type { QueryConditionNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import type { ResolveTypeofSchema } from "../core/ats/typeof.js";
import type { FactoryReturnMode, FactoryReturnModeInput } from "../core/factory-policy.js";
import type { DomainAssertionError, JITValidationError } from "../errors/index.js";
import type { StructuralValueMethods } from "./class-types-capability.js";
import type {
  AnyClassExtension,
  AssertionOptions,
  AssertionTraits,
  ClassExtensionArgs,
  ClassRuntimeTraits,
  FactoryOutcome,
  FactoryTraits,
  FactoryValidationOptions,
} from "./class-types-extension.js";
import type {
  ConstructorRuntimeClass,
  FactoryOptions,
  InheritedFactoryMode,
  InitialRuntimeTypeTraits,
  NestedFactoryErrors,
  RuntimeClass,
  RuntimeClassConstructionMembers,
} from "./class-types-runtime.js";
import type {
  ApplySchemaOverrides,
  ClassConstructorInput,
  ClassCreateInput,
  ClassHydrateInput,
  ExtendedInstance,
} from "./class-types-schema.js";
import type { IdentityKeys, InternalInstance } from "./class-types-state.js";
import type { QueryConditionBuilder } from "./query.js";

/** Visibility applied to a generated field or accessor. `false` omits it. */
export type AccessorVisibility = "public" | "protected" | "private" | false;

/** Describes the JIT accessor member contract used by the public API. */
export interface AccessorMember {
  readonly name?: string;
  readonly visibility?: AccessorVisibility;
}

/** Describes the JIT field accessor options contract used by the public API. */
interface FieldAccessorOptions {
  readonly field?: AccessorVisibility;
  readonly get?: AccessorVisibility | AccessorMember;
  readonly set?: AccessorVisibility | AccessorMember;
}

/** Describes the JIT accessor options contract used by the public API. */
export interface AccessorOptions<TSchema extends ATS.AnyTypeSchema> {
  readonly default?: FieldAccessorOptions;
  readonly fields?: Partial<Record<Extract<keyof ATS.TypeofSchema<TSchema>, string>, FieldAccessorOptions>>;
}

type RuntimeConstructor<TInstance> = abstract new (...args: never[]) => TInstance;
/** @internal Type helper used by the runtime-class implementation. */
/** @internal Type helper shared by the runtime-class type contracts. */
export type CreateArguments<TSchema extends ATS.AnyTypeSchema> =
  undefined extends ClassCreateInput<TSchema>
    ? [] | [input: ClassCreateInput<TSchema>]
    : [input: ClassCreateInput<TSchema>];

type FactoryOptionName<TValue> = TValue extends string
  ? TValue
  : TValue extends ClassMemberDescriptor<infer TDefinition>
    ? TDefinition extends ClassFactoryMemberDescriptor
      ? TDefinition["name"]
      : never
    : never;

type FactoryMethods<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TOptions extends FactoryOptions,
  TMode = "throw",
  TError = JITValidationError,
> = (TOptions extends { readonly create: infer TValue }
  ? FactoryOptionName<TValue> extends infer TName extends string
    ? {
        [TKey in TName]: <TThis extends RuntimeConstructor<TInstance>>(
          this: TThis,
          ...args: CreateArguments<TSchema>
        ) => FactoryOutcome<InstanceType<TThis>, TMode, TError>;
      }
    : never
  : TOptions extends { readonly create: false }
    ? {}
    : {
        create<TThis extends RuntimeConstructor<TInstance>>(
          this: TThis,
          ...args: CreateArguments<TSchema>
        ): FactoryOutcome<InstanceType<TThis>, TMode, TError>;
      }) &
  (TOptions extends { readonly hydrate: infer TValue }
    ? FactoryOptionName<TValue> extends infer TName extends string
      ? {
          [TKey in TName]: <TThis extends RuntimeConstructor<TInstance>>(
            this: TThis,
            state: ClassHydrateInput<TSchema>
          ) => FactoryOutcome<InstanceType<TThis>, TMode, TError>;
        }
      : never
    : TOptions extends { readonly hydrate: false }
      ? {}
      : {
          hydrate<TThis extends RuntimeConstructor<TInstance>>(
            this: TThis,
            state: ClassHydrateInput<TSchema>
          ): FactoryOutcome<InstanceType<TThis>, TMode, TError>;
        });

type ResolvedResultMode<TPolicy, TDefault extends FactoryReturnMode = "throw"> = TPolicy extends {
  readonly result: infer TMode extends FactoryReturnModeInput;
}
  ? TMode
  : TDefault;
type ResolvedResultModeExplicit<TPolicy> = TPolicy extends {
  readonly result: FactoryReturnModeInput;
}
  ? true
  : false;
type ResolvedResultModeInherited<TTraits extends ATS.RuntimeTypeTraits, TPolicy> = TPolicy extends {
  readonly result: FactoryReturnModeInput;
}
  ? false
  : TTraits["factoryPolicy"]["resultModeInherited"];
type ResolvedFactoryPriority<TPolicy, TDefault extends number> = TPolicy extends {
  readonly result: FactoryReturnModeInput;
}
  ? TPolicy extends { readonly priority: infer TPriority extends number }
    ? TPriority
    : 1000
  : TPolicy extends { readonly priority: infer TPriority extends number }
    ? TPriority
    : TDefault;
type LiteralPriorityPolicy<TPolicy> = TPolicy extends { readonly priority: infer TPriority extends number }
  ? number extends TPriority
    ? { readonly priority: never }
    : {}
  : {};
type ResolvedFactoryError<TPolicy, TError, TSchema extends ATS.AnyTypeSchema> = TPolicy extends {
  readonly error: (...args: never[]) => infer TNext;
}
  ? TNext
  : TError | NestedFactoryErrors<TSchema>;
type ResolvedAssertionError<TOptions, TError> = TOptions extends {
  readonly error: (...args: never[]) => infer TNext;
}
  ? TError | TNext
  : TError | DomainAssertionError;

/** Describes the JIT configured runtime class contract used by the public API. */
export type ConfiguredRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TOptions extends FactoryOptions,
  TMode extends FactoryReturnMode = "throw",
  TError = JITValidationError,
  TValidated extends boolean = false,
  TFactoriesConfigured extends boolean = false,
  TTraits extends ATS.RuntimeTypeTraits = ClassRuntimeTraits,
  TEncapsulated extends boolean = false,
> = (abstract new (
  input: ClassConstructorInput<TSchema>
) => TInstance) &
  Omit<RuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>, RuntimeClassConstructionMembers> &
  FactoryMethods<TSchema, TInstance, TOptions, TMode, TError> & {
    extends<const TExtensions extends readonly AnyClassExtension[]>(
      ...extensions: TExtensions & ClassExtensionArgs<TSchema, TInstance, TExtensions, TEncapsulated>
    ): ConfiguredRuntimeClass<
      ApplySchemaOverrides<TSchema, TExtensions>,
      ExtendedInstance<TSchema, TInstance, TExtensions, TEncapsulated>,
      TOptions,
      TMode,
      TError,
      TValidated,
      TFactoriesConfigured,
      TTraits,
      TEncapsulated
    >;
    accessors(
      options: AccessorOptions<TSchema>
    ): (abstract new (
      input: ClassConstructorInput<TSchema>
    ) => TInstance) &
      Omit<
        ConfiguredRuntimeClass<
          TSchema,
          TInstance,
          TOptions,
          TMode,
          TError,
          TValidated,
          TFactoriesConfigured,
          TTraits,
          TEncapsulated
        >,
        "accessors"
      >;
    /** Adds one domain invariant, written in the shared condition builder. */
    assert<const TAssertion extends AssertionOptions = Record<never, never>>(
      predicate: (query: QueryConditionBuilder<ATS.TypeofSchema<TSchema>>) => QueryConditionNode,
      options?: TAssertion
    ): ConfiguredRuntimeClass<
      TSchema,
      TInstance,
      TOptions,
      TMode,
      ResolvedAssertionError<TAssertion, TError> | NestedFactoryErrors<TSchema>,
      TValidated,
      TFactoriesConfigured,
      AssertionTraits<TTraits, ResolvedAssertionError<TAssertion, TError>>,
      TEncapsulated
    >;
  } & (TValidated extends true
    ? object
    : {
        /** Fixes the factory validation policy exactly once for this artifact. */
        validate<const TPolicy extends FactoryValidationOptions = Record<never, never>>(
          policy?: TPolicy & FactoryValidationOptions & LiteralPriorityPolicy<TPolicy>
        ): ConfiguredRuntimeClass<
          TSchema,
          TInstance,
          TOptions,
          ResolvedResultMode<TPolicy, TMode>,
          ResolvedFactoryError<TPolicy, TError, TSchema>,
          true,
          TFactoriesConfigured,
          FactoryTraits<
            TTraits,
            Extract<ResolvedResultMode<TPolicy, TMode>, FactoryReturnMode>,
            ResolvedFactoryError<TPolicy, TError, TSchema>,
            true,
            false,
            ResolvedResultModeExplicit<TPolicy>,
            ResolvedResultModeInherited<TTraits, TPolicy>,
            ResolvedFactoryPriority<TPolicy, TTraits["factoryPolicy"]["priority"]>
          >,
          TEncapsulated
        >;
      }) &
  (TValidated extends true
    ? object
    : TFactoriesConfigured extends true
      ? object
      : {
          construction(mode: "constructor"): ConstructionFixedConstructor<TSchema, TInstance, TTraits, TEncapsulated>;
          construction(
            mode: "factory"
          ): (abstract new (
            input: ClassConstructorInput<TSchema>
          ) => TInstance) &
            Omit<
              ConfiguredRuntimeClass<
                TSchema,
                TInstance,
                TOptions,
                TMode,
                TError,
                false,
                TFactoriesConfigured,
                TTraits,
                TEncapsulated
              >,
              "construction" | "factories"
            >;
        }) &
  (TFactoriesConfigured extends true
    ? object
    : {
        factories<const TNext extends FactoryOptions>(
          options: TNext
        ): ConfiguredRuntimeClass<TSchema, TInstance, TNext, TMode, TError, TValidated, true, TTraits, TEncapsulated>;
      });

/** Describes the JIT factory runtime class contract used by the public API. */
export type FactoryRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance = ATS.TypeofSchema<TSchema>,
  TTraits extends ATS.RuntimeTypeTraits = InitialRuntimeTypeTraits<TSchema>,
  TEncapsulated extends boolean = false,
> = ConfiguredRuntimeClass<
  TSchema,
  TInstance,
  {},
  InheritedFactoryMode<TSchema>,
  JITValidationError,
  false,
  false,
  TTraits,
  TEncapsulated
>;

/** Entity declaration before a structural identifier extension is applied. */
export type PendingEntityRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TTraits extends ATS.RuntimeTypeTraits = InitialRuntimeTypeTraits<TSchema>,
> = Omit<FactoryRuntimeClass<TSchema, TInstance, TTraits, true>, "create" | "hydrate" | "factories" | "extends"> & {
  extends<const TExtensions extends readonly AnyClassExtension[]>(
    ...extensions: TExtensions & ClassExtensionArgs<TSchema, TInstance, TExtensions, true>
  ): EntityRuntimeClassFor<
    ApplySchemaOverrides<TSchema, TExtensions>,
    ExtendedInstance<TSchema, TInstance, TExtensions, true>,
    TTraits
  >;
};

/** @internal Type helper used by the runtime-class implementation. */
/** @internal Type helper shared by the runtime-class type contracts. */
export type EntityRuntimeClassFor<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TTraits extends ATS.RuntimeTypeTraits = InitialRuntimeTypeTraits<TSchema>,
> = [IdentityKeys<TSchema>] extends [never]
  ? PendingEntityRuntimeClass<TSchema, TInstance, TTraits>
  : FactoryRuntimeClass<TSchema, TInstance, TTraits, true>;

/** @internal Type helper used by the runtime-class implementation. */
/** @internal Type helper shared by the runtime-class type contracts. */
export type DddInstance<
  TSchema extends ATS.AnyTypeSchema,
  TIdentityKeys extends PropertyKey = IdentityKeys<TSchema>,
> = InternalInstance<TSchema, Readonly<ResolveTypeofSchema<TSchema>> & StructuralValueMethods, TIdentityKeys>;

/** @internal Type helper shared by the runtime-class type contracts. */
export type ConstructionFixedConstructor<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TTraits extends ATS.RuntimeTypeTraits = ClassRuntimeTraits,
  TEncapsulated extends boolean = false,
> = (new (
  input: ClassConstructorInput<TSchema>
) => TInstance) &
  Omit<ConstructorRuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>, "construction" | "factories">;

/** @internal Type helper shared by the runtime-class type contracts. */
export type ConstructionFixedFactory<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TTraits extends ATS.RuntimeTypeTraits = ClassRuntimeTraits,
  TEncapsulated extends boolean = false,
> = (abstract new (
  input: ClassConstructorInput<TSchema>
) => TInstance) &
  Omit<FactoryRuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>, "construction" | "factories">;

/** @internal Type helper used by the runtime-class implementation. */
/** @internal Type helper shared by the runtime-class type contracts. */
export type ScalarFactoryRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TTraits extends ATS.RuntimeTypeTraits = ClassRuntimeTraits,
  TEncapsulated extends boolean = false,
> = (abstract new (
  input: ClassConstructorInput<TSchema>
) => TInstance) &
  Omit<FactoryRuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>, "accessors" | "assert">;

type IdentifierRuntimeTraits = ATS.RuntimeTypeTraits<"value", true, ATS.DefaultRuntimeTypeFactoryPolicyTraits>;

/** @internal Type helper used by the runtime-class implementation. */
/** @internal Type helper shared by the runtime-class type contracts. */
export type IdentifierRuntimeClass<TSchema extends ATS.AnyTypeSchema, TInstance> = ScalarFactoryRuntimeClass<
  TSchema,
  TInstance,
  IdentifierRuntimeTraits
> & {
  readonly schema: ATS.RuntimeTypeSchema<TSchema, TInstance, "value", true, IdentifierRuntimeTraits>;
};

/** A generated base constructor that cannot itself be instantiated through `create` or `hydrate`. */
export type AbstractRuntimeClass<
  TSchema extends ATS.AnyTypeSchema,
  TInstance = ATS.TypeofSchema<TSchema>,
  TTraits extends ATS.RuntimeTypeTraits = ClassRuntimeTraits,
  TEncapsulated extends boolean = false,
> = (abstract new (
  input: ClassConstructorInput<TSchema>
) => TInstance) &
  Omit<RuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>, RuntimeClassConstructionMembers> & {
    extends<const TExtensions extends readonly AnyClassExtension[]>(
      ...extensions: TExtensions & ClassExtensionArgs<TSchema, TInstance, TExtensions, TEncapsulated>
    ): AbstractRuntimeClass<
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
    accessors(
      options: AccessorOptions<TSchema>
    ): (abstract new (
      input: ClassConstructorInput<TSchema>
    ) => TInstance) &
      Omit<AbstractRuntimeClass<TSchema, TInstance, TTraits, TEncapsulated>, "accessors">;
  };
