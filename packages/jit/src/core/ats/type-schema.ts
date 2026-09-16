import type { SchemaAnnotations } from "./schema-annotation.js";
import type { AnyTypeName } from "./type-name.js";

/** Describes the base schema in the schema AST and its compiler-facing type contract. */
export interface BaseSchema<TOutput, TName extends AnyTypeName, TDef> {
  readonly type: TName;
  readonly _type: TOutput;
  readonly def: Readonly<TDef>;
  readonly annotations: SchemaAnnotations<TOutput> | undefined;
}

/** Describes the type schema in the schema AST and its compiler-facing type contract. */
export type TypeSchema<TOutput = unknown> = BaseSchema<TOutput, AnyTypeName, unknown>;

/** Describes the any type schema in the schema AST and its compiler-facing type contract. */
export interface AnyTypeSchema {
  readonly type: AnyTypeName;
  readonly _type: unknown;
  readonly def: Readonly<unknown>;
  readonly annotations: unknown;
}

/** Describes the any schema in the schema AST and its compiler-facing type contract. */
export type AnySchema =
  | AnyPrimitiveSchema
  | AnyCollectionSchema
  | AnyCompositionSchema
  | AnyWrapperSchema
  | AnySpecialSchema;

/**
 * Declaration metadata carried by a Runtime Type.
 *
 * The branded property is intentionally type-only. It prevents an unrelated
 * schema with the same visible fields from being mistaken for a Runtime Type
 * trait while keeping the runtime schema shape compact and stable.
 */
declare const RUNTIME_TYPE_TRAITS: unique symbol;

/** Type-only marker for generated class fields outside persistence boundaries. */
export declare const NO_CONSTRUCTOR_FIELD_MARKER: unique symbol;

/** Describes the runtime type factory policy traits in the schema AST and its compiler-facing type contract. */
export interface RuntimeTypeFactoryPolicyTraits<
  TResult extends string = string,
  TConfigured extends boolean = boolean,
  TError = unknown,
  TPriority extends number = number,
> {
  readonly configured: TConfigured;
  readonly resultMode: TResult;
  readonly resultModeExplicit: boolean;
  readonly resultModeInherited: boolean;
  readonly errorType: TError;
  readonly priority: TPriority;
  readonly hasAssertions: boolean;
  /** True only when the class explicitly enabled factory validation. */
  readonly validationConfigured?: boolean;
}

/** Describes the default runtime type factory policy traits in the schema AST and its compiler-facing type contract. */
export interface DefaultRuntimeTypeFactoryPolicyTraits
  extends RuntimeTypeFactoryPolicyTraits<"throw", false, unknown, 1000> {
  readonly resultModeExplicit: false;
  readonly resultModeInherited: false;
  readonly priority: 1000;
  readonly hasAssertions: false;
}

/** Describes the runtime type traits in the schema AST and its compiler-facing type contract. */
export interface RuntimeTypeTraits<
  TRepresentation extends "object" | "value" = "object" | "value",
  TIdentifier extends boolean = boolean,
  TFactoryPolicy extends RuntimeTypeFactoryPolicyTraits = RuntimeTypeFactoryPolicyTraits,
> {
  readonly [RUNTIME_TYPE_TRAITS]: true;
  readonly representation: TRepresentation;
  readonly identifier: TIdentifier;
  readonly factoryPolicy: TFactoryPolicy;
}

/** Describes the default runtime type traits in the schema AST and its compiler-facing type contract. */
export type DefaultRuntimeTypeTraits = RuntimeTypeTraits<"object", false, DefaultRuntimeTypeFactoryPolicyTraits>;

/** A schema-backed runtime constructor used when a generated class is nested in another schema. */
export interface RuntimeTypeDef<
  TInner extends AnyTypeSchema = AnyTypeSchema,
  TRepresentation extends "object" | "value" = "object" | "value",
  TIdentifier extends boolean = boolean,
  TTraits extends RuntimeTypeTraits<TRepresentation, TIdentifier> = RuntimeTypeTraits<TRepresentation, TIdentifier>,
> extends InnerTypeDef<TInner> {
  /** Internal validated flag avoids a second parse when validation already built the state. */
  readonly materialize: new (
    input: unknown,
    validated?: boolean
  ) => unknown;
  readonly representation: TRepresentation;
  readonly identifier: TIdentifier;
  readonly traits: TTraits;
  /** Declaration-time assertion guard used by fused parent validation. */
  readonly assertion:
    | ((value: unknown) =>
        | {
            readonly issues: readonly {
              readonly path: readonly PropertyKey[];
              readonly code: string;
              readonly expected: string;
              readonly message: string;
            }[];
          }
        | undefined)
    | undefined;
}

/** Describes the runtime type schema in the schema AST and its compiler-facing type contract. */
export interface RuntimeTypeSchema<
  TInner extends AnyTypeSchema = AnyTypeSchema,
  TInstance = TypeofSchema<TInner>,
  TRepresentation extends "object" | "value" = "object" | "value",
  TIdentifier extends boolean = boolean,
  TTraits extends RuntimeTypeTraits<TRepresentation, TIdentifier> = RuntimeTypeTraits<TRepresentation, TIdentifier>,
