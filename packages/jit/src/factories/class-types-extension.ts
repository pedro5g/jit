import type { ClassMemberDescriptor, ClassMemberVisibility } from "../classes/member-descriptors.js";
import type { OverrideDescriptor } from "../classes/override.js";
import type { AssertionErrorFactory } from "../compiler/assertion.js";
import type * as ATS from "../core/ats/index.js";
import type { ResolveTypeofSchema } from "../core/ats/typeof.js";
import type { SchemaInput } from "../core/builder/index.js";
import type { FactoryReturnMode, FactoryReturnModeInput } from "../core/factory-policy.js";
import type { ValidationIssue } from "../errors/index.js";
import { FACTORY_FAILURE } from "./class-policy.js";
import type {
  AnyClassCapability,
  ClassCapability,
  ClassMethodsInput,
  ClassMixin,
  NamedMethod,
} from "./class-types-capability.js";
import type {
  AddSchemaFields,
  ApplyClassExtensionSchema,
  ExtendedInstance,
  NonConflictingCapability,
  SchemaFromInput,
} from "./class-types-schema.js";
import type {
  DomainState,
  ExtensionThisSurface,
  IdentityKeys,
  IdentityKeysFromInstance,
  InternalInstance,
  ManagedSchemaKeys,
  MixinRequirementsMet,
} from "./class-types-state.js";

/** Describes the JIT construction mode contract used by the public API. */
export type ConstructionMode = "constructor" | "factory";

/** How a factory reports a rejected input. Fixed at declaration, never per call. */

/** Provides the JIT factory failure operation for the supplied input. */
export interface FactoryFailure<TError> {
  readonly [FACTORY_FAILURE]: true;
  readonly ok: false;
  readonly error: TError;
}

/** Provides the JIT class json options operation for the supplied input. */
export interface ClassJsonOptions {
  readonly method?: string;
}

type ClassJsonMethods<TOptions extends ClassJsonOptions> = NamedMethod<
  TOptions["method"] extends string ? TOptions["method"] : "toJson",
  () => string
>;

/** Provides the JIT class json capability operation for the supplied input. */
export interface ClassJsonCapability<TOptions extends ClassJsonOptions = ClassJsonOptions>
  extends ClassCapability<ClassJsonMethods<TOptions>> {
  readonly kind: "class.json";
  readonly __options?: TOptions;
}

/** Provides the JIT factory either operation for the supplied input. */
export type FactoryEither<TValue, TError> = TValue | FactoryFailure<TError>;

/** @internal Type helper shared by the runtime-class type contracts. */
export type ClassRuntimeTraits = ATS.DefaultRuntimeTypeTraits;
/** @internal Type helper shared by the runtime-class type contracts. */
export type FactoryTraits<
  TTraits extends ATS.RuntimeTypeTraits,
  TMode extends FactoryReturnMode,
  TError,
  TConfigured extends boolean,
  TAssertions extends boolean = false,
  TModeExplicit extends boolean = false,
  TModeInherited extends boolean = false,
  TPriority extends number = TTraits["factoryPolicy"]["priority"],
> = ATS.RuntimeTypeTraits<
  TTraits["representation"],
  TTraits["identifier"],
  ATS.RuntimeTypeFactoryPolicyTraits<TMode, TConfigured, TError, TPriority> & {
    readonly resultModeExplicit: TModeExplicit;
    readonly resultModeInherited: TModeInherited;
    readonly hasAssertions: TAssertions;
  }
>;

/** @internal Type helper shared by the runtime-class type contracts. */
export type AssertionTraits<TTraits extends ATS.RuntimeTypeTraits, TError> = ATS.RuntimeTypeTraits<
  TTraits["representation"],
  TTraits["identifier"],
  Omit<TTraits["factoryPolicy"], "errorType" | "hasAssertions"> & {
    readonly errorType: TError;
    readonly hasAssertions: true;
    readonly validationConfigured: boolean;
  }
>;

/** The failure channel and the phases it covers. */
export interface FactoryValidationOptions {
  readonly result?: FactoryReturnModeInput;
  /** Stops diagnostic validation as soon as this many issues have been emitted. */
  readonly maxIssues?: number;
  /** Builds the error a rejected input produces; defaults to `JITValidationError`. */
  readonly error?: (issues: readonly ValidationIssue[]) => unknown;
  /** Larger values win when several declared error candidates can apply. */
  readonly priority?: number;
  readonly create?: boolean;
  readonly hydrate?: boolean;
}

/** Describes the JIT factory construction context contract used by the public API. */
export interface FactoryConstructionContext<TInstance = unknown> {
  readonly construct: (state: unknown) => TInstance;
}

