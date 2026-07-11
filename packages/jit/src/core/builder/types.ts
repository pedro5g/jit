import type { SafeParseResult } from "../../compiler/validate.js";
import type { Regexes } from "../../shared/index.js";
import type {
  AnyTypeSchema,
  BrandSchema,
  CodecSchema,
  CoerceSchema,
  DateLikeCheck,
  DateSchema,
  DefaultSchema,
  EnumSchema,
  EnumValuesInput,
  FunctionArgs,
  FunctionReturn,
  FunctionSchema,
  InferSchema,
  IntersectionSchema,
  IntSchema,
  LiteralSchema,
  MergeShape,
  NotSchema,
  NullableSchema,
  NullishSchema,
  NumberCheck,
  NumberSchema,
  ObjectSchema,
  ObjectUnknownKeys,
  OmitShape,
  OptionalSchema,
  PartialShape,
  PickShape,
  PipeSchema,
  PromiseSchema,
  ReadonlySchema,
  RefineOptions,
  RefineSchema,
  RequiredShape,
  SchemaCheck,
  SchemaShape,
  StringCheck,
  StringSchema,
  TemporalSchema,
  TemporalUnit,
  TransformSchema,
  TransformSpec,
  UnionSchema,
  WhenMatcher,
  WhenSchema,
  XorSchema,
} from "../ats/index.js";
import type { EntityHint, HashStrategy, OrderDirection, PropertySelector } from "../hints/index.js";
import type { SchemaInput } from "./unwrap-schema.js";

export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: readonly (string | number)[];
}

export type StandardSchemaResult<TOutput> =
  | { readonly value: TOutput; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaIssue[] };

export interface StandardSchemaProps<TInput = unknown, TOutput = TInput> {
  readonly version: 1;
  readonly vendor: "jit";
  readonly validate: (value: TInput) => StandardSchemaResult<TOutput> | Promise<StandardSchemaResult<TOutput>>;
  readonly types?: {
    readonly input: TInput;
    readonly output: TOutput;
  };
}

type StringToTuple<
  TValue extends string,
  TAcc extends readonly unknown[] = [],
> = TValue extends `${infer _}${infer TRest}` ? StringToTuple<TRest, readonly [...TAcc, unknown]> : TAcc;

type LessThan<TLeft extends number, TRight extends number, TAcc extends readonly unknown[] = []> = number extends
  | TLeft
  | TRight
  ? boolean
  : TAcc["length"] extends TLeft
    ? TAcc["length"] extends TRight
      ? false
      : true
    : TAcc["length"] extends TRight
      ? false
      : LessThan<TLeft, TRight, readonly [...TAcc, unknown]>;

type GreaterThan<TLeft extends number, TRight extends number> = LessThan<TRight, TLeft>;

type IsKnownTrue<TValue extends boolean> = TValue extends true ? (boolean extends TValue ? false : true) : false;

type IsKnownFalse<TValue extends boolean> = TValue extends false ? (boolean extends TValue ? false : true) : false;

type StringLength<TValue extends string> = StringToTuple<TValue>["length"];

type StringCheckPasses<TValue extends string, TCheck> =
  TCheck extends SchemaCheck<"min", infer TMin extends number>
    ? IsKnownTrue<LessThan<StringLength<TValue>, TMin>> extends true
      ? false
      : true
    : TCheck extends SchemaCheck<"max", infer TMax extends number>
      ? IsKnownTrue<GreaterThan<StringLength<TValue>, TMax>> extends true
        ? false
        : true
      : TCheck extends SchemaCheck<"length", infer TLength extends number>
        ? StringLength<TValue> extends TLength
          ? true
          : false
        : TCheck extends SchemaCheck<"oneOf", infer TValues extends readonly string[]>
          ? TValue extends TValues[number]
            ? true
            : false
          : TCheck extends SchemaCheck<"email", unknown>
            ? TValue extends `${string}@${string}.${string}`
              ? true
              : false
            : TCheck extends SchemaCheck<"noEmpty", unknown>
              ? TValue extends ""
                ? false
                : true
              : true;