> {
  readonly type: "runtimeType";
  readonly _type: TInstance;
  readonly def: Readonly<RuntimeTypeDef<TInner, TRepresentation, TIdentifier, TTraits>>;
  readonly annotations: unknown;
}

/** Describes the schema shape in the schema AST and its compiler-facing type contract. */
export type SchemaShape = Readonly<Record<string, AnyTypeSchema>>;

/** Describes the typeof schema in the schema AST and its compiler-facing type contract. */
export type TypeofSchema<TSchema extends AnyTypeSchema> = TSchema["_type"];

/** Describes the typeof shape in the schema AST and its compiler-facing type contract. */
export type TypeofShape<TShape extends SchemaShape> = {
  -readonly [TKey in keyof TShape]: TypeofSchema<TShape[TKey]>;
};

/** Describes the mutable typeof shape in the schema AST and its compiler-facing type contract. */
export type MutableTypeofShape<TShape extends SchemaShape> = {
  -readonly [TKey in keyof TShape]: TypeofSchema<TShape[TKey]>;
};

/** Describes the empty def in the schema AST and its compiler-facing type contract. */
export interface EmptyDef {}

/** Def for primitives that support the built-in coercion flag. */
export interface CoercibleDef {
  readonly coerce?: boolean;
}

/** A single declarative constraint attached to a schema (`min`, `email`, ...). */
export interface SchemaCheck<TKind extends string = string, TValue = unknown> {
  readonly kind: TKind;
  readonly value?: TValue;
  /** Custom issue message reported when the check fails. */
  readonly message?: string;
}

/** String format check kinds validated by a single compiled regex test. */
export type StringFormatKind =
  | "guid"
  | "cuid"
  | "cuid2"
  | "ulid"
  | "xid"
  | "ksuid"
  | "nanoid"
  | "duration"
  | "emoji"
  | "ipv4"
  | "ipv6"
  | "cidrv4"
  | "cidrv6"
  | "mac"
  | "base64"
  | "base64url"
  | "hostname"
  | "domain"
  | "e164"
  | "hex"
  | "date"
  | "time"
  | "datetime"
  | "jwt"
  | "digest";

/** Describes the string mask mode in the schema AST and its compiler-facing type contract. */
export type StringMaskMode = "transform" | "strict";

/** Describes the string mask spec in the schema AST and its compiler-facing type contract. */
export interface StringMaskSpec {
  readonly pattern: string;
  readonly mode: StringMaskMode;
  readonly stripNonDigits: boolean;
}

/** Describes the string sanitize preset in the schema AST and its compiler-facing type contract. */
export type StringSanitizePreset = "text" | "htmlEscape" | "sqlIdentifier" | "pathSegment" | "none";

/** Describes the string sanitize html policy in the schema AST and its compiler-facing type contract. */
export type StringSanitizeHtmlPolicy =
  | "strip"
  | "escape"
  | "preserve"
  | {
      readonly mode: "allow";
      /** Allowed element names. Attributes are always removed. */
      readonly tags: readonly string[];
    };

/** Describes the string sanitize pattern in the schema AST and its compiler-facing type contract. */
export interface StringSanitizePattern {
  readonly pattern: RegExp;
  readonly replacement?: string;
}

/** Serializable string-cleaning policy specialized into parse/sanitize code. */
export interface StringSanitizeSpec {
  readonly preset?: StringSanitizePreset | readonly StringSanitizePreset[];
  readonly html?: StringSanitizeHtmlPolicy;
  readonly controls?: "remove" | "space" | "preserve";
  readonly normalize?: StringNormalizationForm;
  readonly trim?: boolean;
  readonly maxLength?: number;
  readonly patterns?: readonly StringSanitizePattern[];
}

/** Describes the string check in the schema AST and its compiler-facing type contract. */
export type StringCheck =
  | SchemaCheck<"min", number>
  | SchemaCheck<"max", number>
  | SchemaCheck<"length", number>
  | SchemaCheck<"oneOf", readonly string[]>
  | SchemaCheck<"startsWith", string>
  | SchemaCheck<"endsWith", string>
  | SchemaCheck<"includes", string>
  | SchemaCheck<"regex", RegExp>
  | SchemaCheck<"email", RegExp>
  | SchemaCheck<"uuid", RegExp>
  | SchemaCheck<"url">
  | SchemaCheck<"httpUrl">
  | SchemaCheck<"noEmpty">
  | SchemaCheck<"trim">
  | SchemaCheck<"lowercase">
  | SchemaCheck<"uppercase">
  | SchemaCheck<"normalize", StringNormalizationForm | undefined>
  | SchemaCheck<"sanitize", StringSanitizeSpec>
  | SchemaCheck<"stringFormat", { readonly name: string; readonly pattern: RegExp }>
  | SchemaCheck<"digitsLength", number | readonly number[]>
  | SchemaCheck<"format", StringMaskSpec>
  | SchemaCheck<"phoneBR">
  | SchemaCheck<StringFormatKind, RegExp>;

