import type * as ATS from "../core/ats/index.js";
import type { ResolveTypeofSchema } from "../core/ats/typeof.js";
import type { ClassMethodsInput, ClassMixin } from "./class-types-capability.js";
import type { ContextualInternalInstance } from "./class-types-extension.js";
import type {
  AddSchemaFields,
  ApplySchemaOverride,
  IsManagedFieldSchema,
  MethodsForExtension,
  MutableSurface,
  SchemaFieldKeys,
} from "./class-types-schema.js";

type IsReadonlySchema<TSchema> = TSchema extends { readonly type: "readonly" }
  ? true
  : TSchema extends
        | ATS.OptionalSchema<infer TInner>
        | ATS.NullableSchema<infer TInner>
        | ATS.NullishSchema<infer TInner>
        | ATS.DefaultSchema<infer TInner>
        | ATS.BrandSchema<infer TInner>
        | ATS.RefineSchema<infer TInner>
        | ATS.CoerceSchema<infer TInner>
        | ATS.PipeSchema<infer TInner>
        | ATS.TransformSchema<infer TInner>
    ? IsReadonlySchema<TInner>
    : false;
type SchemaReadonlyKeys<TSchema extends ATS.AnyTypeSchema> = TSchema extends {
  readonly type: "object";
  readonly def: { readonly props: infer TShape extends ATS.SchemaShape };
}
  ? {
      [TKey in keyof TShape]: IsReadonlySchema<TShape[TKey]> extends true ? TKey : never;
    }[keyof TShape]
  : never;

/** @internal Type helper shared by the runtime-class type contracts. */
export type ManagedSchemaKeys<TSchema extends ATS.AnyTypeSchema> = TSchema extends {
  readonly type: "object";
  readonly def: { readonly props: infer TShape extends ATS.SchemaShape };
}
  ? {
      [TKey in keyof TShape]: IsManagedFieldSchema<TShape[TKey]> extends true ? TKey : never;
    }[keyof TShape]
  : never;

/** Mutable domain state is the protected counterpart of the public view. */
export type DomainState<
  TSchemaLike,
  TIdentityKeys extends PropertyKey = never,
  TManagedKeys extends PropertyKey = never,
  TReadonlyKeys extends PropertyKey = never,
> =
  DomainStateSchema<TSchemaLike> extends infer TSchema extends ATS.AnyTypeSchema
    ? ResolveTypeofSchema<TSchema> extends infer TValue
      ? TValue extends object
        ? Omit<
            MutableDomainValue<TValue>,
            Extract<
              TIdentityKeys | TManagedKeys | TReadonlyKeys | SchemaReadonlyKeys<DomainStateSchema<TSchemaLike>>,
              keyof TValue
            >
          > &
            Readonly<
              Pick<
                MutableDomainValue<TValue>,
                Extract<
                  TIdentityKeys | TManagedKeys | TReadonlyKeys | SchemaReadonlyKeys<DomainStateSchema<TSchemaLike>>,
                  keyof TValue
                >
              >
            >
        : TValue
      : never
    : never;

type DomainStateSchema<TSchemaLike> = TSchemaLike extends {
  readonly schema: infer TSchema extends ATS.AnyTypeSchema;
}
  ? TSchema
  : TSchemaLike extends ATS.AnyTypeSchema
    ? TSchemaLike
    : never;

type MutableDomainValue<TValue> = TValue extends object ? { -readonly [TKey in keyof TValue]: TValue[TKey] } : TValue;

/** Type-only carrier used to make generated `_props` genuinely protected. */
export declare abstract class DomainStateCarrier<TProps extends object, TIdentityKeys extends PropertyKey = never> {
  protected readonly _props: TProps;
  protected readonly _identityKeys: TIdentityKeys;
}

/** Provides the JIT public instance operation for the supplied input. */
export type PublicInstance<
  TSchema extends ATS.AnyTypeSchema,
  TInstance = ResolveTypeofSchema<TSchema>,
> = TInstance extends object ? { [TKey in keyof TInstance]: TInstance[TKey] } : TInstance;

type HasIdentifierMetadata<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.RuntimeTypeSchema<ATS.AnyTypeSchema, unknown, "value", true, infer TTraits>
    ? TTraits extends ATS.RuntimeTypeTraits<"value", true>
      ? true
      : false
    : TSchema extends ATS.LazySchema<infer TInner>
      ? HasIdentifierMetadata<TInner>
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
        ? HasIdentifierMetadata<TInner>
        : false;

/** @internal Type helper shared by the runtime-class type contracts. */
export type IdentityKeys<TSchema extends ATS.AnyTypeSchema> =
  TSchema extends ATS.ObjectSchema<infer TShape>
    ? {
        [TKey in keyof TShape]: HasIdentifierMetadata<TShape[TKey]> extends true ? TKey : never;
      }[keyof TShape] &
        string
    : never;

/** Provides the JIT internal instance operation for the supplied input. */
export type InternalInstance<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TIdentityKeys extends PropertyKey = IdentityKeys<TSchema>,
  TManagedKeys extends PropertyKey = ManagedSchemaKeys<TSchema>,
> = Omit<TInstance, "_props"> &
  DomainStateCarrier<Extract<DomainState<TSchema, TIdentityKeys, TManagedKeys>, object>, TIdentityKeys>;

/** @internal Type helper shared by the runtime-class type contracts. */
export type IdentityKeysFromInstance<TInstance> =
  TInstance extends DomainStateCarrier<infer _TProps, infer TKeys> ? TKeys : never;

/** @internal Type helper shared by the runtime-class type contracts. */
export type ExtensionThisSurface<
  TSchema extends ATS.AnyTypeSchema,
  TInstance,
  TExtension,
  TEncapsulated extends boolean,
> = TEncapsulated extends true
  ? ContextualInternalInstance<
      AddSchemaFields<ApplySchemaOverride<TSchema, TExtension>, TExtension>,
      TInstance &
        ATS.TypeofSchema<AddSchemaFields<ApplySchemaOverride<TSchema, TExtension>, TExtension>> &
        MethodsForExtension<TExtension, TSchema, TInstance>,
      IdentityKeysFromInstance<TInstance> extends never ? IdentityKeys<TSchema> : IdentityKeysFromInstance<TInstance>
    >
  : MutableSurface<TInstance> &
      ATS.TypeofSchema<AddSchemaFields<ApplySchemaOverride<TSchema, TExtension>, TExtension>> &
      MethodsForExtension<TExtension, TSchema, TInstance>;

type MixinRequirements<TExtension> = TExtension extends ClassMixin<ClassMethodsInput, infer TRequires> ? TRequires : {};
/** @internal Type helper shared by the runtime-class type contracts. */
export type MixinRequirementsMet<TSchema extends ATS.AnyTypeSchema, TExtension> =
  Exclude<SchemaFieldKeys<MixinRequirements<TExtension>>, keyof ATS.TypeofSchema<TSchema>> extends never ? true : false;

/** Structural capabilities may inject their canonical fields. */
