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

export type InferSchema<TSchema extends AnyTypeSchema> = TSchema["_type"];

export type InferShape<TShape extends SchemaShape> = {
  -readonly [TKey in keyof TShape]: InferSchema<TShape[TKey]>;
};

export type MutableInferShape<TShape extends SchemaShape> = {
  -readonly [TKey in keyof TShape]: InferSchema<TShape[TKey]>;
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
  | "digest";

export type StringCheck =
  | SchemaCheck<"min", number>
  | SchemaCheck<"max", number>
  | SchemaCheck<"length", number>
  | SchemaCheck<"regex", RegExp>
  | SchemaCheck<"email", RegExp>
  | SchemaCheck<"uuid", RegExp>
  | SchemaCheck<"url">
  | SchemaCheck<"trim">
  | SchemaCheck<"lowercase">
  | SchemaCheck<"uppercase">
  | SchemaCheck<"sanitize">
  | SchemaCheck<StringFormatKind, RegExp>;

export type NumberCheck =
  | SchemaCheck<"min", number>
  | SchemaCheck<"max", number>
  | SchemaCheck<"positive">
  | SchemaCheck<"negative">
  | SchemaCheck<"multipleOf", number>
  | SchemaCheck<"finite">
  | SchemaCheck<"safe">
  | SchemaCheck<"integer">;

export type ArrayCheck =
  | SchemaCheck<"min", number>
  | SchemaCheck<"max", number>
  | SchemaCheck<"length", number>
  | SchemaCheck<"nonEmpty">;

/** Def mixin holding a schema's declarative constraints. */
export interface ChecksDef<TCheck extends SchemaCheck = SchemaCheck> {
  readonly checks?: readonly TCheck[];
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
export type StringSchema = BaseSchema<string, "string", ChecksDef<StringCheck>>;
export type NumberSchema = BaseSchema<number, "number", ChecksDef<NumberCheck>>;
export type IntSchema = BaseSchema<number, "int", ChecksDef<NumberCheck>>;
export type NanSchema = BaseSchema<number, "nan", EmptyDef>;
export type NullSchema = BaseSchema<null, "null", EmptyDef>;
export type BooleanSchema = BaseSchema<boolean, "boolean", CoercibleDef>;
export type UndefinedSchema = BaseSchema<undefined, "undefined", EmptyDef>;
export type SymbolSchema = BaseSchema<symbol, "symbol", EmptyDef>;
export type BigIntSchema = BaseSchema<bigint, "bigint", CoercibleDef>;
export type DateSchema = BaseSchema<Date, "date", CoercibleDef>;
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
  InferSchema<TElement>[],
  "array",
  ElementDef<TElement> & ChecksDef<ArrayCheck>
>;

export type SetSchema<TElement extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  Set<InferSchema<TElement>>,
  "set",
  ElementDef<TElement>
>;

export type MapSchema<
  TKey extends AnyTypeSchema = AnyTypeSchema,
  TValue extends AnyTypeSchema = AnyTypeSchema,
> = BaseSchema<Map<InferSchema<TKey>, InferSchema<TValue>>, "map", KeyValueDef<TKey, TValue>>;

export type RecordSchema<
  TKey extends AnyTypeSchema = TypeSchema<PropertyKey>,
  TValue extends AnyTypeSchema = AnyTypeSchema,
> = BaseSchema<
  Record<Extract<InferSchema<TKey>, PropertyKey>, InferSchema<TValue>>,
  "record",
  KeyValueDef<TKey, TValue>
>;

export type TupleOutput<
  TItems extends readonly AnyTypeSchema[],
  TRest extends AnyTypeSchema | undefined = undefined,
> = TRest extends TypeSchema ? [...TupleItemsOutput<TItems>, ...InferSchema<TRest>[]] : TupleItemsOutput<TItems>;

type TupleItemsOutput<TItems extends readonly AnyTypeSchema[]> = TItems extends readonly []
  ? []
  : TItems extends readonly [infer THead extends AnyTypeSchema, ...infer TTail extends readonly AnyTypeSchema[]]
    ? [InferSchema<THead>, ...TupleItemsOutput<TTail>]
    : InferSchema<TItems[number]>[];

export type TupleSchema<
  TItems extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[],
  TRest extends AnyTypeSchema | undefined = undefined,
> = BaseSchema<TupleOutput<TItems, TRest>, "tuple", TupleDef<TItems, TRest>>;

export type ObjectOutput<
  TShape extends SchemaShape,
  TUnknownKeys extends ObjectUnknownKeys = undefined,
  TCatchall extends AnyTypeSchema | undefined = undefined,
> = InferShape<TShape> &
  (TCatchall extends AnyTypeSchema
    ? Record<string, InferSchema<TCatchall> | KnownObjectValue<TShape>>
    : TUnknownKeys extends "passthrough"
      ? Record<string, unknown>
      : unknown);

type KnownObjectValue<TShape extends SchemaShape> = InferShape<TShape>[keyof InferShape<TShape>];

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

export type AnyCompositionSchema = UnionSchema | IntersectionSchema | DiscriminatedUnionSchema;

export type UnionSchema<TOptions extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[]> = BaseSchema<
  InferSchema<TOptions[number]>,
  "union",
  OptionsDef<TOptions>
>;

type UnionToIntersection<TUnion> = (TUnion extends unknown ? (value: TUnion) => void : never) extends (
  value: infer TIntersection
) => void
  ? TIntersection
  : never;

export type IntersectionSchema<TOptions extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[]> = BaseSchema<
  UnionToIntersection<InferSchema<TOptions[number]>>,
  "intersection",
  OptionsDef<TOptions>
>;

export interface DiscriminatedUnionDef<TOptions extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[]>
  extends OptionsDef<TOptions> {
  readonly discriminator: string;
}

export type DiscriminatedUnionSchema<TOptions extends readonly AnyTypeSchema[] = readonly AnyTypeSchema[]> = BaseSchema<
  InferSchema<TOptions[number]>,
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
  | LazySchema;

export type OptionalSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  InferSchema<TInner> | undefined,
  "optional",
  InnerTypeDef<TInner>
>;

export type NullableSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  InferSchema<TInner> | null,
  "nullable",
  InnerTypeDef<TInner>
>;

export type NullishSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  InferSchema<TInner> | null | undefined,
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
  ReadonlyOutput<InferSchema<TInner>>,
  "readonly",
  InnerTypeDef<TInner>
>;

export type PromiseSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  Promise<InferSchema<TInner>>,
  "promise",
  InnerTypeDef<TInner>
>;

export interface DefaultDef<TInner extends AnyTypeSchema = AnyTypeSchema> extends InnerTypeDef<TInner> {
  readonly defaultValue: InferSchema<TInner> | (() => InferSchema<TInner>);
}

export type DefaultSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  InferSchema<TInner>,
  "default",
  DefaultDef<TInner>
>;

export interface BrandDef<TInner extends AnyTypeSchema = AnyTypeSchema, TBrand extends string = string>
  extends InnerTypeDef<TInner> {
  readonly brand: TBrand;
}

export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type BrandSchema<TInner extends AnyTypeSchema = AnyTypeSchema, TBrand extends string = string> = BaseSchema<
  Brand<InferSchema<TInner>, TBrand>,
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
  TSpec extends TransformSpec<InferSchema<TInner>> = TransformSpec<InferSchema<TInner>>,
> = BaseSchema<TransformOutput<InferSchema<TInner>, TSpec>, "transform", TransformDef<TInner, TSpec>>;

export interface PipeDef<TInner extends AnyTypeSchema = AnyTypeSchema, TOutput = unknown> extends InnerTypeDef<TInner> {
  readonly transform: (value: InferSchema<TInner>) => TOutput;
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
  InferSchema<TInner>,
  "lazy",
  LazyDef<TInner>
>;

export type AnySpecialSchema =
  | LiteralSchema
  | EnumSchema
  | InstanceOfSchema
  | RefineSchema
  | CoerceSchema
  | CustomSchema
  | TemplateLiteralSchema
  | FunctionSchema;

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
  : SchemaStringValue<InferSchema<SchemaFromInputPart<TPart>>>;

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
  ? InferSchema<TOutput>
  : unknown;

export type FunctionSchema<
  TInput extends FunctionInputSchemas = FunctionInputSchemas,
  TOutput extends AnyTypeSchema | undefined = AnyTypeSchema | undefined,
> = BaseSchema<(...args: FunctionArgs<TInput>) => FunctionReturn<TOutput>, "function", FunctionDef<TInput, TOutput>>;

export interface RefineDef<TInner extends AnyTypeSchema = AnyTypeSchema> extends InnerTypeDef<TInner> {
  readonly predicate: (value: InferSchema<TInner>) => boolean;
  /** Custom issue message reported when the refinement rejects the value. */
  readonly message?: string;
}

export type RefineSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  InferSchema<TInner>,
  "refine",
  RefineDef<TInner>
>;

export interface CoerceDef<TInner extends AnyTypeSchema = AnyTypeSchema> extends InnerTypeDef<TInner> {
  readonly coercer: (value: unknown) => InferSchema<TInner>;
}

export type CoerceSchema<TInner extends AnyTypeSchema = AnyTypeSchema> = BaseSchema<
  InferSchema<TInner>,
  "coerce",
  CoerceDef<TInner>
>;