/** Describes the number check in the schema AST and its compiler-facing type contract. */
export type NumberCheck =
  | SchemaCheck<"min", number>
  | SchemaCheck<"max", number>
  | SchemaCheck<"moreThan", number>
  | SchemaCheck<"lessThan", number>
  | SchemaCheck<"oneOf", readonly number[]>
  | SchemaCheck<"positive">
  | SchemaCheck<"negative">
  | SchemaCheck<"multipleOf", number>
  | SchemaCheck<"finite">
  | SchemaCheck<"safe">
  | SchemaCheck<"integer">
  | SchemaCheck<"int32">
  | SchemaCheck<"float32">
  | SchemaCheck<"float64">;

/** Describes the temporal unit in the schema AST and its compiler-facing type contract. */
export type TemporalUnit = "minute" | "second" | "millisecond";
/** Describes the string normalization form in the schema AST and its compiler-facing type contract. */
export type StringNormalizationForm = "NFC" | "NFD" | "NFKC" | "NFKD";

/** Describes the date like check in the schema AST and its compiler-facing type contract. */
export type DateLikeCheck =
  | SchemaCheck<"min", Date | string>
  | SchemaCheck<"max", Date | string>
  | SchemaCheck<"between", { readonly min: Date | string; readonly max: Date | string }>
  | SchemaCheck<"daysOfWeek", readonly number[]>
  | SchemaCheck<"monthsOfYear", readonly number[]>
  | SchemaCheck<"truncateTo", TemporalUnit>;

/** Describes the array check in the schema AST and its compiler-facing type contract. */
export type ArrayCheck =
  | SchemaCheck<"min", number>
  | SchemaCheck<"max", number>
  | SchemaCheck<"length", number>
  | SchemaCheck<"nonEmpty">;

/** Describes the issue path segment in the schema AST and its compiler-facing type contract. */
export type IssuePathSegment = string | number;

/** Describes the refine when payload in the schema AST and its compiler-facing type contract. */
export interface RefineWhenPayload<TValue = unknown> {
  readonly value: TValue;
}

/** Describes the refine options in the schema AST and its compiler-facing type contract. */
export interface RefineOptions<TValue = unknown> {
  readonly message?: string;
  readonly path?: readonly IssuePathSegment[];
  readonly when?: (payload: RefineWhenPayload<TValue>) => boolean;
}

/** Def mixin holding a schema's declarative constraints. */
export interface ChecksDef<
  TCheck extends SchemaCheck = SchemaCheck,
  TChecks extends readonly TCheck[] = readonly TCheck[],
> {
  readonly checks?: TChecks;
  /**
   * zod-style built-in coercion flag set by `JIT.coerce.*` factories: the
   * compiled validator converts the input with the type's native
   * constructor (`Number(v)`, `String(v)`, ...) before the type gate.
   * Inline in the generated source — no binding, AOT-safe.
   */
  readonly coerce?: boolean;
}

/** Describes the primitive type name in the schema AST and its compiler-facing type contract. */
export type PrimitiveTypeName =
  | "any"
  | "unknown"
  | "never"
  | "void"
  | "string"
  | "number"
  | "int"
  | "nan"
  | "null"
  | "boolean"
  | "undefined"
  | "symbol"
  | "bigint"
  | "date"
  | "regex"
  | "file";

/** Describes the any primitive schema in the schema AST and its compiler-facing type contract. */
export type AnyPrimitiveSchema =
  | AnyValueSchema
  | UnknownSchema
  | NeverSchema
  | VoidSchema
  | StringSchema
  | NumberSchema
  | IntSchema
  | NanSchema
  | NullSchema
  | BooleanSchema
  | UndefinedSchema
  | SymbolSchema
  | BigIntSchema
  | DateSchema
  | RegexSchema
  | FileSchema
  | JsonSchema;

/** Describes the any value schema in the schema AST and its compiler-facing type contract. */
export type AnyValueSchema = BaseSchema<any, "any", EmptyDef>;
/** Describes the unknown schema in the schema AST and its compiler-facing type contract. */
export type UnknownSchema = BaseSchema<unknown, "unknown", EmptyDef>;
/** Describes the never schema in the schema AST and its compiler-facing type contract. */
export type NeverSchema = BaseSchema<never, "never", EmptyDef>;
/** Describes the void schema in the schema AST and its compiler-facing type contract. */
export type VoidSchema = BaseSchema<void, "void", EmptyDef>;
/** Describes the string schema in the schema AST and its compiler-facing type contract. */
export type StringSchema<TChecks extends readonly StringCheck[] = readonly StringCheck[]> = BaseSchema<
  string,
  "string",
  ChecksDef<StringCheck, TChecks>
>;
/** Describes the number schema in the schema AST and its compiler-facing type contract. */
export type NumberSchema<TChecks extends readonly NumberCheck[] = readonly NumberCheck[]> = BaseSchema<
  number,
  "number",
  ChecksDef<NumberCheck, TChecks>
>;
/** Describes the int schema in the schema AST and its compiler-facing type contract. */
export type IntSchema<TChecks extends readonly NumberCheck[] = readonly NumberCheck[]> = BaseSchema<
  number,
  "int",
  ChecksDef<NumberCheck, TChecks>