type StringChecksPass<TValue extends string, TChecks extends readonly unknown[]> = TChecks extends readonly [
  infer THead,
  ...infer TTail,
]
  ? StringCheckPasses<TValue, THead> extends false
    ? false
    : StringChecksPass<TValue, TTail>
  : true;

type StringDefaultPasses<TValue, TChecks extends readonly unknown[]> = string extends TValue
  ? true
  : TValue extends string
    ? StringChecksPass<TValue, TChecks>
    : false;

type IsNegativeNumber<TValue extends number> = `${TValue}` extends `-${string}` ? true : false;

type IsIntegerNumber<TValue extends number> = `${TValue}` extends `${string}.${string}` ? false : true;

type IsTupleComparableNumber<TValue extends number> = number extends TValue
  ? false
  : IsNegativeNumber<TValue> extends true
    ? false
    : IsIntegerNumber<TValue>;

type NumericLessThan<TLeft extends number, TRight extends number> =
  IsTupleComparableNumber<TLeft> extends true
    ? IsTupleComparableNumber<TRight> extends true
      ? LessThan<TLeft, TRight>
      : boolean
    : boolean;

type NumericGreaterThan<TLeft extends number, TRight extends number> = NumericLessThan<TRight, TLeft>;

type NumericLessThanOrEqual<TLeft extends number, TRight extends number> = TLeft extends TRight
  ? true
  : NumericLessThan<TLeft, TRight>;

type NumberCheckPasses<TValue extends number, TCheck> =
  TCheck extends SchemaCheck<"min", infer TMin extends number>
    ? IsKnownTrue<NumericLessThan<TValue, TMin>> extends true
      ? false
      : true
    : TCheck extends SchemaCheck<"max", infer TMax extends number>
      ? IsKnownTrue<NumericGreaterThan<TValue, TMax>> extends true
        ? false
        : true
      : TCheck extends SchemaCheck<"moreThan", infer TMin extends number>
        ? IsKnownTrue<NumericLessThanOrEqual<TValue, TMin>> extends true
          ? false
          : true
        : TCheck extends SchemaCheck<"lessThan", infer TMax extends number>
          ? IsKnownTrue<NumericGreaterThan<TValue, TMax>> extends true
            ? false
            : TValue extends TMax
              ? false
              : true
          : TCheck extends SchemaCheck<"oneOf", infer TValues extends readonly number[]>
            ? TValue extends TValues[number]
              ? true
              : false
            : TCheck extends SchemaCheck<"positive", unknown>
              ? IsNegativeNumber<TValue> extends true
                ? false
                : TValue extends 0
                  ? false
                  : true
              : TCheck extends SchemaCheck<"negative", unknown>
                ? IsNegativeNumber<TValue> extends true
                  ? true
                  : false
                : TCheck extends SchemaCheck<"integer" | "int32", unknown>
                  ? IsIntegerNumber<TValue>
                  : true;

type NumberChecksPass<TValue extends number, TChecks extends readonly unknown[]> = TChecks extends readonly [
  infer THead,
  ...infer TTail,
]
  ? NumberCheckPasses<TValue, THead> extends false
    ? false
    : NumberChecksPass<TValue, TTail>
  : true;

type NumberDefaultPasses<
  TValue,
  TChecks extends readonly unknown[],
  TForceInteger extends boolean,
> = number extends TValue
  ? true
  : TValue extends number
    ? TForceInteger extends true
      ? IsKnownFalse<IsIntegerNumber<TValue>> extends true
        ? false
        : NumberChecksPass<TValue, TChecks>
      : NumberChecksPass<TValue, TChecks>
    : false;

type EnumDefaultPasses<TValue, TValues extends EnumValuesInput> = TValues extends readonly (infer TItem)[]
  ? TValue extends TItem
    ? true
    : false
  : TValue extends TValues[keyof TValues]
    ? true
    : false;

type IsOptionalLike<TSchema extends AnyTypeSchema> = TSchema extends OptionalSchema | NullishSchema | DefaultSchema
  ? true
  : TSchema extends BrandSchema<infer TInner> | ReadonlySchema<infer TInner> | RefineSchema<infer TInner>
    ? IsOptionalLike<TInner>
    : false;