/** Describes the JIT assertion options contract used by the public API. */
export interface AssertionOptions {
  /** Identifier reported by the failure; defaults to the field the condition names. */
  readonly rule?: string;
  /** Machine-readable issue code; defaults to `custom`. */
  readonly code?: string;
  readonly message?: string;
  /** Builds the error this assertion produces; defaults to `DomainAssertionError`. */
  readonly error?: AssertionErrorFactory;
  /** Larger values win between failed assertion error candidates. */
  readonly priority?: number;
}

/** A successful or rejected factory call, in the shape the policy declared. */
export type FactoryOutcome<TInstance, TMode, TError> = TMode extends "either"
  ? FactoryEither<TInstance, TError>
  : TMode extends "tuple"
    ? readonly [TError, null] | readonly [null, TInstance]
    : TInstance;

/** A generated runtime constructor backed by one object schema. */
/**
 * One argument of `.extends()`: a built-in capability or an object of methods.
 *
 * The object is typed with `ThisType` of the instance the class already has,
 * so a body reads its own fields and its already-installed capabilities and
 * nothing else. A name the instance already carries is rejected here rather
 * than shadowing something at run time.
 */
export type ClassExtensionArgs<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TExtensions extends readonly AnyClassExtension[],
  TEncapsulated extends boolean = false,
> = ResolveClassExtensionArgs<TSchema, TInstance, TExtensions, TEncapsulated>;

type ResolveClassExtensionArgs<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TExtensions extends readonly AnyClassExtension[],
  TEncapsulated extends boolean,
> = number extends TExtensions["length"]
  ? ClassExtensionArgument<TSchema, TInstance, TExtensions[number], TEncapsulated>[]
  : TExtensions extends readonly [
        infer THead extends AnyClassExtension,
        ...infer TTail extends readonly AnyClassExtension[],
      ]
    ? [
        ClassExtensionArgument<TSchema, TInstance, THead, TEncapsulated>,
        ...ResolveClassExtensionArgs<
          ApplyClassExtensionSchema<TSchema, THead>,
          ExtendedInstance<TSchema, TInstance, [THead], TEncapsulated>,
          TTail,
          TEncapsulated
        >,
      ]
    : [];

/** @internal Type helper shared by the runtime-class type contracts. */
export type ClassExtensionArgument<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TExtension extends AnyClassExtension,
  TEncapsulated extends boolean,
> = TExtension extends AnyClassCapability
  ? NonConflictingCapability<TExtension, TSchema, TInstance>
  : TExtension extends ClassMixin
    ? MixinRequirementsMet<TSchema, TExtension> extends true
      ? TExtension
      : never
    : TExtension extends (...args: never[]) => infer TOutput
      ? TOutput extends ClassMethodsInput
        ? (builder: ClassExtensionBuilder<TSchema, TInstance, TEncapsulated>) => TOutput
        : never
      : TExtension &
          ThisType<ExtensionThisSurface<TSchema, TInstance, TExtension, TEncapsulated>> &
          Partial<Record<Extract<NonOverrideMemberKeys<TExtension>, keyof TInstance>, never>> &
          Partial<Record<Exclude<ExtensionOverrideMemberKeys<TExtension>, keyof TInstance>, never>>;

type NonOverrideMemberKeys<TExtension> =
  TExtension extends Record<string, unknown>
    ? {
        [TName in keyof TExtension]: IsOverrideValue<TExtension[TName]> extends true ? never : TName;
      }[keyof TExtension]
    : never;
type ExtensionOverrideMemberKeys<TExtension> =
  TExtension extends Record<string, unknown>
    ? {
        [TName in keyof TExtension]: IsOverrideValue<TExtension[TName]> extends true ? TName : never;
      }[keyof TExtension]
    : never;
/** @internal Type helper shared by the runtime-class type contracts. */
export type IsAny<TValue> = 0 extends 1 & TValue ? true : false;
/** @internal Type helper shared by the runtime-class type contracts. */
export type IsOverrideValue<TValue> =
  IsAny<TValue> extends true ? false : TValue extends OverrideDescriptor ? true : false;

/** Provides the JIT class extension builder operation for the supplied input. */
export interface ClassExtensionBuilder<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TEncapsulated extends boolean = false,
> {
  /** Declares an anonymous extension field. */
  field<TField extends SchemaInput<ATS.AnyTypeSchema>>(
    schema: TField
  ): ClassExtensionFieldBuilder<TSchema, TInstance, string, TField, TEncapsulated>;
  /** The name is explicit so the setter `this` type remains exact. */
  field<const TName extends string, TField extends SchemaInput<ATS.AnyTypeSchema>>(
    name: TName,
    schema: TField
  ): ClassExtensionFieldBuilder<TSchema, TInstance, TName, TField, TEncapsulated>;
}

type FieldSchema<TField> = SchemaFromInput<TField> extends infer TSchema extends ATS.AnyTypeSchema ? TSchema : never;
type FieldOutput<TField> = ResolveTypeofSchema<FieldSchema<TField>>;
type FieldExtensionInstance<TInstance, TName extends string, TField> = string extends TName
  ? TInstance
  : TInstance & {
      readonly [TKey in TName]: FieldOutput<TField>;
    };
