import type { SchemaAnnotations } from "./schema-annotation.js";
import type { AnyTypeName } from "./type-name.js";

export interface BaseSchema<TOutput, TName extends AnyTypeName, TDef> {
  readonly type: TName;
  readonly _type: TOutput;
  readonly def: Readonly<TDef>;
  readonly annotations: SchemaAnnotations<TOutput> | undefined;
}

export type TypeSchema<TOutput = unknown> = BaseSchema<TOutput, AnyTypeName, unknown>;

export interface AnyTypeSchema {
  readonly type: AnyTypeName;
  readonly _type: unknown;
  readonly def: Readonly<unknown>;
  readonly annotations: unknown;
}

export type AnySchema =
  | AnyPrimitiveSchema
  | AnyCollectionSchema
  | AnyCompositionSchema
  | AnyWrapperSchema
  | AnySpecialSchema;

export type SchemaShape = Readonly<Record<string, AnyTypeSchema>>;

export type TypeofSchema<TSchema extends AnyTypeSchema> = TSchema["_type"];

export type TypeofShape<TShape extends SchemaShape> = {
  -readonly [TKey in keyof TShape]: TypeofSchema<TShape[TKey]>;
};

export type MutableTypeofShape<TShape extends SchemaShape> = {
  -readonly [TKey in keyof TShape]: TypeofSchema<TShape[TKey]>;
};

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

export type StringMaskMode = "transform" | "strict";

export interface StringMaskSpec {
  readonly pattern: string;
  readonly mode: StringMaskMode;
  readonly stripNonDigits: boolean;
}

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
  | SchemaCheck<"sanitize">
  | SchemaCheck<"stringFormat", { readonly name: string; readonly pattern: RegExp }>
  | SchemaCheck<"digitsLength", number | readonly number[]>
  | SchemaCheck<"format", StringMaskSpec>
  | SchemaCheck<"phoneBR">
  | SchemaCheck<StringFormatKind, RegExp>;

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

export type TemporalUnit = "minute" | "second" | "millisecond";
export type StringNormalizationForm = "NFC" | "NFD" | "NFKC" | "NFKD";

export type DateLikeCheck =
  | SchemaCheck<"min", Date | string>
  | SchemaCheck<"max", Date | string>
  | SchemaCheck<"between", { readonly min: Date | string; readonly max: Date | string }>
  | SchemaCheck<"daysOfWeek", readonly number[]>
  | SchemaCheck<"monthsOfYear", readonly number[]>
  | SchemaCheck<"truncateTo", TemporalUnit>;

export type ArrayCheck =
  | SchemaCheck<"min", number>
  | SchemaCheck<"max", number>
  | SchemaCheck<"length", number>
  | SchemaCheck<"nonEmpty">;

export type IssuePathSegment = string | number;

export interface RefineWhenPayload<TValue = unknown> {
  readonly value: TValue;
}

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

export type AnyValueSchema = BaseSchema<any, "any", EmptyDef>;
export type UnknownSchema = BaseSchema<unknown, "unknown", EmptyDef>;
export type NeverSchema = BaseSchema<never, "never", EmptyDef>;
export type VoidSchema = BaseSchema<void, "void", EmptyDef>;
export type StringSchema<TChecks extends readonly StringCheck[] = readonly StringCheck[]> = BaseSchema<
  string,
  "string",
  ChecksDef<StringCheck, TChecks>
>;
export type NumberSchema<TChecks extends readonly NumberCheck[] = readonly NumberCheck[]> = BaseSchema<
  number,
  "number",
  ChecksDef<NumberCheck, TChecks>
>;
export type IntSchema<TChecks extends readonly NumberCheck[] = readonly NumberCheck[]> = BaseSchema<
  number,
  "int",
  ChecksDef<NumberCheck, TChecks>
>;
export type NanSchema = BaseSchema<number, "nan", EmptyDef>;
export type NullSchema = BaseSchema<null, "null", EmptyDef>;
export type BooleanSchema = BaseSchema<boolean, "boolean", CoercibleDef>;
export type UndefinedSchema = BaseSchema<undefined, "undefined", EmptyDef>;
export type SymbolSchema = BaseSchema<symbol, "symbol", EmptyDef>;
export type BigIntSchema = BaseSchema<bigint, "bigint", CoercibleDef>;
export type DateSchema<TChecks extends readonly DateLikeCheck[] = readonly DateLikeCheck[]> = BaseSchema<
  Date,
  "date",
  CoercibleDef & ChecksDef<DateLikeCheck, TChecks>
>;
export type RegexSchema = BaseSchema<RegExp, "regex", EmptyDef>;
export type FileSchema = BaseSchema<File, "file", EmptyDef>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[];
export type JsonSchema = BaseSchema<JsonValue, "json", EmptyDef>;

