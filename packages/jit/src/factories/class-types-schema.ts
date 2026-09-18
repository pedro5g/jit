import type { ClassMemberDescriptor } from "../classes/member-descriptors.js";
import type { OverrideDescriptor } from "../classes/override.js";
import type * as ATS from "../core/ats/index.js";
import type { Input, Update as SchemaUpdate } from "../core/ats/input.js";
import type { Hydrate } from "../core/ats/representations.js";
import type { NO_CONSTRUCTOR_FIELD_MARKER } from "../core/ats/type-schema.js";
import type { SchemaInput } from "../core/builder/index.js";
import type {
  AnyClassCapability,
  ClassCapability,
  ClassCloneCapability,
  ClassMethodsInput,
  ClassMixin,
  ClassWithCapability,
  CloneMethods,
  NormalizedClassExtension,
  SoftDeleteCapability,
  TimestampCapability,
  VersionedCapability,
} from "./class-types-capability.js";
import type { AnyClassExtension, IsAny, IsOverrideValue } from "./class-types-extension.js";
import type { IdentityKeys, IdentityKeysFromInstance, InternalInstance } from "./class-types-state.js";

/** @internal Schemas whose wrappers preserve the nested Runtime Type contract. */
export type TransparentSchema<TInner extends ATS.AnyTypeSchema> =
  | ATS.OptionalSchema<TInner>
  | ATS.NullableSchema<TInner>
  | ATS.NullishSchema<TInner>
  | ATS.DefaultSchema<TInner>
  | ATS.BrandSchema<TInner>
  | ATS.ReadonlySchema<TInner>
  | ATS.RefineSchema<TInner>
  | ATS.CoerceSchema<TInner>
  | ATS.PipeSchema<TInner>
  | ATS.TransformSchema<TInner>;

/** @internal Type helper used while contextualizing structural mixin methods. */
export type MixinThisSurface<TFields extends ClassMethodsInput, TRequires extends ClassMethodsInput> = ATS.TypeofSchema<
  ATS.ObjectSchema<SchemaFieldShape<TFields & TRequires>>
>;

type CompatibleCapability<TCapability extends AnyClassCapability, _TSchema extends ATS.AnyTypeSchema> = TCapability;

declare const TIMESTAMPS_FIELD_MARKER: unique symbol;
declare const SOFT_DELETE_FIELD_MARKER: unique symbol;
declare const VERSIONED_FIELD_MARKER: unique symbol;

type SchemaContainsMarker<TSchema extends ATS.AnyTypeSchema, TMarker extends PropertyKey> =
  TSchema extends ATS.ObjectSchema<infer TShape>
    ? true extends {
        [TKey in keyof TShape]: TShape[TKey] extends { readonly [TKeyMarker in TMarker]: true } ? true : never;
      }[keyof TShape]
      ? true
      : false
    : false;

type CapabilityAlreadyInstalled<
  TCapability,
  TSchema extends ATS.AnyTypeSchema,
> = TCapability extends TimestampCapability
  ? SchemaContainsMarker<TSchema, typeof TIMESTAMPS_FIELD_MARKER>
  : TCapability extends SoftDeleteCapability
    ? SchemaContainsMarker<TSchema, typeof SOFT_DELETE_FIELD_MARKER>
    : TCapability extends VersionedCapability
      ? SchemaContainsMarker<TSchema, typeof VERSIONED_FIELD_MARKER>
      : false;

/** @internal Type helper shared by the runtime-class type contracts. */
export type NonConflictingCapability<
  TCapability extends AnyClassCapability,
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
> =
  CapabilityAlreadyInstalled<TCapability, TSchema> extends true
    ? never
    : Extract<
          Exclude<
            keyof MethodsForCapability<TCapability, TSchema, TInstance>,
            TCapability extends TimestampCapability | VersionedCapability ? "touch" : never
          >,
          keyof TInstance
        > extends never
      ? CompatibleCapability<TCapability, TSchema>
      : never;