type ObjectDefaultsPass<TShape extends SchemaShape, TValue> = TValue extends object
  ? false extends {
      readonly [TKey in keyof TShape]: TKey extends keyof TValue
        ? StaticDefaultPasses<TShape[TKey], TValue[TKey]>
        : IsOptionalLike<TShape[TKey]>;
    }[keyof TShape]
    ? false
    : true
  : false;

type StaticDefaultPasses<TSchema extends AnyTypeSchema, TValue> = [TValue] extends [undefined]
  ? true
  : TSchema extends StringSchema<infer TChecks>
    ? StringDefaultPasses<TValue, TChecks>
    : TSchema extends NumberSchema<infer TChecks>
      ? NumberDefaultPasses<TValue, TChecks, false>
      : TSchema extends IntSchema<infer TChecks>
        ? NumberDefaultPasses<TValue, TChecks, true>
        : TSchema extends LiteralSchema<infer TLiteral>
          ? [TValue] extends [TLiteral]
            ? true
            : false
          : TSchema extends EnumSchema<infer TValues>
            ? EnumDefaultPasses<TValue, TValues>
            : TSchema extends ObjectSchema<infer TShape>
              ? ObjectDefaultsPass<TShape, TValue>
              : TSchema extends OptionalSchema<infer TInner> | DefaultSchema<infer TInner>
                ? StaticDefaultPasses<TInner, TValue>
                : TSchema extends NullableSchema<infer TInner>
                  ? [TValue] extends [null]
                    ? true
                    : StaticDefaultPasses<TInner, TValue>
                  : TSchema extends NullishSchema<infer TInner>
                    ? [TValue] extends [null | undefined]
                      ? true
                      : StaticDefaultPasses<TInner, TValue>
                    : TSchema extends
                          | BrandSchema<infer TInner>
                          | ReadonlySchema<infer TInner>
                          | RefineSchema<infer TInner>
                      ? StaticDefaultPasses<TInner, TValue>
                      : true;

type DefaultReturn<TDefault> = TDefault extends () => infer TReturn ? TReturn : TDefault;

export type ValidDefault<TSchema extends AnyTypeSchema, TDefault> =
  StaticDefaultPasses<TSchema, DefaultReturn<TDefault>> extends false ? never : TDefault;

export type Strict<TSchemaLike, TValue> = TSchemaLike extends { readonly schema: infer TSchema extends AnyTypeSchema }
  ? StaticDefaultPasses<TSchema, TValue> extends false
    ? never
    : TValue
  : TSchemaLike extends AnyTypeSchema
    ? StaticDefaultPasses<TSchemaLike, TValue> extends false
      ? never
      : TValue
    : never;

type AppendStringCheck<TSchema extends AnyTypeSchema, TCheck extends StringCheck> =
  TSchema extends StringSchema<infer TChecks> ? StringSchema<readonly [...TChecks, TCheck]> : TSchema;

type AppendNumberCheck<TSchema extends AnyTypeSchema, TCheck extends NumberCheck> =
  TSchema extends NumberSchema<infer TChecks>
    ? NumberSchema<readonly [...TChecks, TCheck]>
    : TSchema extends IntSchema<infer TChecks>
      ? IntSchema<readonly [...TChecks, TCheck]>
      : TSchema;

type AppendDateLikeCheck<TSchema extends AnyTypeSchema, TCheck extends DateLikeCheck> =
  TSchema extends DateSchema<infer TChecks>
    ? DateSchema<readonly [...TChecks, TCheck]>
    : TSchema extends TemporalSchema<infer TKind, infer TChecks>
      ? TemporalSchema<TKind, readonly [...TChecks, TCheck]>
      : TSchema;

type RequiredField<TSchema extends AnyTypeSchema> =
  TSchema extends OptionalSchema<infer TInner>
    ? TInner
    : TSchema extends NullishSchema<infer TInner>
      ? NullableSchema<TInner>
      : TSchema extends DefaultSchema<infer TInner>
        ? TInner
        : TSchema;