export interface ElementDef<TElement extends AnyTypeSchema = AnyTypeSchema> {
  readonly element: TElement;
}

export interface KeyValueDef<TKey extends AnyTypeSchema = AnyTypeSchema, TValue extends AnyTypeSchema = AnyTypeSchema> {
  readonly key: TKey;
  readonly value: TValue;
}

export interface TupleDef<
  TItems extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[],
  TRest extends AnyTypeSchema | undefined = undefined,
> {
  readonly items: TItems;
  readonly rest: TRest;
}

export type ObjectUnknownKeys = "strip" | "passthrough" | "strict" | undefined;

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

export type AnyCollectionSchema = ArraySchema | SetSchema | MapSchema | RecordSchema | TupleSchema | ObjectSchema;

export type ArraySchema<TElement extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  TypeofSchema<TElement>[],
  "array",
  ElementDef<TElement> & ChecksDef<ArrayCheck>
>;

export type SetSchema<TElement extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  Set<TypeofSchema<TElement>>,
  "set",
  ElementDef<TElement>
>;

export type MapSchema<
  TKey extends AnyTypeSchema = AnyTypeSchema,
  TValue extends AnyTypeSchema = AnyTypeSchema,
> = BaseSchema<Map<TypeofSchema<TKey>, TypeofSchema<TValue>>, "map", KeyValueDef<TKey, TValue>>;

export type RecordSchema<
  TKey extends AnyTypeSchema = TypeSchema<PropertyKey>,
  TValue extends AnyTypeSchema = AnyTypeSchema,
> = BaseSchema<
  Record<Extract<TypeofSchema<TKey>, PropertyKey>, TypeofSchema<TValue>>,
  "record",
  KeyValueDef<TKey, TValue>
>;

export type TupleOutput<
  TItems extends readonly AnyTypeSchema[],
  TRest extends AnyTypeSchema | undefined = undefined,
> = TRest extends TypeSchema ? [...TupleItemsOutput<TItems>, ...TypeofSchema<TRest>[]] : TupleItemsOutput<TItems>;

type TupleItemsOutput<TItems extends readonly AnyTypeSchema[]> = TItems extends readonly []
  ? []
  : TItems extends readonly [infer THead extends AnyTypeSchema, ...infer TTail extends readonly AnyTypeSchema[]]
    ? [TypeofSchema<THead>, ...TupleItemsOutput<TTail>]
    : TypeofSchema<TItems[number]>[];

export type TupleSchema<
  TItems extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[],
  TRest extends AnyTypeSchema | undefined = undefined,
> = BaseSchema<TupleOutput<TItems, TRest>, "tuple", TupleDef<TItems, TRest>>;

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

export type ObjectSchema<
  TShape extends SchemaShape = SchemaShape,
  TUnknownKeys extends ObjectUnknownKeys = undefined,
  TCatchall extends AnyTypeSchema | undefined = undefined,
> = BaseSchema<ObjectOutput<TShape, TUnknownKeys, TCatchall>, "object", ObjectDef<TShape, TUnknownKeys, TCatchall>>;

export interface OptionsDef<TOptions extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[]> {
  readonly options: TOptions;
}

export interface BinaryDef<TLeft extends AnyTypeSchema = AnyTypeSchema, TRight extends AnyTypeSchema = AnyTypeSchema> {
  readonly left: TLeft;
  readonly right: TRight;
}

export type AnyCompositionSchema = UnionSchema | XorSchema | IntersectionSchema | DiscriminatedUnionSchema;

export type UnionSchema<TOptions extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[]> = BaseSchema<
  TypeofSchema<TOptions[number]>,
  "union",
  OptionsDef<TOptions>
>;

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

export type IntersectionSchema<TOptions extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[]> = BaseSchema<
  UnionToIntersection<TypeofSchema<TOptions[number]>>,
  "intersection",
  OptionsDef<TOptions>
>;

export interface DiscriminatedUnionDef<TOptions extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[]>
  extends OptionsDef<TOptions> {
  readonly discriminator: string;
}

export type DiscriminatedUnionSchema<TOptions extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[]> = BaseSchema<
  TypeofSchema<TOptions[number]>,
  "discriminatedUnion",
  DiscriminatedUnionDef<TOptions>
>;

export interface InnerTypeDef<TInner extends AnyTypeSchema = AnyTypeSchema> {
  readonly innerType: TInner;
}

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

export type OptionalSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  TypeofSchema<TInner> | undefined,
  "optional",
  InnerTypeDef<TInner>
>;

export type NullableSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  TypeofSchema<TInner> | null,
  "nullable",
  InnerTypeDef<TInner>
>;

export type NullishSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  TypeofSchema<TInner> | null | undefined,
  "nullish",
  InnerTypeDef<TInner>
>;

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

export type ReadonlySchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  ReadonlyOutput<TypeofSchema<TInner>>,
  "readonly",
  InnerTypeDef<TInner>