>;
/** Describes the nan schema in the schema AST and its compiler-facing type contract. */
export type NanSchema = BaseSchema<number, "nan", EmptyDef>;
/** Describes the null schema in the schema AST and its compiler-facing type contract. */
export type NullSchema = BaseSchema<null, "null", EmptyDef>;
/** Describes the boolean schema in the schema AST and its compiler-facing type contract. */
export type BooleanSchema = BaseSchema<boolean, "boolean", CoercibleDef>;
/** Describes the undefined schema in the schema AST and its compiler-facing type contract. */
export type UndefinedSchema = BaseSchema<undefined, "undefined", EmptyDef>;
/** Describes the symbol schema in the schema AST and its compiler-facing type contract. */
export type SymbolSchema = BaseSchema<symbol, "symbol", EmptyDef>;
/** Describes the big int schema in the schema AST and its compiler-facing type contract. */
export type BigIntSchema = BaseSchema<bigint, "bigint", CoercibleDef>;
/** Describes the date schema in the schema AST and its compiler-facing type contract. */
export type DateSchema<TChecks extends readonly DateLikeCheck[] = readonly DateLikeCheck[]> = BaseSchema<
  Date,
  "date",
  CoercibleDef & ChecksDef<DateLikeCheck, TChecks>
>;
/** Describes the regex schema in the schema AST and its compiler-facing type contract. */
export type RegexSchema = BaseSchema<RegExp, "regex", EmptyDef>;
/** Describes the file schema in the schema AST and its compiler-facing type contract. */
export type FileSchema = BaseSchema<File, "file", EmptyDef>;

/** Describes the json primitive in the schema AST and its compiler-facing type contract. */
export type JsonPrimitive = string | number | boolean | null;
/** Describes the json value in the schema AST and its compiler-facing type contract. */
export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[];
/** Describes the json schema in the schema AST and its compiler-facing type contract. */
export type JsonSchema = BaseSchema<JsonValue, "json", EmptyDef>;

/** Describes the element def in the schema AST and its compiler-facing type contract. */
export interface ElementDef<TElement extends AnyTypeSchema = AnyTypeSchema> {
  readonly element: TElement;
}

/** Describes the key value def in the schema AST and its compiler-facing type contract. */
export interface KeyValueDef<TKey extends AnyTypeSchema = AnyTypeSchema, TValue extends AnyTypeSchema = AnyTypeSchema> {
  readonly key: TKey;
  readonly value: TValue;
}

/** Describes the tuple def in the schema AST and its compiler-facing type contract. */
export interface TupleDef<
  TItems extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[],
  TRest extends AnyTypeSchema | undefined = undefined,
> {
  readonly items: TItems;
  readonly rest: TRest;
}

/** Describes the object unknown keys in the schema AST and its compiler-facing type contract. */
export type ObjectUnknownKeys = "strip" | "passthrough" | "strict" | undefined;

/** Describes the object def in the schema AST and its compiler-facing type contract. */
export interface ObjectDef<
  TShape extends SchemaShape = SchemaShape,
  TUnknownKeys extends ObjectUnknownKeys = ObjectUnknownKeys,
  TCatchall extends AnyTypeSchema | undefined = AnyTypeSchema | undefined,
> {
  readonly props: TShape;
  readonly unknownKeys: TUnknownKeys;
  readonly catchall: TCatchall;
  readonly checks: readonly unknown[];
}

/** Describes the any collection schema in the schema AST and its compiler-facing type contract. */
export type AnyCollectionSchema = ArraySchema | SetSchema | MapSchema | RecordSchema | TupleSchema | ObjectSchema;

/** Describes the array schema in the schema AST and its compiler-facing type contract. */
export type ArraySchema<TElement extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  TypeofSchema<TElement>[],
  "array",
  ElementDef<TElement> & ChecksDef<ArrayCheck>
>;

/** Describes the set schema in the schema AST and its compiler-facing type contract. */
export type SetSchema<TElement extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  Set<TypeofSchema<TElement>>,
  "set",
  ElementDef<TElement>
>;

/** Describes the map schema in the schema AST and its compiler-facing type contract. */
export type MapSchema<
  TKey extends AnyTypeSchema = AnyTypeSchema,
  TValue extends AnyTypeSchema = AnyTypeSchema,
> = BaseSchema<Map<TypeofSchema<TKey>, TypeofSchema<TValue>>, "map", KeyValueDef<TKey, TValue>>;

/** Describes the record schema in the schema AST and its compiler-facing type contract. */
export type RecordSchema<
  TKey extends AnyTypeSchema = TypeSchema<PropertyKey>,
  TValue extends AnyTypeSchema = AnyTypeSchema,
> = BaseSchema<
  Record<Extract<TypeofSchema<TKey>, PropertyKey>, TypeofSchema<TValue>>,
  "record",
  KeyValueDef<TKey, TValue>
>;

/** Describes the tuple output in the schema AST and its compiler-facing type contract. */
export type TupleOutput<
  TItems extends readonly AnyTypeSchema[],
  TRest extends AnyTypeSchema | undefined = undefined,
> = TRest extends TypeSchema ? [...TupleItemsOutput<TItems>, ...TypeofSchema<TRest>[]] : TupleItemsOutput<TItems>;