type FormatPatternChar = "#" | " " | "-" | "." | "/" | "(" | ")" | "+";

type HasFormatPlaceholder<TPattern extends string> = TPattern extends `${string}#${string}` ? true : false;

type IsFormatPattern<TPattern extends string> = TPattern extends ""
  ? true
  : TPattern extends `${infer THead}${infer TRest}`
    ? THead extends FormatPatternChar
      ? IsFormatPattern<TRest>
      : false
    : true;

type ValidFormatPattern<TPattern extends string> = string extends TPattern
  ? TPattern
  : HasFormatPlaceholder<TPattern> extends true
    ? IsFormatPattern<TPattern> extends true
      ? TPattern
      : never
    : never;

export interface WhenOptions<
  TSchema extends AnyTypeSchema,
  TContextValue = unknown,
  TThen extends AnyTypeSchema = RequiredField<TSchema>,
  TOtherwise extends AnyTypeSchema = TSchema,
> {
  readonly is: WhenMatcher<TContextValue>;
  readonly then: (schema: Builder<RequiredField<TSchema>>) => SchemaInput<TThen>;
  readonly otherwise?: (schema: Builder<TSchema>) => SchemaInput<TOtherwise>;
}

type PartialKeysShape<TShape extends SchemaShape, TKeys extends keyof TShape> = {
  readonly [TKey in keyof TShape]: TKey extends TKeys ? OptionalSchema<TShape[TKey]> : TShape[TKey];
};

type RequiredKeysShape<TShape extends SchemaShape, TKeys extends keyof TShape> = {
  readonly [TKey in keyof TShape]: TKey extends TKeys
    ? TShape[TKey] extends OptionalSchema<infer TInner>
      ? TInner
      : TShape[TKey]
    : TShape[TKey];
};

export interface BuilderCore<TSchema extends AnyTypeSchema> {
  readonly schema: TSchema;
  readonly "~standard": StandardSchemaProps<unknown, InferSchema<TSchema>>;
  is(value: unknown): value is InferSchema<TSchema>;
  safeParse(value: unknown): SafeParseResult<InferSchema<TSchema>>;
  parse(value: unknown): InferSchema<TSchema>;
  safeParseAsync(value: unknown): Promise<SafeParseResult<InferSchema<TSchema>>>;
  parseAsync(value: unknown): Promise<InferSchema<TSchema>>;
  optional(): Builder<OptionalSchema<TSchema>>;
  required(message?: string): Builder<RequiredField<TSchema>>;
  nullable(): Builder<NullableSchema<TSchema>>;
  nullish(): Builder<NullishSchema<TSchema>>;
  readonly(): Builder<ReadonlySchema<TSchema>>;
  promise(): Builder<PromiseSchema<TSchema>>;
  default<const TDefault extends InferSchema<TSchema> | (() => InferSchema<TSchema>)>(
    defaultValue: TDefault & ValidDefault<TSchema, TDefault>
  ): Builder<DefaultSchema<TSchema>>;
  brand<const TBrand extends string>(brandName: TBrand): Builder<BrandSchema<TSchema, TBrand>>;
  pipe<TOutput>(transform: (value: InferSchema<TSchema>) => TOutput): Builder<PipeSchema<TSchema, TOutput>>;
  or<TRight extends AnyTypeSchema>(right: SchemaInput<TRight>): Builder<UnionSchema<[TSchema, TRight]>>;
  and<TRight extends AnyTypeSchema>(right: SchemaInput<TRight>): Builder<IntersectionSchema<[TSchema, TRight]>>;
  xor<TRight extends AnyTypeSchema>(right: SchemaInput<TRight>): Builder<XorSchema<[TSchema, TRight]>>;
  not(): Builder<NotSchema<TSchema>>;
  when<
    const TKey extends string,
    TContextValue = unknown,
    TThen extends AnyTypeSchema = RequiredField<TSchema>,
    TOtherwise extends AnyTypeSchema = TSchema,
  >(key: TKey, options: WhenOptions<TSchema, TContextValue, TThen, TOtherwise>): Builder<WhenSchema<TThen, TOtherwise>>;
  where<
    const TKey extends string,
    TContextValue = unknown,
    TThen extends AnyTypeSchema = RequiredField<TSchema>,
    TOtherwise extends AnyTypeSchema = TSchema,
  >(key: TKey, options: WhenOptions<TSchema, TContextValue, TThen, TOtherwise>): Builder<WhenSchema<TThen, TOtherwise>>;
  refine(
    predicate: (value: InferSchema<TSchema>) => boolean,
    options?: string | RefineOptions<InferSchema<TSchema>>
  ): Builder<RefineSchema<TSchema>>;
  coerce(coercer: (value: unknown) => InferSchema<TSchema>): Builder<CoerceSchema<TSchema>>;
  apply<TNext>(fn: (builder: Builder<TSchema>) => TNext): TNext;
  entity(options: EntityHint<HintTarget<InferSchema<TSchema>>>): Builder<TSchema>;
  keyed(key: Extract<PropertySelector<HintTarget<InferSchema<TSchema>>>, string>): Builder<TSchema>;
  groupBy(key: Extract<PropertySelector<HintTarget<InferSchema<TSchema>>>, string>): Builder<TSchema>;
  sortBy(
    key: Extract<PropertySelector<HintTarget<InferSchema<TSchema>>>, string>,
    direction?: OrderDirection
  ): Builder<TSchema>;
  uniqueBy(key: Extract<PropertySelector<HintTarget<InferSchema<TSchema>>>, string>): Builder<TSchema>;
  indexBy(key: Extract<PropertySelector<HintTarget<InferSchema<TSchema>>>, string>): Builder<TSchema>;
  ordered(
    key: Extract<PropertySelector<HintTarget<InferSchema<TSchema>>>, string>,
    direction?: OrderDirection
  ): Builder<TSchema>;
  hash(strategy?: HashStrategy): Builder<TSchema>;
  /**
   * Marks this field as personally identifiable information. `JIT.mask`
   * replaces marked fields: `"redact"` → `"***"` / `0`, `"mask"` → keeps the
   * last characters, `"hash"` → inline FNV-1a hash.
   */
  pii(strategy?: "redact" | "mask" | "hash"): Builder<TSchema>;
}