>;

export type PromiseSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  Promise<TypeofSchema<TInner>>,
  "promise",
  InnerTypeDef<TInner>
>;

export interface DefaultDef<TInner extends AnyTypeSchema = AnyTypeSchema> extends InnerTypeDef<TInner> {
  readonly defaultValue: TypeofSchema<TInner> | (() => TypeofSchema<TInner>);
}

export type DefaultSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  TypeofSchema<TInner>,
  "default",
  DefaultDef<TInner>
>;

export interface BrandDef<TInner extends AnyTypeSchema = AnyTypeSchema, TBrand extends string = string>
  extends InnerTypeDef<TInner> {
  readonly brand: TBrand;
}

export type Brand<TValue, TBrand extends string> = TValue & {
  readonly __brand: TBrand;
};

export type BrandSchema<TInner extends AnyTypeSchema = AnyTypeSchema, TBrand extends string = string> = BaseSchema<
  Brand<TypeofSchema<TInner>, TBrand>,
  "brand",
  BrandDef<TInner, TBrand>
>;

export type TransformSpec<TInput> = {
  readonly [TKey in keyof TInput]?: (value: TInput[TKey], source: TInput) => unknown;
};

export type TransformOutput<TInput, TSpec extends TransformSpec<TInput>> = {
  -readonly [TKey in keyof TInput]: TKey extends keyof TSpec
    ? TSpec[TKey] extends (...args: never[]) => infer TOutput
      ? TOutput
      : TInput[TKey]
    : TInput[TKey];
};

export interface TransformDef<TInner extends AnyTypeSchema = AnyTypeSchema, TSpec = unknown>
  extends InnerTypeDef<TInner> {
  readonly transforms: TSpec;
}

export type TransformSchema<
  TInner extends AnyTypeSchema = AnyTypeSchema,
  TSpec extends TransformSpec<TypeofSchema<TInner>> = TransformSpec<TypeofSchema<TInner>>,
> = BaseSchema<TransformOutput<TypeofSchema<TInner>, TSpec>, "transform", TransformDef<TInner, TSpec>>;

export interface PipeDef<TInner extends AnyTypeSchema = AnyTypeSchema, TOutput = unknown> extends InnerTypeDef<TInner> {
  readonly transform: (value: TypeofSchema<TInner>) => TOutput;
}

export type PipeSchema<TInner extends AnyTypeSchema = AnyTypeSchema, TOutput = unknown> = BaseSchema<
  TOutput,
  "pipe",
  PipeDef<TInner, TOutput>
>;

export interface LazyDef<TInner extends AnyTypeSchema = AnyTypeSchema> {
  readonly getter: () => TInner;
}

export type LazySchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  TypeofSchema<TInner>,
  "lazy",
  LazyDef<TInner>
>;

export type WhenMatcher<TContextValue = unknown> = TContextValue | ((value: TContextValue) => boolean);

export interface WhenDef<
  TThen extends AnyTypeSchema = AnyTypeSchema,
  TOtherwise extends AnyTypeSchema = AnyTypeSchema,
> {
  readonly key: string;
  readonly is: WhenMatcher;
  readonly thenType: TThen;
  readonly otherwiseType: TOtherwise;
}

export type WhenSchema<
  TThen extends AnyTypeSchema = AnyTypeSchema,
  TOtherwise extends AnyTypeSchema = AnyTypeSchema,
> = BaseSchema<TypeofSchema<TThen> | TypeofSchema<TOtherwise>, "when", WhenDef<TThen, TOtherwise>>;

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

export interface LiteralDef<TValue = unknown> {
  readonly value: TValue;
}

export type LiteralSchema<TValue = unknown> = BaseSchema<TValue, "literal", LiteralDef<TValue>>;

export type EnumValuesInput = readonly (string | number)[] | Readonly<Record<string, string | number>>;

export type EnumOutput<TValues extends EnumValuesInput> = TValues extends readonly (infer TItem extends
  | string
  | number)[]
  ? TItem
  : TValues[keyof TValues];

export interface EnumDef<TValues extends EnumValuesInput = Readonly<Record<string, string | number>>> {
  readonly values: TValues;
}

export type EnumSchema<TValues extends EnumValuesInput = Readonly<Record<string, string | number>>> = BaseSchema<
  EnumOutput<TValues>,
  "enum",
  EnumDef<TValues>
>;

export interface InstanceOfDef<
  TCtor extends abstract new (
    ...args: any[]
  ) => unknown = abstract new (
    ...args: any[]
  ) => unknown,
> {
  readonly ctor: TCtor;
}

export type InstanceOfSchema<
  TCtor extends abstract new (
    ...args: any[]
  ) => unknown = abstract new (
    ...args: any[]
  ) => unknown,