/** Methods an extension contributes, keeping declared signatures intact. */
/** @internal Type helper shared by the runtime-class type contracts. */
export type MethodsForExtension<TExtension, TSchema extends ATS.AnyTypeSchema, TInstance> =
  TExtension extends ClassMixin<infer TOutput>
    ? MethodsForExtension<TOutput, TSchema, TInstance>
    : [TExtension] extends [never]
      ? {}
      : TExtension extends AnyClassCapability
        ? MethodsForCapability<TExtension, TSchema, TInstance>
        : TExtension extends Record<string, unknown>
          ? {
              -readonly [TKey in keyof TExtension as IsOverrideValue<TExtension[TKey]> extends true
                ? IsSchemaFieldInput<
                    TExtension[TKey] extends OverrideDescriptor<infer TValue> ? TValue : never
                  > extends true
                  ? never
                  : TKey
                : [IsHiddenClassMember<TExtension[TKey]>] extends [true]
                  ? never
                  : IsSchemaFieldInput<TExtension[TKey]> extends true
                    ? never
                    : TKey]: ExtensionMemberType<TExtension[TKey]>;
            }
          : {};

type ExtensionMemberType<TValue> =
  TValue extends OverrideDescriptor<infer TInner>
    ? ExtensionMemberType<TInner>
    : TValue extends ClassMemberDescriptor<infer TDefinition>
      ? TDefinition extends { readonly kind: "method"; readonly implementation?: infer TImplementation }
        ? TImplementation extends (...args: infer TArgs) => infer TResult
          ? (...args: TArgs) => TResult
          : never
        : TDefinition extends { readonly kind: "accessor"; readonly getter?: infer TGetter }
          ? TGetter extends (...args: never[]) => infer TResult
            ? TResult
            : unknown
          : never
      : TValue;

type ExtensionMethods<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TExtensions extends readonly AnyClassExtension[],
> = UnionToIntersection<MethodsForExtension<TExtensions[number], TSchema, TInstance>>;
type MethodsForCapability<
  TCapability,
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
> = TCapability extends ClassWithCapability
  ? { with(patch: SchemaUpdate<TSchema>): TInstance }
  : TCapability extends ClassCloneCapability
    ? CloneMethods
    : TCapability extends ClassCapability<infer TMethods>
      ? TMethods
      : never;
type UnionToIntersection<TValue> = (TValue extends unknown ? (value: TValue) => void : never) extends (
  value: infer TIntersection
) => void
  ? TIntersection
  : never;

type IsSchemaInput<TValue> =
  IsAny<TValue> extends true
    ? false
    : TValue extends ATS.AnyTypeSchema | { readonly schema: ATS.AnyTypeSchema }
      ? true
      : false;
type MemberDefinition<TValue> =
  IsAny<TValue> extends true ? never : TValue extends ClassMemberDescriptor<infer TDefinition> ? TDefinition : never;
type IsHiddenClassMember<TValue> =
  TValue extends OverrideDescriptor<infer TInner>
    ? IsHiddenClassMember<TInner>
    : [MemberDefinition<TValue>] extends [never]
      ? false
      : [MemberDefinition<TValue>] extends [{ readonly visibility: "protected" | "private" }]
        ? true
        : false;
type DescriptorSchema<TValue> =
  IsAny<TValue> extends true
    ? never
    : MemberDefinition<TValue> extends infer TDefinition
      ? TDefinition extends { readonly kind: "field"; readonly schema?: infer TSchema }
        ? TSchema extends SchemaInput<infer TInner extends ATS.AnyTypeSchema>
          ? TDefinition extends { readonly noConstructor: true }
            ? TInner & { readonly [NO_CONSTRUCTOR_FIELD_MARKER]: true }
            : TInner
          : never
        : never
      : never;
type IsDescriptorField<TValue> =
  IsAny<TValue> extends true ? false : [DescriptorSchema<TValue>] extends [never] ? false : true;