type HintTarget<T> = T extends readonly (infer TElement)[] ? TElement : T;

export interface ObjectOperators<
  TShape extends SchemaShape,
  TUnknownKeys extends ObjectUnknownKeys = undefined,
  TCatchall extends AnyTypeSchema | undefined = undefined,
> {
  partial(): ObjectBuilder<PartialShape<TShape>, TUnknownKeys, TCatchall>;
  partial<const TKeys extends readonly (keyof TShape)[]>(
    keys: TKeys
  ): ObjectBuilder<PartialKeysShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall>;
  partial<const TKeys extends readonly (keyof TShape)[]>(
    ...keys: TKeys
  ): ObjectBuilder<PartialKeysShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall>;
  required(): ObjectBuilder<RequiredShape<TShape>, TUnknownKeys, TCatchall>;
  required<const TKeys extends readonly (keyof TShape)[]>(
    keys: TKeys
  ): ObjectBuilder<RequiredKeysShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall>;
  required<const TKeys extends readonly (keyof TShape)[]>(
    ...keys: TKeys
  ): ObjectBuilder<RequiredKeysShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall>;
  strict(): ObjectBuilder<TShape, "strict", TCatchall>;
  loose(): ObjectBuilder<TShape, "passthrough", TCatchall>;
  catchall<TCatchallNext extends AnyTypeSchema>(
    schema: SchemaInput<TCatchallNext>
  ): ObjectBuilder<TShape, "passthrough", TCatchallNext>;
  keyof(): Builder<EnumSchema<KeyOfValues<TShape>>>;
  transform<const TSpec extends TransformSpec<InferSchema<ObjectSchema<TShape, TUnknownKeys, TCatchall>>>>(
    transforms: TSpec
  ): Builder<TransformSchema<ObjectSchema<TShape, TUnknownKeys, TCatchall>, TSpec>>;
  pick<const TKeys extends readonly (keyof TShape)[]>(
    keys: TKeys
  ): ObjectBuilder<PickShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall>;
  pick<const TKeys extends readonly (keyof TShape)[]>(
    ...keys: TKeys
  ): ObjectBuilder<PickShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall>;
  omit<const TKeys extends readonly (keyof TShape)[]>(
    keys: TKeys
  ): ObjectBuilder<OmitShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall>;
  omit<const TKeys extends readonly (keyof TShape)[]>(
    ...keys: TKeys
  ): ObjectBuilder<OmitShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall>;
  extend<const TExtension extends Record<string, SchemaInput>>(
    extension: TExtension
  ): ObjectBuilder<MergeShape<TShape, UnwrapBuilderShape<TExtension>>, TUnknownKeys, TCatchall>;
  merge<TRight extends SchemaShape>(
    right: ObjectBuilder<TRight, ObjectUnknownKeys, AnyTypeSchema | undefined> | ObjectSchema<TRight>
  ): ObjectBuilder<MergeShape<TShape, TRight>, TUnknownKeys, TCatchall>;
}