> = BaseSchema<InstanceType<TCtor>, "instanceof", InstanceOfDef<TCtor>>;

export interface CustomDef<TOutput = unknown> {
  readonly predicate: ((value: unknown) => value is TOutput) | ((value: unknown) => boolean) | undefined;
  readonly message: string | undefined;
}

export type CustomSchema<TOutput = unknown> = BaseSchema<TOutput, "custom", CustomDef<TOutput>>;

export type NotSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<unknown, "not", InnerTypeDef<TInner>>;

export type TemplateLiteralInputPart = string | AnyTypeSchema | { readonly schema: AnyTypeSchema };

export interface TemplateLiteralDef<
  TParts extends readonly (string | AnyTypeSchema)[] = readonly (string | AnyTypeSchema)[],
> {
  readonly parts: TParts;
}

export type TemplateLiteralSchema<
  TParts extends readonly TemplateLiteralInputPart[] = readonly TemplateLiteralInputPart[],
> = BaseSchema<
  TemplateLiteralOutput<TParts>,
  "templateLiteral",
  TemplateLiteralDef<TemplateLiteralRuntimeParts<TParts>>
>;

export type TemplateLiteralRuntimeParts<TParts extends readonly TemplateLiteralInputPart[]> = {
  readonly [TKey in keyof TParts]: TParts[TKey] extends string ? TParts[TKey] : SchemaFromInputPart<TParts[TKey]>;
};

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

export type FunctionInputSchemas = readonly AnyTypeSchema[];

export interface FunctionDef<
  TInput extends FunctionInputSchemas = FunctionInputSchemas,
  TOutput extends AnyTypeSchema | undefined = AnyTypeSchema | undefined,
> {
  readonly input: TInput;
  readonly output: TOutput;
  readonly args: TupleSchema<TInput>;
}

export type FunctionArgs<TInput extends FunctionInputSchemas> = TupleOutput<TInput>;

export type FunctionReturn<TOutput extends AnyTypeSchema | undefined> = TOutput extends AnyTypeSchema
  ? TypeofSchema<TOutput>
  : unknown;

export type FunctionSchema<
  TInput extends FunctionInputSchemas = FunctionInputSchemas,
  TOutput extends AnyTypeSchema | undefined = AnyTypeSchema | undefined,
> = BaseSchema<(...args: FunctionArgs<TInput>) => FunctionReturn<TOutput>, "function", FunctionDef<TInput, TOutput>>;

export type TemporalKind =
  | "instant"
  | "plainDate"
  | "plainTime"
  | "plainDateTime"
  | "zonedDateTime"
  | "plainYearMonth"
  | "plainMonthDay"
  | "duration";

export interface TemporalDef<
  TKind extends TemporalKind = TemporalKind,
  TChecks extends readonly DateLikeCheck[] = readonly DateLikeCheck[],
> {
  readonly kind: TKind;
  readonly checks?: TChecks;
}

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

export type TemporalSchema<
  TKind extends TemporalKind = TemporalKind,
  TChecks extends readonly DateLikeCheck[] = readonly DateLikeCheck[],
> = BaseSchema<TemporalOutput<TKind>, "temporal", TemporalDef<TKind, TChecks>>;

export interface CodecDef<TInput extends AnyTypeSchema = AnyTypeSchema, TOutput extends AnyTypeSchema = AnyTypeSchema> {
  readonly input: TInput;
  readonly output: TOutput;
  readonly decode: (value: TypeofSchema<TInput>) => TypeofSchema<TOutput>;
  readonly encode: (value: TypeofSchema<TOutput>) => TypeofSchema<TInput>;
}

export type CodecSchema<
  TInput extends AnyTypeSchema = AnyTypeSchema,
  TOutput extends AnyTypeSchema = AnyTypeSchema,
> = BaseSchema<TypeofSchema<TOutput>, "codec", CodecDef<TInput, TOutput>>;

export interface RefineDef<TInner extends AnyTypeSchema = AnyTypeSchema> extends InnerTypeDef<TInner> {
  readonly predicate: (value: TypeofSchema<TInner>) => boolean;
  /** Custom issue message reported when the refinement rejects the value. */
  readonly message?: string;
  /** Optional issue path, relative to the refined value. */
  readonly path?: readonly IssuePathSegment[];
  /** Optional guard that decides if the refinement should run. */
  readonly when?: (payload: RefineWhenPayload<TypeofSchema<TInner>>) => boolean;
}

export type RefineSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  TypeofSchema<TInner>,
  "refine",
  RefineDef<TInner>
>;

export interface CoerceDef<TInner extends AnyTypeSchema = AnyTypeSchema> extends InnerTypeDef<TInner> {
  readonly coercer: (value: unknown) => TypeofSchema<TInner>;
}

export type CoerceSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  TypeofSchema<TInner>,
  "coerce",
  CoerceDef<TInner>
>;