type IsSchemaFieldInput<TValue> = IsDescriptorField<TValue> extends true ? true : IsSchemaInput<TValue>;
/** @internal Type helper shared by the runtime-class type contracts. */
export type SchemaFromInput<TValue> = [DescriptorSchema<TValue>] extends [never]
  ? TValue extends { readonly schema: infer TSchema extends ATS.AnyTypeSchema }
    ? TSchema
    : TValue extends ATS.AnyTypeSchema
      ? TValue
      : never
  : DescriptorSchema<TValue>;
/** @internal Type helper shared by the runtime-class type contracts. */
export type SchemaFieldKeys<TExtension> =
  TExtension extends Record<string, unknown>
    ? {
        [TKey in keyof TExtension]: IsSchemaFieldInput<TExtension[TKey]> extends true ? TKey : never;
      }[keyof TExtension]
    : never;
/** @internal Type helper shared by the runtime-class type contracts. */
export type SchemaFieldShape<TExtension> =
  TExtension extends Record<string, unknown>
    ? { [TKey in SchemaFieldKeys<TExtension>]: SchemaFromInput<TExtension[TKey]> }
    : {};
type PreservedManagedMarker<TPrevious> = TPrevious extends {
  readonly [TKey in typeof TIMESTAMPS_FIELD_MARKER]: true;
}
  ? { readonly [TKey in typeof TIMESTAMPS_FIELD_MARKER]: true }
  : TPrevious extends { readonly [TKey in typeof SOFT_DELETE_FIELD_MARKER]: true }
    ? { readonly [TKey in typeof SOFT_DELETE_FIELD_MARKER]: true }
    : TPrevious extends { readonly [TKey in typeof VERSIONED_FIELD_MARKER]: true }
      ? { readonly [TKey in typeof VERSIONED_FIELD_MARKER]: true }
      : {};
type SchemaOverrideKeys<TExtension> =
  TExtension extends Record<string, unknown>
    ? {
        [TKey in keyof TExtension]: IsOverrideValue<TExtension[TKey]> extends true
          ? TExtension[TKey] extends OverrideDescriptor<infer TValue>
            ? IsSchemaFieldInput<TValue> extends true
              ? TKey
              : never
            : never
          : never;
      }[keyof TExtension]
    : never;
/** @internal Type helper shared by the runtime-class type contracts. */
export type ApplySchemaOverride<TSchema extends ATS.AnyTypeSchema, TExtension> =
  TSchema extends ATS.ObjectSchema<infer TShape, infer TUnknownKeys, infer TCatchall>
    ? TExtension extends Record<string, unknown>
      ? ATS.ObjectSchema<
          Omit<TShape, SchemaOverrideKeys<TExtension>> & {
            [TKey in keyof TExtension as IsOverrideValue<TExtension[TKey]> extends true
              ? TExtension[TKey] extends OverrideDescriptor<infer TValue>
                ? IsSchemaFieldInput<TValue> extends true
                  ? TKey
                  : never
                : never
              : never]: IsOverrideValue<TExtension[TKey]> extends true
              ? TExtension[TKey] extends OverrideDescriptor<infer TValue>
                ? SchemaFromInput<TValue> & PreservedManagedMarker<TShape[TKey & keyof TShape]>
                : never
              : never;
          },
          TUnknownKeys,
          TCatchall
        >
      : TSchema
    : TSchema;
/** @internal Type helper shared by the runtime-class type contracts. */
export type AddSchemaFields<TSchema extends ATS.AnyTypeSchema, TExtension> =
  TSchema extends ATS.ObjectSchema<infer TShape, infer TUnknownKeys, infer TCatchall>
    ? ATS.ObjectSchema<
        Omit<TShape, keyof SchemaFieldShape<TExtension>> & SchemaFieldShape<TExtension>,
        TUnknownKeys,
        TCatchall
      >
    : TSchema;