export type KeyOfValues<TShape extends SchemaShape> = {
  readonly [TKey in Extract<keyof TShape, string>]: TKey;
};

export type UnwrapBuilderShape<TShape extends Record<string, SchemaInput>> = {
  readonly [TKey in keyof TShape]: TShape[TKey] extends SchemaInput<infer TSchema extends AnyTypeSchema>
    ? TSchema
    : never;
};

export type BaseBuilder<TSchema extends AnyTypeSchema> = BuilderCore<TSchema>;

export interface FunctionOperators<
  TInput extends readonly AnyTypeSchema[],
  TOutput extends AnyTypeSchema | undefined = AnyTypeSchema | undefined,
> {
  implement<TImplementation extends (...args: FunctionArgs<TInput>) => FunctionReturn<TOutput>>(
    implementation: TImplementation
  ): (...args: FunctionArgs<TInput>) => ReturnType<TImplementation>;
  implementAsync<TImplementation extends (...args: FunctionArgs<TInput>) => PromiseLike<FunctionReturn<TOutput>>>(
    implementation: TImplementation
  ): (...args: FunctionArgs<TInput>) => Promise<Awaited<ReturnType<TImplementation>>>;
}

export interface CodecOperators<TInput extends AnyTypeSchema, TOutput extends AnyTypeSchema> {
  decode(value: InferSchema<TInput>): InferSchema<TOutput>;
  encode(value: InferSchema<TOutput>): InferSchema<TInput>;
}