type TupleItemsOutput<TItems extends readonly AnyTypeSchema[]> = TItems extends readonly []
  ? []
  : TItems extends readonly [infer THead extends AnyTypeSchema, ...infer TTail extends readonly AnyTypeSchema[]]
    ? [TypeofSchema<THead>, ...TupleItemsOutput<TTail>]
    : TypeofSchema<TItems[number]>[];

/** Describes the tuple schema in the schema AST and its compiler-facing type contract. */
export type TupleSchema<
  TItems extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[],
  TRest extends AnyTypeSchema | undefined = undefined,
> = BaseSchema<TupleOutput<TItems, TRest>, "tuple", TupleDef<TItems, TRest>>;

/** Describes the object output in the schema AST and its compiler-facing type contract. */
export type ObjectOutput<
  TShape extends SchemaShape,
  TUnknownKeys extends ObjectUnknownKeys = undefined,
  TCatchall extends AnyTypeSchema | undefined = undefined,
> = TypeofShape<TShape> &
  (TCatchall extends AnyTypeSchema
    ? Record<string, TypeofSchema<TCatchall> | KnownObjectValue<TShape>>
    : TUnknownKeys extends "passthrough"
      ? Record<string, unknown>
      : unknown);

type KnownObjectValue<TShape extends SchemaShape> = TypeofShape<TShape>[keyof TypeofShape<TShape>];

/** Describes the object schema in the schema AST and its compiler-facing type contract. */
export type ObjectSchema<
  TShape extends SchemaShape = SchemaShape,
  TUnknownKeys extends ObjectUnknownKeys = undefined,
  TCatchall extends AnyTypeSchema | undefined = undefined,
> = BaseSchema<ObjectOutput<TShape, TUnknownKeys, TCatchall>, "object", ObjectDef<TShape, TUnknownKeys, TCatchall>>;

/** Describes the options def in the schema AST and its compiler-facing type contract. */
export interface OptionsDef<TOptions extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[]> {
  readonly options: TOptions;
}

/** Describes the binary def in the schema AST and its compiler-facing type contract. */
export interface BinaryDef<TLeft extends AnyTypeSchema = AnyTypeSchema, TRight extends AnyTypeSchema = AnyTypeSchema> {
  readonly left: TLeft;
  readonly right: TRight;
}

/** Describes the any composition schema in the schema AST and its compiler-facing type contract. */
export type AnyCompositionSchema = UnionSchema | XorSchema | IntersectionSchema | DiscriminatedUnionSchema;

/** Describes the union schema in the schema AST and its compiler-facing type contract. */
export type UnionSchema<TOptions extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[]> = BaseSchema<
  TypeofSchema<TOptions[number]>,
  "union",
  OptionsDef<TOptions>
>;

/** Describes the xor schema in the schema AST and its compiler-facing type contract. */
export type XorSchema<TOptions extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[]> = BaseSchema<
  TypeofSchema<TOptions[number]>,
  "xor",
  OptionsDef<TOptions>
>;

type UnionToIntersection<TUnion> = (TUnion extends unknown ? (value: TUnion) => void : never) extends (
  value: infer TIntersection
) => void
  ? TIntersection
  : never;

/** Describes the intersection schema in the schema AST and its compiler-facing type contract. */
export type IntersectionSchema<TOptions extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[]> = BaseSchema<
  UnionToIntersection<TypeofSchema<TOptions[number]>>,
  "intersection",
  OptionsDef<TOptions>
>;

/** Describes the discriminated union def in the schema AST and its compiler-facing type contract. */
export interface DiscriminatedUnionDef<TOptions extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[]>
  extends OptionsDef<TOptions> {
  readonly discriminator: string;
}

/** Describes the discriminated union schema in the schema AST and its compiler-facing type contract. */
export type DiscriminatedUnionSchema<TOptions extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[]> = BaseSchema<
  TypeofSchema<TOptions[number]>,
  "discriminatedUnion",
  DiscriminatedUnionDef<TOptions>
>;

/** Describes the inner type def in the schema AST and its compiler-facing type contract. */
export interface InnerTypeDef<TInner extends AnyTypeSchema = AnyTypeSchema> {
  readonly innerType: TInner;
}

/** Describes the any wrapper schema in the schema AST and its compiler-facing type contract. */
export type AnyWrapperSchema =
  | OptionalSchema
  | NullableSchema
  | NullishSchema
  | ReadonlySchema
  | PromiseSchema
  | DefaultSchema
  | BrandSchema
  | TransformSchema
  | PipeSchema
  | LazySchema
  | WhenSchema;

/** Describes the optional schema in the schema AST and its compiler-facing type contract. */
export type OptionalSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  TypeofSchema<TInner> | undefined,
  "optional",
  InnerTypeDef<TInner>
>;

/** Describes the nullable schema in the schema AST and its compiler-facing type contract. */
export type NullableSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  TypeofSchema<TInner> | null,
  "nullable",
  InnerTypeDef<TInner>
>;

/** Describes the nullish schema in the schema AST and its compiler-facing type contract. */
export type NullishSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  TypeofSchema<TInner> | null | undefined,
  "nullish",
  InnerTypeDef<TInner>
>;