// INVARIANT: keep Date/number public while retaining the inner type for the
// managed-field marker; the create boundary makes these fields optional below.
type ManagedReadonlySchema<TInner extends ATS.AnyTypeSchema> = ATS.BaseSchema<
  ATS.TypeofSchema<TInner>,
  "readonly",
  ATS.InnerTypeDef<TInner>
>;
type ManagedCreatedAtSchema = ManagedReadonlySchema<ATS.DefaultSchema<ATS.DateSchema>> & {
  readonly [TIMESTAMPS_FIELD_MARKER]: true;
};
type ManagedUpdatedAtSchema = ManagedReadonlySchema<ATS.DefaultSchema<ATS.NullableSchema<ATS.DateSchema>>> & {
  readonly [TIMESTAMPS_FIELD_MARKER]: true;
};
type ManagedDeletedAtSchema = ManagedReadonlySchema<ATS.DefaultSchema<ATS.NullableSchema<ATS.DateSchema>>> & {
  readonly [SOFT_DELETE_FIELD_MARKER]: true;
};
type ManagedVersionSchema = ManagedReadonlySchema<ATS.DefaultSchema<ATS.IntSchema>> & {
  readonly [VERSIONED_FIELD_MARKER]: true;
};
/** @internal Type helper shared by the runtime-class type contracts. */
export type IsManagedFieldSchema<TSchema> = TSchema extends {
  readonly [TKey in typeof TIMESTAMPS_FIELD_MARKER]: true;
}
  ? true
  : TSchema extends { readonly [TKey in typeof SOFT_DELETE_FIELD_MARKER]: true }
    ? true
    : TSchema extends { readonly [TKey in typeof VERSIONED_FIELD_MARKER]: true }
      ? true
      : false;
type ManagedInputKeys<TShape extends ATS.SchemaShape> = {
  [TKey in keyof TShape]: IsManagedFieldSchema<TShape[TKey]> extends true ? TKey : never;
}[keyof TShape];
type IsNoConstructorField<TSchema> = TSchema extends {
  readonly [TKey in typeof NO_CONSTRUCTOR_FIELD_MARKER]: true;
}
  ? true
  : false;
type BoundaryExcludedKeys<TShape extends ATS.SchemaShape> = {
  [TKey in keyof TShape]: IsNoConstructorField<TShape[TKey]> extends true ? TKey : never;
}[keyof TShape];
type CreateInputForSchema<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.ObjectSchema<infer TShape>
    ? Omit<Input<TSchema>, ManagedInputKeys<TShape> | BoundaryExcludedKeys<TShape>> &
        Partial<Pick<Input<TSchema>, Extract<ManagedInputKeys<TShape>, keyof Input<TSchema>>>>
    : Input<TSchema>;

/** Create boundaries resolve defaults while retaining optional managed fields. */
export type ClassCreateInput<TSchema extends ATS.AnyTypeSchema> = CreateInputForSchema<TSchema>;

/** Hydration is a complete persisted boundary and never resolves defaults. */
export type ClassHydrateInput<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.ObjectSchema<infer TShape>
    ? Omit<Hydrate<TSchema>, BoundaryExcludedKeys<TShape>>
    : Hydrate<TSchema>;

/** Constructor input is a creation boundary, excluding generated fields. */
export type ClassConstructorInput<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.ObjectSchema<infer TShape> ? Omit<Input<TSchema>, BoundaryExcludedKeys<TShape>> : Input<TSchema>;