type FieldExtensionThis<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TName extends string,
  TField,
  TEncapsulated extends boolean,
> = TEncapsulated extends true
  ? string extends TName
    ? Omit<
        InternalInstance<
          TSchema,
          TInstance,
          IdentityKeysFromInstance<TInstance> extends never
            ? IdentityKeys<TSchema>
            : IdentityKeysFromInstance<TInstance>
        >,
        "_props"
      > & {
        /** The outer object key is unavailable inside this nested callback. */
        readonly _props: Extract<
          DomainState<
            TSchema,
            IdentityKeysFromInstance<TInstance> extends never
              ? IdentityKeys<TSchema>
              : IdentityKeysFromInstance<TInstance>
          >,
          object
        > &
          Record<string, FieldOutput<TField>>;
      }
    : ContextualInternalInstance<
        AddSchemaFields<TSchema, { [TKey in TName]: TField }>,
        FieldExtensionInstance<TInstance, TName, TField>,
        IdentityKeysFromInstance<TInstance> extends never ? IdentityKeys<TSchema> : IdentityKeysFromInstance<TInstance>
      >
  : FieldExtensionInstance<TInstance, TName, TField>;

/** @internal Type helper shared by the runtime-class type contracts. */
export type ContextualInternalInstance<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TIdentityKeys extends PropertyKey,
> = Omit<InternalInstance<TSchema, TInstance, TIdentityKeys>, "_props"> & {
  readonly _props: Extract<DomainState<TSchema, TIdentityKeys, ManagedSchemaKeys<TSchema>>, object>;
};

type FieldBuilderDefinition<
  TField extends SchemaInput<ATS.AnyTypeSchema>,
  TVisibility extends ClassMemberVisibility,
  TGetter extends Function | undefined,
  TSetter extends Function | undefined,
> = {
  readonly kind: "field";
  readonly schema: TField;
  readonly visibility: TVisibility;
} & (TGetter extends Function ? { readonly getter: TGetter } : {}) &
  (TSetter extends Function ? { readonly setter: TSetter } : {});

/** Provides the JIT class extension field builder operation for the supplied input. */
export interface ClassExtensionFieldBuilder<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TName extends string,
  TField extends SchemaInput<ATS.AnyTypeSchema>,
  TEncapsulated extends boolean = false,
  TVisibility extends ClassMemberVisibility = "public",
  TGetter extends Function | undefined = undefined,
  TSetter extends Function | undefined = undefined,
> extends ClassMemberDescriptor<FieldBuilderDefinition<TField, TVisibility, TGetter, TSetter>> {
  /** Marks the extension field as publicly accessible. */
  public(): ClassExtensionFieldBuilder<TSchema, TInstance, TName, TField, TEncapsulated, "public", TGetter, TSetter>;
  /** Marks the extension field as protected in the generated type surface. */
  protected(): ClassExtensionFieldBuilder<
    TSchema,
    TInstance,
    TName,
    TField,
    TEncapsulated,
    "protected",
    TGetter,
    TSetter
  >;
  /** Marks the extension field as private in the generated type surface. */
  private(): ClassExtensionFieldBuilder<TSchema, TInstance, TName, TField, TEncapsulated, "private", TGetter, TSetter>;
  /** Supplies a getter for the extension field. */
  getter(
    implementation: (this: FieldExtensionThis<TSchema, TInstance, TName, TField, TEncapsulated>) => FieldOutput<TField>
  ): ClassExtensionFieldBuilder<
    TSchema,
    TInstance,
    TName,
    TField,
    TEncapsulated,
    TVisibility,
    (this: FieldExtensionThis<TSchema, TInstance, TName, TField, TEncapsulated>) => FieldOutput<TField>,
    TSetter
  >;
  /** Supplies a setter for the extension field. */
  setter(
    implementation: (
      this: FieldExtensionThis<TSchema, TInstance, TName, TField, TEncapsulated>,
      value: FieldOutput<TField>
    ) => void
  ): ClassExtensionFieldBuilder<
    TSchema,
    TInstance,
    TName,
    TField,
    TEncapsulated,
    TVisibility,
    TGetter,
    (this: FieldExtensionThis<TSchema, TInstance, TName, TField, TEncapsulated>, value: FieldOutput<TField>) => void
  >;
}

type AnyClassExtensionFactory = (
  builder: ClassExtensionBuilder<ATS.AnyTypeSchema, unknown, boolean>
) => ClassMethodsInput;
/** @internal Type helper used by the runtime-class implementation. */
/** @internal Type helper shared by the runtime-class type contracts. */
export type AnyClassExtension = AnyClassCapability | ClassMethodsInput | ClassMixin | AnyClassExtensionFactory;