/** Describes the readonly output in the schema AST and its compiler-facing type contract. */
export type ReadonlyOutput<TValue> =
  TValue extends Map<infer TKey, infer TValueItem>
    ? ReadonlyMap<TKey, TValueItem>
    : TValue extends Set<infer TItem>
      ? ReadonlySet<TItem>
      : TValue extends readonly unknown[]
        ? Readonly<TValue>
        : TValue extends object
          ? Readonly<TValue>
          : TValue;

/** Describes the readonly schema in the schema AST and its compiler-facing type contract. */
export type ReadonlySchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  ReadonlyOutput<TypeofSchema<TInner>>,
  "readonly",
  InnerTypeDef<TInner>
>;

/** Describes the promise schema in the schema AST and its compiler-facing type contract. */
export type PromiseSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  Promise<TypeofSchema<TInner>>,
  "promise",
  InnerTypeDef<TInner>
>;

/** Describes the default def in the schema AST and its compiler-facing type contract. */
export interface DefaultDef<TInner extends AnyTypeSchema = AnyTypeSchema> extends InnerTypeDef<TInner> {
  readonly defaultValue: TypeofSchema<TInner> | (() => TypeofSchema<TInner>);
}

/** Describes the default schema in the schema AST and its compiler-facing type contract. */
export type DefaultSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  TypeofSchema<TInner>,
  "default",
  DefaultDef<TInner>
>;

/** Describes the brand def in the schema AST and its compiler-facing type contract. */
export interface BrandDef<TInner extends AnyTypeSchema = AnyTypeSchema, TBrand extends string = string>
  extends InnerTypeDef<TInner> {
  readonly brand: TBrand;
}

/** Describes the brand in the schema AST and its compiler-facing type contract. */
export type Brand<TValue, TBrand extends string> = TValue & {
  readonly __brand: TBrand;
};

/** Describes the brand schema in the schema AST and its compiler-facing type contract. */
export type BrandSchema<TInner extends AnyTypeSchema = AnyTypeSchema, TBrand extends string = string> = BaseSchema<
  Brand<TypeofSchema<TInner>, TBrand>,
  "brand",
  BrandDef<TInner, TBrand>
>;

/** Describes the transform spec in the schema AST and its compiler-facing type contract. */
export type TransformSpec<TInput> = {
  readonly [TKey in keyof TInput]?: (value: TInput[TKey], source: TInput) => unknown;
};

/** Describes the transform output in the schema AST and its compiler-facing type contract. */
export type TransformOutput<TInput, TSpec extends TransformSpec<TInput>> = {
  -readonly [TKey in keyof TInput]: TKey extends keyof TSpec
    ? TSpec[TKey] extends (...args: never[]) => infer TOutput
      ? TOutput
      : TInput[TKey]
    : TInput[TKey];
};

/** Describes the transform def in the schema AST and its compiler-facing type contract. */
export interface TransformDef<TInner extends AnyTypeSchema = AnyTypeSchema, TSpec = unknown>
  extends InnerTypeDef<TInner> {
  readonly transforms: TSpec;
}

/** Describes the transform schema in the schema AST and its compiler-facing type contract. */
export type TransformSchema<
  TInner extends AnyTypeSchema = AnyTypeSchema,
  TSpec extends TransformSpec<TypeofSchema<TInner>> = TransformSpec<TypeofSchema<TInner>>,
> = BaseSchema<TransformOutput<TypeofSchema<TInner>, TSpec>, "transform", TransformDef<TInner, TSpec>>;

/** Describes the pipe def in the schema AST and its compiler-facing type contract. */
export interface PipeDef<TInner extends AnyTypeSchema = AnyTypeSchema, TOutput = unknown> extends InnerTypeDef<TInner> {
  readonly transform: (value: TypeofSchema<TInner>) => TOutput;
}

/** Describes the pipe schema in the schema AST and its compiler-facing type contract. */
export type PipeSchema<TInner extends AnyTypeSchema = AnyTypeSchema, TOutput = unknown> = BaseSchema<
  TOutput,
  "pipe",
  PipeDef<TInner, TOutput>
>;

/** Describes the lazy def in the schema AST and its compiler-facing type contract. */
export interface LazyDef<TInner extends AnyTypeSchema = AnyTypeSchema> {
  readonly getter: () => TInner;
}

/** Describes the lazy schema in the schema AST and its compiler-facing type contract. */
export type LazySchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  TypeofSchema<TInner>,
  "lazy",
  LazyDef<TInner>
>;

/** Describes the when matcher in the schema AST and its compiler-facing type contract. */
export type WhenMatcher<TContextValue = unknown> = TContextValue | ((value: TContextValue) => boolean);

/** Describes the when def in the schema AST and its compiler-facing type contract. */
export interface WhenDef<
  TThen extends AnyTypeSchema = AnyTypeSchema,
  TOtherwise extends AnyTypeSchema = AnyTypeSchema,
> {
  readonly key: string;
  readonly is: WhenMatcher;
  readonly thenType: TThen;
  readonly otherwiseType: TOtherwise;
}

/** Describes the when schema in the schema AST and its compiler-facing type contract. */
export type WhenSchema<
  TThen extends AnyTypeSchema = AnyTypeSchema,
  TOtherwise extends AnyTypeSchema = AnyTypeSchema,
> = BaseSchema<TypeofSchema<TThen> | TypeofSchema<TOtherwise>, "when", WhenDef<TThen, TOtherwise>>;