type CapabilityFieldShape<TCapability> =
  TCapability extends TimestampCapability<infer TOptions>
    ? {
        [TKey in TOptions["createdAt"] extends string ? TOptions["createdAt"] : "createdAt"]: ManagedCreatedAtSchema;
      } & {
        [TKey in TOptions["updatedAt"] extends string ? TOptions["updatedAt"] : "updatedAt"]: ManagedUpdatedAtSchema;
      }
    : TCapability extends SoftDeleteCapability<infer TOptions>
      ? { [TKey in TOptions["field"] extends string ? TOptions["field"] : "deletedAt"]: ManagedDeletedAtSchema }
      : TCapability extends VersionedCapability<infer TOptions>
        ? { [TKey in TOptions["field"] extends string ? TOptions["field"] : "version"]: ManagedVersionSchema }
        : {};
type AddCapabilitySchema<TSchema extends ATS.AnyTypeSchema, TCapability> =
  TSchema extends ATS.ObjectSchema<infer TShape, infer TUnknownKeys, infer TCatchall>
    ? ATS.ObjectSchema<
        Omit<TShape, keyof CapabilityFieldShape<TCapability>> & CapabilityFieldShape<TCapability>,
        TUnknownKeys,
        TCatchall
      >
    : TSchema;
/** @internal Type helper shared by the runtime-class type contracts. */
export type ApplyClassExtensionSchema<TSchema extends ATS.AnyTypeSchema, TExtension> = [TExtension] extends [never]
  ? TSchema
  : NormalizedClassExtension<TExtension> extends AnyClassCapability
    ? AddCapabilitySchema<TSchema, NormalizedClassExtension<TExtension>>
    : AddSchemaFields<
        ApplySchemaOverride<TSchema, NormalizedClassExtension<TExtension>>,
        NormalizedClassExtension<TExtension>
      >;
/** @internal Type helper shared by the runtime-class type contracts. */
export type ApplySchemaOverrides<
  TSchema extends ATS.AnyTypeSchema,
  TExtensions extends readonly AnyClassExtension[],
> = TExtensions extends readonly [infer THead, ...infer TTail extends readonly AnyClassExtension[]]
  ? ApplySchemaOverrides<ApplyClassExtensionSchema<TSchema, THead>, TTail>
  : TSchema;
type OverrideMemberKeys<TExtension> = TExtension extends AnyClassCapability
  ? never
  : TExtension extends Record<string, unknown>
    ? {
        [TKey in keyof TExtension]: TExtension[TKey] extends OverrideDescriptor ? TKey : never;
      }[keyof TExtension]
    : never;
type AllOverrideMemberKeys<TExtensions extends readonly AnyClassExtension[]> =
  TExtensions[number] extends infer TExtension ? OverrideMemberKeys<TExtension> : never;
type LifecycleUpdateMethod = {};
type ExplicitWritableFieldKeys<TExtension> =
  TExtension extends Record<string, unknown>
    ? {
        [TKey in keyof TExtension]: [
          MemberDefinition<TExtension[TKey] extends OverrideDescriptor<infer TInner> ? TInner : TExtension[TKey]>,
        ] extends [never]
          ? never
          : MemberDefinition<
                TExtension[TKey] extends OverrideDescriptor<infer TInner> ? TInner : TExtension[TKey]
              > extends { readonly kind: "field"; readonly visibility: "public" }
            ? MemberDefinition<
                TExtension[TKey] extends OverrideDescriptor<infer TInner> ? TInner : TExtension[TKey]
              > extends infer TDefinition
              ? TDefinition extends { readonly setter: true | Function }
                ? TKey
                : TDefinition extends { readonly getter: true | Function }
                  ? never
                  : TKey
              : never
            : never;
      }[keyof TExtension]
    : never;
type AllExplicitPublicFieldKeys<TExtensions extends readonly AnyClassExtension[]> =
  TExtensions[number] extends infer TExtension
    ? ExplicitWritableFieldKeys<NormalizedClassExtension<TExtension>>
    : never;
type TypeEquals<TLeft, TRight> =
  (<TValue>() => TValue extends TLeft ? 1 : 2) extends <TValue>() => TValue extends TRight ? 1 : 2 ? true : false;