/** String constraint methods; every call returns the same builder type. */
export interface StringCheckMethods<TSchema extends AnyTypeSchema> {
  min<const TLength extends number>(
    length: TLength,
    message?: string
  ): Builder<AppendStringCheck<TSchema, SchemaCheck<"min", TLength>>>;
  max<const TLength extends number>(
    length: TLength,
    message?: string
  ): Builder<AppendStringCheck<TSchema, SchemaCheck<"max", TLength>>>;
  length<const TLength extends number>(
    length: TLength,
    message?: string
  ): Builder<AppendStringCheck<TSchema, SchemaCheck<"length", TLength>>>;
  oneOf<const TValues extends readonly [string, ...string[]]>(
    values: TValues,
    message?: string
  ): Builder<AppendStringCheck<TSchema, SchemaCheck<"oneOf", TValues>>>;
  regex(pattern: RegExp, message?: string): Builder<TSchema>;
  /** Email format; pass a RegExp to override the default pattern (e.g. `JIT.regexes.rfc5322Email`). */
  email(message?: string): Builder<AppendStringCheck<TSchema, SchemaCheck<"email", RegExp>>>;
  email(pattern: RegExp, message?: string): Builder<AppendStringCheck<TSchema, SchemaCheck<"email", RegExp>>>;
  /** RFC 9562/4122 UUID; pass a version (1-8) to pin it. */
  uuid(message?: string): Builder<TSchema>;
  uuid(version: number, message?: string): Builder<TSchema>;
  url(message?: string): Builder<TSchema>;
  noEmpty(): Builder<AppendStringCheck<TSchema, SchemaCheck<"noEmpty">>>;
  trim(): Builder<TSchema>;
  lowercase(): Builder<TSchema>;
  uppercase(): Builder<TSchema>;
  /**
   * Strips HTML/script content and escapes stray angle brackets. Applied by
   * `JIT.sanitize` and inside compiled `parse`/`safeParse` output.
   */
  sanitize(): Builder<TSchema>;
  guid(message?: string): Builder<TSchema>;
  cuid(message?: string): Builder<TSchema>;
  cuid2(message?: string): Builder<TSchema>;
  ulid(message?: string): Builder<TSchema>;
  xid(message?: string): Builder<TSchema>;
  ksuid(message?: string): Builder<TSchema>;
  nanoid(message?: string): Builder<TSchema>;
  duration(message?: string): Builder<TSchema>;
  emoji(message?: string): Builder<TSchema>;
  ipv4(message?: string): Builder<TSchema>;
  ipv6(message?: string): Builder<TSchema>;
  cidrv4(message?: string): Builder<TSchema>;
  cidrv6(message?: string): Builder<TSchema>;
  base64(message?: string): Builder<TSchema>;
  base64url(message?: string): Builder<TSchema>;
  hostname(message?: string): Builder<TSchema>;
  domain(message?: string): Builder<TSchema>;
  e164(message?: string): Builder<TSchema>;
  hex(message?: string): Builder<TSchema>;
  date(message?: string): Builder<TSchema>;
  mac(delimiter?: string, message?: string): Builder<TSchema>;
  time(options?: Regexes.TimeOptions, message?: string): Builder<TSchema>;
  datetime(options?: Regexes.DatetimeOptions, message?: string): Builder<TSchema>;
  /** Hash digest format, e.g. `.digest("sha256", "base64url")`. */
  digest(algorithm: Regexes.HashAlgorithm, encoding?: Regexes.HashEncoding, message?: string): Builder<TSchema>;
  /**
   * Formats parsed strings through a `#` mask. By default non-digits are
   * stripped first, so `.format("###.###.###-##")` accepts raw CPF digits.
   */
  format<const TPattern extends string>(
    pattern: TPattern & ValidFormatPattern<TPattern>,
    options?: { readonly stripNonDigits?: boolean },
    message?: string
  ): Builder<
    AppendStringCheck<TSchema, SchemaCheck<"format", { readonly pattern: string; readonly stripNonDigits: boolean }>>
  >;
  cpf(message?: string): Builder<TSchema>;
  cnpj(message?: string): Builder<TSchema>;
  phoneBR(message?: string): Builder<TSchema>;
}

/** Numeric constraint methods; every call returns the same builder type. */
export interface NumberCheckMethods<TSchema extends AnyTypeSchema> {
  min<const TValue extends number>(
    value: TValue,
    message?: string
  ): Builder<AppendNumberCheck<TSchema, SchemaCheck<"min", TValue>>>;
  max<const TValue extends number>(
    value: TValue,
    message?: string
  ): Builder<AppendNumberCheck<TSchema, SchemaCheck<"max", TValue>>>;
  moreThan<const TValue extends number>(
    value: TValue,
    message?: string
  ): Builder<AppendNumberCheck<TSchema, SchemaCheck<"moreThan", TValue>>>;
  lessThan<const TValue extends number>(
    value: TValue,
    message?: string
  ): Builder<AppendNumberCheck<TSchema, SchemaCheck<"lessThan", TValue>>>;
  oneOf<const TValues extends readonly [number, ...number[]]>(
    values: TValues,
    message?: string
  ): Builder<AppendNumberCheck<TSchema, SchemaCheck<"oneOf", TValues>>>;
  positive(message?: string): Builder<AppendNumberCheck<TSchema, SchemaCheck<"positive">>>;
  negative(message?: string): Builder<AppendNumberCheck<TSchema, SchemaCheck<"negative">>>;
  multipleOf(value: number, message?: string): Builder<TSchema>;
  finite(message?: string): Builder<TSchema>;
  safe(message?: string): Builder<TSchema>;
  int(message?: string): Builder<AppendNumberCheck<TSchema, SchemaCheck<"integer">>>;
  int32(message?: string): Builder<AppendNumberCheck<TSchema, SchemaCheck<"int32">>>;
  float32(message?: string): Builder<AppendNumberCheck<TSchema, SchemaCheck<"float32">>>;
  float64(message?: string): Builder<AppendNumberCheck<TSchema, SchemaCheck<"float64">>>;
}