/** Describes the any special schema in the schema AST and its compiler-facing type contract. */
export type AnySpecialSchema =
  | LiteralSchema
  | EnumSchema
  | InstanceOfSchema
  | RefineSchema
  | CoerceSchema
  | CustomSchema
  | NotSchema
  | TemplateLiteralSchema
  | FunctionSchema
  | TemporalSchema
  | CodecSchema;

/** Describes the literal def in the schema AST and its compiler-facing type contract. */
export interface LiteralDef<TValue = unknown> {
  readonly value: TValue;
}

/** Describes the literal schema in the schema AST and its compiler-facing type contract. */
export type LiteralSchema<TValue = unknown> = BaseSchema<TValue, "literal", LiteralDef<TValue>>;

/** Describes the enum values input in the schema AST and its compiler-facing type contract. */
export type EnumValuesInput = readonly (string | number)[] | Readonly<Record<string, string | number>>;

/** Describes the enum output in the schema AST and its compiler-facing type contract. */
export type EnumOutput<TValues extends EnumValuesInput> = TValues extends readonly (infer TItem extends
  | string
  | number)[]
  ? TItem
  : TValues[keyof TValues];

/** Describes the enum def in the schema AST and its compiler-facing type contract. */
export interface EnumDef<TValues extends EnumValuesInput = Readonly<Record<string, string | number>>> {
  readonly values: TValues;
}

/** Describes the enum schema in the schema AST and its compiler-facing type contract. */
export type EnumSchema<TValues extends EnumValuesInput = Readonly<Record<string, string | number>>> = BaseSchema<
  EnumOutput<TValues>,
  "enum",
  EnumDef<TValues>
>;

/** Describes the instance of def in the schema AST and its compiler-facing type contract. */
export interface InstanceOfDef<
  TCtor extends abstract new (
    ...args: any[]
  ) => unknown = abstract new (
    ...args: any[]
  ) => unknown,
> {
  readonly ctor: TCtor;
}

/** Describes the instance of schema in the schema AST and its compiler-facing type contract. */
export type InstanceOfSchema<
  TCtor extends abstract new (
    ...args: any[]
  ) => unknown = abstract new (
    ...args: any[]
  ) => unknown,
> = BaseSchema<InstanceType<TCtor>, "instanceof", InstanceOfDef<TCtor>>;

/** Describes the custom def in the schema AST and its compiler-facing type contract. */
export interface CustomDef<TOutput = unknown> {
  readonly predicate: ((value: unknown) => value is TOutput) | ((value: unknown) => boolean) | undefined;
  readonly message: string | undefined;
}

/** Describes the custom schema in the schema AST and its compiler-facing type contract. */
export type CustomSchema<TOutput = unknown> = BaseSchema<TOutput, "custom", CustomDef<TOutput>>;

/** Describes the not schema in the schema AST and its compiler-facing type contract. */
export type NotSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<unknown, "not", InnerTypeDef<TInner>>;

/** Describes the template literal input part in the schema AST and its compiler-facing type contract. */
export type TemplateLiteralInputPart = string | AnyTypeSchema | { readonly schema: AnyTypeSchema };

/** Describes the template literal def in the schema AST and its compiler-facing type contract. */
export interface TemplateLiteralDef<
  TParts extends readonly (string | AnyTypeSchema)[] = readonly (string | AnyTypeSchema)[],
> {
  readonly parts: TParts;
}

/** Describes the template literal schema in the schema AST and its compiler-facing type contract. */
export type TemplateLiteralSchema<
  TParts extends readonly TemplateLiteralInputPart[] = readonly TemplateLiteralInputPart[],
> = BaseSchema<
  TemplateLiteralOutput<TParts>,
  "templateLiteral",
  TemplateLiteralDef<TemplateLiteralRuntimeParts<TParts>>
>;

/** Describes the template literal runtime parts in the schema AST and its compiler-facing type contract. */
export type TemplateLiteralRuntimeParts<TParts extends readonly TemplateLiteralInputPart[]> = {
  readonly [TKey in keyof TParts]: TParts[TKey] extends string ? TParts[TKey] : SchemaFromInputPart<TParts[TKey]>;
};

/** Describes the template literal output in the schema AST and its compiler-facing type contract. */
export type TemplateLiteralOutput<TParts extends readonly TemplateLiteralInputPart[]> = TParts extends readonly [
  infer THead extends TemplateLiteralInputPart,
  ...infer TTail extends readonly TemplateLiteralInputPart[],
]
  ? `${TemplateLiteralPartOutput<THead>}${TemplateLiteralOutput<TTail>}`
  : "";

type TemplateLiteralPartOutput<TPart extends TemplateLiteralInputPart> = TPart extends string
  ? TPart
  : SchemaStringValue<TypeofSchema<SchemaFromInputPart<TPart>>>;

type SchemaFromInputPart<TPart extends TemplateLiteralInputPart> = TPart extends { readonly schema: infer TSchema }
  ? TSchema extends AnyTypeSchema
    ? TSchema
    : never
  : TPart extends AnyTypeSchema
    ? TPart
    : never;

type SchemaStringValue<TValue> = Extract<TValue, string | number | bigint | boolean | null | undefined>;