type WritableKeys<TValue> = {
  [TKey in keyof TValue]-?: TypeEquals<Pick<TValue, TKey>, { -readonly [TName in TKey]: TValue[TName] }> extends true
    ? TKey
    : never;
}[keyof TValue];
type PreservedWritableFieldKeys<TInstance, TSchema extends ATS.AnyTypeSchema> = Extract<
  WritableKeys<TInstance>,
  keyof ATS.TypeofSchema<TSchema>
>;
type ExistingWritableFieldKeys<
  TInstance,
  TSchema extends ATS.AnyTypeSchema,
  TEncapsulated extends boolean,
> = TEncapsulated extends true ? PreservedWritableFieldKeys<TInstance, TSchema> : never;

type ExtendedInstanceShape<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TExtensions extends readonly AnyClassExtension[],
  TEncapsulated extends boolean = false,
> = [AllOverrideMemberKeys<TExtensions> | AllHiddenClassMemberKeys<TExtensions>] extends [never]
  ? TInstance &
      ClassFieldSurface<
        ApplySchemaOverrides<TSchema, TExtensions>,
        TEncapsulated,
        | ExistingWritableFieldKeys<TInstance, ApplySchemaOverrides<TSchema, TExtensions>, TEncapsulated>
        | AllExplicitPublicFieldKeys<TExtensions>
      > &
      ExtensionMethods<TSchema, TInstance, TExtensions> &
      LifecycleUpdateMethod
  : Omit<TInstance, AllOverrideMemberKeys<TExtensions> | AllHiddenClassMemberKeys<TExtensions>> &
      Omit<
        ClassFieldSurface<
          ApplySchemaOverrides<TSchema, TExtensions>,
          TEncapsulated,
          | ExistingWritableFieldKeys<TInstance, ApplySchemaOverrides<TSchema, TExtensions>, TEncapsulated>
          | AllExplicitPublicFieldKeys<TExtensions>
        >,
        AllHiddenClassMemberKeys<TExtensions>
      > &
      ExtensionMethods<TSchema, TInstance, TExtensions> &
      LifecycleUpdateMethod;

/** @internal Type helper shared by the runtime-class type contracts. */
export type ExtendedInstance<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TExtensions extends readonly AnyClassExtension[],
  TEncapsulated extends boolean = false,
> = TEncapsulated extends true
  ? InternalInstance<
      ApplySchemaOverrides<TSchema, TExtensions>,
      ExtendedInstanceShape<TSchema, TInstance, TExtensions, TEncapsulated>,
      IdentityKeysFromInstance<TInstance> extends never ? IdentityKeys<TSchema> : IdentityKeysFromInstance<TInstance>
    >
  : ExtendedInstanceShape<TSchema, TInstance, TExtensions, TEncapsulated>;

type ClassFieldSurface<
  TSchema extends ATS.AnyTypeSchema,
  TEncapsulated extends boolean,
  TWritable extends PropertyKey = never,
> = TEncapsulated extends true
  ? Omit<Readonly<ATS.TypeofSchema<TSchema>>, TWritable> & {
      -readonly [TKey in Extract<TWritable, keyof ATS.TypeofSchema<TSchema>>]: ATS.TypeofSchema<TSchema>[TKey];
    }
  : ATS.TypeofSchema<TSchema>;
type HiddenClassMemberKeys<TExtension> =
  TExtension extends Record<string, unknown>
    ? {
        [TKey in keyof TExtension]: IsHiddenClassMember<TExtension[TKey]> extends true ? TKey : never;
      }[keyof TExtension]
    : never;
type AllHiddenClassMemberKeys<TExtensions extends readonly AnyClassExtension[]> =
  TExtensions[number] extends infer TExtension ? HiddenClassMemberKeys<NormalizedClassExtension<TExtension>> : never;
/** @internal Type helper shared by the runtime-class type contracts. */
export type MutableSurface<TValue> = TValue extends object
  ? { -readonly [TKey in keyof TValue]: TValue[TKey] }
  : TValue;