/** Array length constraint methods; every call returns the same builder type. */
export interface ArrayCheckMethods<TSchema extends AnyTypeSchema> {
  min(length: number, message?: string): Builder<TSchema>;
  max(length: number, message?: string): Builder<TSchema>;
  length(length: number, message?: string): Builder<TSchema>;
  nonEmpty(message?: string): Builder<TSchema>;
}

export interface DateLikeCheckMethods<TSchema extends AnyTypeSchema> {
  min(value: Date | string, message?: string): Builder<AppendDateLikeCheck<TSchema, SchemaCheck<"min", Date | string>>>;
  max(value: Date | string, message?: string): Builder<AppendDateLikeCheck<TSchema, SchemaCheck<"max", Date | string>>>;
  between(
    min: Date | string,
    max: Date | string,
    message?: string
  ): Builder<
    AppendDateLikeCheck<TSchema, SchemaCheck<"between", { readonly min: Date | string; readonly max: Date | string }>>
  >;
  daysOfWeek(
    days: readonly number[],
    message?: string
  ): Builder<AppendDateLikeCheck<TSchema, SchemaCheck<"daysOfWeek", readonly number[]>>>;
  monthsOfYear(
    months: readonly number[],
    message?: string
  ): Builder<AppendDateLikeCheck<TSchema, SchemaCheck<"monthsOfYear", readonly number[]>>>;
  truncateTo(
    unit: TemporalUnit,
    message?: string
  ): Builder<AppendDateLikeCheck<TSchema, SchemaCheck<"truncateTo", TemporalUnit>>>;
}

type CheckMethods<TSchema extends AnyTypeSchema> = TSchema extends { readonly type: "string" }
  ? StringCheckMethods<TSchema>
  : TSchema extends { readonly type: "number" | "int" }
    ? NumberCheckMethods<TSchema>
    : TSchema extends { readonly type: "array" }
      ? ArrayCheckMethods<TSchema>
      : TSchema extends { readonly type: "date" | "temporal" }
        ? DateLikeCheckMethods<TSchema>
        : unknown;

export type ObjectBuilder<
  TShape extends SchemaShape,
  TUnknownKeys extends ObjectUnknownKeys = undefined,
  TCatchall extends AnyTypeSchema | undefined = undefined,
> = Omit<BuilderCore<ObjectSchema<TShape, TUnknownKeys, TCatchall>>, "required"> &
  ObjectOperators<TShape, TUnknownKeys, TCatchall>;

export type FunctionBuilder<
  TInput extends readonly AnyTypeSchema[],
  TOutput extends AnyTypeSchema | undefined = AnyTypeSchema | undefined,
> = BuilderCore<FunctionSchema<TInput, TOutput>> & FunctionOperators<TInput, TOutput>;

export type CodecBuilder<TInput extends AnyTypeSchema, TOutput extends AnyTypeSchema> = BuilderCore<
  CodecSchema<TInput, TOutput>
> &
  CodecOperators<TInput, TOutput>;

export type Builder<TSchema extends AnyTypeSchema> =
  TSchema extends ObjectSchema<infer TShape, infer TUnknownKeys, infer TCatchall>
    ? ObjectBuilder<TShape, TUnknownKeys, TCatchall>
    : TSchema extends FunctionSchema<infer TInput, infer TOutput>
      ? FunctionBuilder<TInput, TOutput>
      : TSchema extends CodecSchema<infer TInput, infer TOutput>
        ? CodecBuilder<TInput, TOutput>
        : BaseBuilder<TSchema> & CheckMethods<TSchema>;

export type AnyBuilder = Builder<AnyTypeSchema>;