/** Describes the function input schemas in the schema AST and its compiler-facing type contract. */
export type FunctionInputSchemas = readonly AnyTypeSchema[];

/** Describes the function def in the schema AST and its compiler-facing type contract. */
export interface FunctionDef<
  TInput extends FunctionInputSchemas = FunctionInputSchemas,
  TOutput extends AnyTypeSchema | undefined = AnyTypeSchema | undefined,
> {
  readonly input: TInput;
  readonly output: TOutput;
  readonly args: TupleSchema<TInput>;
}

/** Describes the function args in the schema AST and its compiler-facing type contract. */
export type FunctionArgs<TInput extends FunctionInputSchemas> = TupleOutput<TInput>;

/** Describes the function return in the schema AST and its compiler-facing type contract. */
export type FunctionReturn<TOutput extends AnyTypeSchema | undefined> = TOutput extends AnyTypeSchema
  ? TypeofSchema<TOutput>
  : unknown;

/** Describes the function schema in the schema AST and its compiler-facing type contract. */
export type FunctionSchema<
  TInput extends FunctionInputSchemas = FunctionInputSchemas,
  TOutput extends AnyTypeSchema | undefined = AnyTypeSchema | undefined,
> = BaseSchema<(...args: FunctionArgs<TInput>) => FunctionReturn<TOutput>, "function", FunctionDef<TInput, TOutput>>;

/** Describes the temporal kind in the schema AST and its compiler-facing type contract. */
export type TemporalKind =
  | "instant"
  | "plainDate"
  | "plainTime"
  | "plainDateTime"
  | "zonedDateTime"
  | "plainYearMonth"
  | "plainMonthDay"
  | "duration";

/** Describes the temporal def in the schema AST and its compiler-facing type contract. */
export interface TemporalDef<
  TKind extends TemporalKind = TemporalKind,
  TChecks extends readonly DateLikeCheck[] = readonly DateLikeCheck[],
> {
  readonly kind: TKind;
  readonly checks?: TChecks;
}

/** Describes the temporal output in the schema AST and its compiler-facing type contract. */
export type TemporalOutput<TKind extends TemporalKind> = TKind extends "instant"
  ? Temporal.Instant
  : TKind extends "plainDate"
    ? Temporal.PlainDate
    : TKind extends "plainTime"
      ? Temporal.PlainTime
      : TKind extends "plainDateTime"
        ? Temporal.PlainDateTime
        : TKind extends "zonedDateTime"
          ? Temporal.ZonedDateTime
          : TKind extends "plainYearMonth"
            ? Temporal.PlainYearMonth
            : TKind extends "plainMonthDay"
              ? Temporal.PlainMonthDay
              : Temporal.Duration;

/** Describes the temporal schema in the schema AST and its compiler-facing type contract. */
export type TemporalSchema<
  TKind extends TemporalKind = TemporalKind,
  TChecks extends readonly DateLikeCheck[] = readonly DateLikeCheck[],
> = BaseSchema<TemporalOutput<TKind>, "temporal", TemporalDef<TKind, TChecks>>;

/** Describes the codec def in the schema AST and its compiler-facing type contract. */
export interface CodecDef<TInput extends AnyTypeSchema = AnyTypeSchema, TOutput extends AnyTypeSchema = AnyTypeSchema> {
  readonly input: TInput;
  readonly output: TOutput;
  readonly decode: (value: TypeofSchema<TInput>) => TypeofSchema<TOutput>;
  readonly encode: (value: TypeofSchema<TOutput>) => TypeofSchema<TInput>;
}

/** Describes the codec schema in the schema AST and its compiler-facing type contract. */
export type CodecSchema<
  TInput extends AnyTypeSchema = AnyTypeSchema,
  TOutput extends AnyTypeSchema = AnyTypeSchema,
> = BaseSchema<TypeofSchema<TOutput>, "codec", CodecDef<TInput, TOutput>>;

/** Describes the refine def in the schema AST and its compiler-facing type contract. */
export interface RefineDef<TInner extends AnyTypeSchema = AnyTypeSchema> extends InnerTypeDef<TInner> {
  readonly predicate: (value: TypeofSchema<TInner>) => boolean;
  /** Custom issue message reported when the refinement rejects the value. */
  readonly message?: string;
  /** Optional issue path, relative to the refined value. */
  readonly path?: readonly IssuePathSegment[];
  /** Optional guard that decides if the refinement should run. */
  readonly when?: (payload: RefineWhenPayload<TypeofSchema<TInner>>) => boolean;
}

/** Describes the refine schema in the schema AST and its compiler-facing type contract. */
export type RefineSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  TypeofSchema<TInner>,
  "refine",
  RefineDef<TInner>
>;

/** Describes the coerce def in the schema AST and its compiler-facing type contract. */
export interface CoerceDef<TInner extends AnyTypeSchema = AnyTypeSchema> extends InnerTypeDef<TInner> {
  readonly coercer: (value: unknown) => TypeofSchema<TInner>;
}

/** Describes the coerce schema in the schema AST and its compiler-facing type contract. */
export type CoerceSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  TypeofSchema<TInner>,
  "coerce",
  CoerceDef<TInner>
>;
