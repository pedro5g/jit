import type { BinaryArray, BinaryRowSetOptions } from "../../compiler/binary-rowset.js";
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
  StringMaskMode,
  StringMaskSpec,
  StringNormalizationForm,
  StringSanitizePreset,
  StringSanitizeSpec,
  StringSchema,
  TemporalSchema,
  TemporalUnit,
  TransformSchema,
  TransformSpec,
  TypeofSchema,
  UnionSchema,
  WhenMatcher,
  WhenSchema,
  XorSchema,
} from "../ats/index.js";
import type { EntityHint, HashStrategy, Metadata, OrderDirection, PropertySelector } from "../hints/index.js";
import type { OpChain } from "../ops.js";
import type { HasStringCheck, SchemaInput } from "./check-state.js";

/** Describes the JIT standard schema issue contract used by the public API. */
export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: readonly (string | number)[];
}

/** Describes the JIT standard schema result contract used by the public API. */
export type StandardSchemaResult<TOutput> =
  | { readonly value: TOutput; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaIssue[] };

/** Describes the JIT standard schema props contract used by the public API. */
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
            : TCheck extends SchemaCheck<"startsWith", infer TPrefix extends string>
              ? TValue extends `${TPrefix}${string}`
                ? true
                : false
              : TCheck extends SchemaCheck<"endsWith", infer TSuffix extends string>
                ? TValue extends `${string}${TSuffix}`
                  ? true
                  : false
                : TCheck extends SchemaCheck<"includes", infer TNeedle extends string>
                  ? TValue extends `${string}${TNeedle}${string}`
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

/**
 * Digit-wise numeric comparison.
 *
 * Counting a tuple up to the value is exact but costs one instantiation per
 * unit, so a bound like `.max(65535)` exhausts the compiler before it can
 * answer. Comparing the decimal strings costs one step per *digit* instead,
 * which keeps a static default check on any integer bound essentially free.
 *
 * Values the comparison cannot decide (a non-literal `number`, a decimal)
 * resolve to `boolean`, which `IsKnownTrue`/`IsKnownFalse` read as "unknown"
 * — so an undecidable bound never rejects a valid default.
 */
type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

type GreaterDigits = {
  "0": "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
  "1": "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
  "2": "3" | "4" | "5" | "6" | "7" | "8" | "9";
  "3": "4" | "5" | "6" | "7" | "8" | "9";
  "4": "5" | "6" | "7" | "8" | "9";
  "5": "6" | "7" | "8" | "9";
  "6": "7" | "8" | "9";
  "7": "8" | "9";
  "8": "9";
  "9": never;
};

type DigitCount<TText extends string, TAcc extends readonly unknown[] = []> = TText extends `${string}${infer TRest}`
  ? DigitCount<TRest, readonly [...TAcc, unknown]>
  : TAcc["length"];

type CompareSameLength<
  TLeft extends string,
  TRight extends string,
> = TLeft extends `${infer TLeftHead extends Digit}${infer TLeftRest}`
  ? TRight extends `${infer TRightHead extends Digit}${infer TRightRest}`
    ? TLeftHead extends TRightHead
      ? CompareSameLength<TLeftRest, TRightRest>
      : TRightHead extends GreaterDigits[TLeftHead]
        ? "lt"
        : "gt"
    : "gt"
  : "eq";

/** Compares two non-negative integer strings; longer means larger. */
type CompareDigits<TLeft extends string, TRight extends string> =
  DigitCount<TLeft> extends DigitCount<TRight>
    ? CompareSameLength<TLeft, TRight>
    : LessThan<DigitCount<TLeft>, DigitCount<TRight>> extends true
      ? "lt"
      : "gt";

type Magnitude<TValue extends number> = `${TValue}` extends `-${infer TRest}` ? TRest : `${TValue}`;

/** Describes the JIT compare numeric literal contract used by the public API. */
export type CompareNumericLiteral<TLeft extends number, TRight extends number> = number extends TLeft | TRight
  ? "unknown"
  : IsIntegerNumber<TLeft> extends false
    ? "unknown"
    : IsIntegerNumber<TRight> extends false
      ? "unknown"
      : IsNegativeNumber<TLeft> extends true
        ? IsNegativeNumber<TRight> extends true
          ? // Both negative: the larger magnitude is the smaller number.
            CompareDigits<Magnitude<TRight>, Magnitude<TLeft>>
          : "lt"
        : IsNegativeNumber<TRight> extends true
          ? "gt"
          : CompareDigits<Magnitude<TLeft>, Magnitude<TRight>>;

type NumericLessThan<TLeft extends number, TRight extends number> =
  CompareNumericLiteral<TLeft, TRight> extends "unknown"
    ? boolean
    : CompareNumericLiteral<TLeft, TRight> extends "lt"
      ? true
      : false;

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

/** Describes the JIT valid default contract used by the public API. */
export type ValidDefault<TSchema extends AnyTypeSchema, TDefault> =
  StaticDefaultPasses<TSchema, DefaultReturn<TDefault>> extends false ? never : TDefault;

/** Provides the JIT strict operation for the supplied input. */
export type Strict<TSchemaLike, TValue> = TSchemaLike extends {
  readonly schema: infer TSchema extends AnyTypeSchema;
}
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

/** Describes the JIT when options contract used by the public API. */
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

/** Describes the JIT builder core contract used by the public API. */
export interface BuilderCore<TSchema extends AnyTypeSchema> {
  readonly schema: TSchema;
  readonly "~standard": StandardSchemaProps<unknown, TypeofSchema<TSchema>>;
  /** Tests a value without allocating diagnostics. */
  is(value: unknown): value is TypeofSchema<TSchema>;
  /** Validates a value and returns a discriminated success/failure result. */
  safeParse(value: unknown): SafeParseResult<TypeofSchema<TSchema>>;
  /** Validates a value or throws the library's validation error. */
  parse(value: unknown): TypeofSchema<TSchema>;
  /** Asynchronously validates a value and returns diagnostics instead of throwing. */
  safeParseAsync(value: unknown): Promise<SafeParseResult<TypeofSchema<TSchema>>>;
  /** Asynchronously validates a value or rejects with the validation error. */
  parseAsync(value: unknown): Promise<TypeofSchema<TSchema>>;
  /** Allows `undefined` at the input boundary. */
  optional(): Builder<OptionalSchema<TSchema>>;
  /** Removes optionality and optionally supplies the issue message for missing input. */
  required(message?: string): Builder<RequiredField<TSchema>>;
  /** Allows `null` at the input boundary. */
  nullable(): Builder<NullableSchema<TSchema>>;
  /** Allows both `null` and `undefined` at the input boundary. */
  nullish(): Builder<NullishSchema<TSchema>>;
  /** Marks the output as readonly for static consumers. */
  readonly(): Builder<ReadonlySchema<TSchema>>;
  /** Accepts a promise of the schema value and validates its resolved value. */
  promise(): Builder<PromiseSchema<TSchema>>;
  /** Supplies a fallback for `undefined`; the default is checked against this schema. */
  default<const TDefault extends TypeofSchema<TSchema> | (() => TypeofSchema<TSchema>)>(
    defaultValue: TDefault & ValidDefault<TSchema, TDefault>
  ): Builder<DefaultSchema<TSchema>>;
  /** Adds a compile-time brand without changing runtime validation. */
  brand<const TBrand extends string>(brandName: TBrand): Builder<BrandSchema<TSchema, TBrand>>;
  /**
   * Applies a transformation after validation. A `JIT.ops` chain is compiled
   * into the generated validator as source; a callback is kept as a call.
   */
  pipe<TOutput>(transform: (value: TypeofSchema<TSchema>) => TOutput): Builder<PipeSchema<TSchema, TOutput>>;
  /** Applies a serializable `JIT.ops` chain after validation. */
  pipe<TChain extends OpChain>(
    transform: TChain
  ): Builder<PipeSchema<TSchema, TChain extends OpChain<never, infer TOut> ? TOut : unknown>>;
  /** Accepts a value matching either this schema or the right-hand schema. */
  or<TRight extends AnyTypeSchema>(right: SchemaInput<TRight>): Builder<UnionSchema<[TSchema, TRight]>>;
  /** Requires a value to satisfy both schemas. */
  and<TRight extends AnyTypeSchema>(right: SchemaInput<TRight>): Builder<IntersectionSchema<[TSchema, TRight]>>;
  /** Requires exactly one of the two schemas to accept the value. */
  xor<TRight extends AnyTypeSchema>(right: SchemaInput<TRight>): Builder<XorSchema<[TSchema, TRight]>>;
  /** Inverts the acceptance result of this schema. */
  not(): Builder<NotSchema<TSchema>>;
  /** Selects a schema branch from a field matcher and optional fallback. */
  when<
    const TKey extends string,
    TContextValue = unknown,
    TThen extends AnyTypeSchema = RequiredField<TSchema>,
    TOtherwise extends AnyTypeSchema = TSchema,
  >(key: TKey, options: WhenOptions<TSchema, TContextValue, TThen, TOtherwise>): Builder<WhenSchema<TThen, TOtherwise>>;
  /** Alias of `when()` for conditional object-schema branches. */
  where<
    const TKey extends string,
    TContextValue = unknown,
    TThen extends AnyTypeSchema = RequiredField<TSchema>,
    TOtherwise extends AnyTypeSchema = TSchema,
  >(key: TKey, options: WhenOptions<TSchema, TContextValue, TThen, TOtherwise>): Builder<WhenSchema<TThen, TOtherwise>>;
  /** Adds a custom predicate after schema validation. */
  refine(
    predicate: (value: TypeofSchema<TSchema>) => boolean,
    options?: string | RefineOptions<TypeofSchema<TSchema>>
  ): Builder<RefineSchema<TSchema>>;
  /** Converts an unknown boundary value before the schema validates it. */
  coerce(coercer: (value: unknown) => TypeofSchema<TSchema>): Builder<CoerceSchema<TSchema>>;
  /** Applies a builder callback and returns the callback's result. */
  apply<TNext>(fn: (builder: Builder<TSchema>) => TNext): TNext;
  /**
   * Attaches documentation metadata (title, description, examples). It never
   * changes validation; it surfaces in `JIT.jsonSchema` and other descriptive
   * outputs.
   */
  meta(metadata: Metadata): Builder<TSchema>;
  /** Marks the schema's element as an entity for collection planning. */
  entity(options: EntityHint<HintTarget<TypeofSchema<TSchema>>>): Builder<TSchema>;
  /** Declares one unique identity field and enables keyed collection planning. */
  keyed(key: Extract<PropertySelector<HintTarget<TypeofSchema<TSchema>>>, string>): Builder<TSchema>;
  /** Declares the field used to group collection elements. */
  groupBy(key: Extract<PropertySelector<HintTarget<TypeofSchema<TSchema>>>, string>): Builder<TSchema>;
  /** Declares the default ordering field and direction for collection plans. */
  sortBy(
    key: Extract<PropertySelector<HintTarget<TypeofSchema<TSchema>>>, string>,
    direction?: OrderDirection
  ): Builder<TSchema>;
  /** Declares a uniqueness hint for a collection field. */
  uniqueBy(key: Extract<PropertySelector<HintTarget<TypeofSchema<TSchema>>>, string>): Builder<TSchema>;
  /** Declares an index hint for a collection field. */
  indexBy(key: Extract<PropertySelector<HintTarget<TypeofSchema<TSchema>>>, string>): Builder<TSchema>;
  /** Declares an ordering hint without changing the schema output. */
  ordered(
    key: Extract<PropertySelector<HintTarget<TypeofSchema<TSchema>>>, string>,
    direction?: OrderDirection
  ): Builder<TSchema>;
  /** Declares the hash representation used by canonical and keyed operations. */
  hash(strategy?: HashStrategy): Builder<TSchema>;
  /**
   * Marks this field as personally identifiable information. `JIT.security.mask`
   * replaces marked fields: `"redact"` → `"***"` / `0`, `"mask"` → keeps the
   * last characters, `"hash"` → inline FNV-1a hash.
   */
  pii(strategy?: "redact" | "mask" | "hash"): Builder<TSchema>;
}

type HintTarget<T> = T extends readonly (infer TElement)[] ? TElement : T;

/** Describes the JIT object operators contract used by the public API. */
export interface ObjectOperators<
  TShape extends SchemaShape,
  TUnknownKeys extends ObjectUnknownKeys = undefined,
  TCatchall extends AnyTypeSchema | undefined = undefined,
> {
  /** Makes every field optional, or only the named fields. */
  partial(): ObjectBuilder<PartialShape<TShape>, TUnknownKeys, TCatchall>;
  /** Makes the listed fields optional. */
  partial<const TKeys extends readonly (keyof TShape)[]>(
    keys: TKeys
  ): ObjectBuilder<PartialKeysShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall>;
  /** Makes the listed fields optional using variadic field names. */
  partial<const TKeys extends readonly (keyof TShape)[]>(
    ...keys: TKeys
  ): ObjectBuilder<PartialKeysShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall>;
  /** Makes every field required, or only the named fields. */
  required(): ObjectBuilder<RequiredShape<TShape>, TUnknownKeys, TCatchall>;
  /** Makes the listed fields required. */
  required<const TKeys extends readonly (keyof TShape)[]>(
    keys: TKeys
  ): ObjectBuilder<RequiredKeysShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall>;
  /** Makes the listed fields required using variadic field names. */
  required<const TKeys extends readonly (keyof TShape)[]>(
    ...keys: TKeys
  ): ObjectBuilder<RequiredKeysShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall>;
  /** Rejects unknown object keys. */
  strict(): ObjectBuilder<TShape, "strict", TCatchall>;
  /** Preserves unknown object keys during parsing. */
  loose(): ObjectBuilder<TShape, "passthrough", TCatchall>;
  /** Validates unknown keys with the supplied catchall schema. */
  catchall<TCatchallNext extends AnyTypeSchema>(
    schema: SchemaInput<TCatchallNext>
  ): ObjectBuilder<TShape, "passthrough", TCatchallNext>;
  /** Builds a string enum schema from the object's keys. */
  keyof(): Builder<EnumSchema<KeyOfValues<TShape>>>;
  /** Applies field transforms while retaining the object's shape. */
  transform<const TSpec extends TransformSpec<TypeofSchema<ObjectSchema<TShape, TUnknownKeys, TCatchall>>>>(
    transforms: TSpec
  ): Builder<TransformSchema<ObjectSchema<TShape, TUnknownKeys, TCatchall>, TSpec>>;
  /** Keeps only the named fields. */
  pick<const TKeys extends readonly (keyof TShape)[]>(
    keys: TKeys
  ): ObjectBuilder<PickShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall>;
  /** Keeps the named fields using variadic field names. */
  pick<const TKeys extends readonly (keyof TShape)[]>(
    ...keys: TKeys
  ): ObjectBuilder<PickShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall>;
  /** Removes the named fields. */
  omit<const TKeys extends readonly (keyof TShape)[]>(
    keys: TKeys
  ): ObjectBuilder<OmitShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall>;
  /** Removes the named fields using variadic field names. */
  omit<const TKeys extends readonly (keyof TShape)[]>(
    ...keys: TKeys
  ): ObjectBuilder<OmitShape<TShape, TKeys[number]>, TUnknownKeys, TCatchall>;
  /** Adds or replaces fields in the object shape. */
  extend<const TExtension extends Record<string, SchemaInput>>(
    extension: TExtension
  ): ObjectBuilder<MergeShape<TShape, UnwrapBuilderShape<TExtension>>, TUnknownKeys, TCatchall>;
  /** Merges another object schema, including its shape and runtime checks. */
  merge<TRight extends SchemaShape>(
    right: ObjectBuilder<TRight, ObjectUnknownKeys, AnyTypeSchema | undefined> | ObjectSchema<TRight>
  ): ObjectBuilder<MergeShape<TShape, TRight>, TUnknownKeys, TCatchall>;
}

/** Describes the JIT key of values contract used by the public API. */
export type KeyOfValues<TShape extends SchemaShape> = readonly Extract<keyof TShape, string>[];

/** Describes the JIT unwrap builder shape contract used by the public API. */
export type UnwrapBuilderShape<TShape extends Record<string, SchemaInput>> = {
  readonly [TKey in keyof TShape]: TShape[TKey] extends SchemaInput<infer TSchema extends AnyTypeSchema>
    ? TSchema
    : never;
};

/** Describes the JIT base builder contract used by the public API. */
export type BaseBuilder<TSchema extends AnyTypeSchema> = BuilderCore<TSchema>;

/** Describes the JIT function operators contract used by the public API. */
export interface FunctionOperators<
  TInput extends readonly AnyTypeSchema[],
  TOutput extends AnyTypeSchema | undefined = AnyTypeSchema | undefined,
> {
  /** Attaches a synchronous implementation and returns a typed callable function. */
  implement<TImplementation extends (...args: FunctionArgs<TInput>) => FunctionReturn<TOutput>>(
    implementation: TImplementation
  ): (...args: FunctionArgs<TInput>) => ReturnType<TImplementation>;
  /** Attaches an asynchronous implementation and returns a typed promise-producing function. */
  implementAsync<TImplementation extends (...args: FunctionArgs<TInput>) => PromiseLike<FunctionReturn<TOutput>>>(
    implementation: TImplementation
  ): (...args: FunctionArgs<TInput>) => Promise<Awaited<ReturnType<TImplementation>>>;
}

/** Describes the JIT codec operators contract used by the public API. */
export interface CodecOperators<TInput extends AnyTypeSchema, TOutput extends AnyTypeSchema> {
  /** Decodes an input-side value into the output-side representation. */
  decode(value: TypeofSchema<TInput>): TypeofSchema<TOutput>;
  /** Encodes an output-side value into the input-side representation. */
  encode(value: TypeofSchema<TOutput>): TypeofSchema<TInput>;
}

/**
 * String constraints and normalizations available after `JIT.string()`.
 *
 * Check methods append a declarative constraint to the schema. Normalizations
 * such as `trim()` change the parsed output, while format methods only reject
 * values that do not match their format. The returned builder retains the
 * accumulated check information for `JIT.Typeof` and AOT generation.
 */
export interface StringCheckMethods<TSchema extends AnyTypeSchema> {
  /**
   * Requires at least `length` UTF-16 code units; `message` customizes the issue
   * message without changing its machine-readable code.
   *
   * @example
   * ```ts
   * const parseUsername = JIT.validate.parse(JIT.string().min(3));
   * parseUsername("ada"); // "ada"
   * ```
   */
  min<const TLength extends number>(
    length: TLength,
    message?: string
  ): Builder<AppendStringCheck<TSchema, SchemaCheck<"min", TLength>>>;
  /** Requires at most `length` UTF-16 code units. */
  max<const TLength extends number>(
    length: TLength,
    message?: string
  ): Builder<AppendStringCheck<TSchema, SchemaCheck<"max", TLength>>>;
  /** Requires exactly `length` UTF-16 code units. */
  length<const TLength extends number>(
    length: TLength,
    message?: string
  ): Builder<AppendStringCheck<TSchema, SchemaCheck<"length", TLength>>>;
  /** Accepts only one of the supplied literal strings. */
  oneOf<const TValues extends readonly [string, ...string[]]>(
    values: TValues,
    message?: string
  ): Builder<AppendStringCheck<TSchema, SchemaCheck<"oneOf", TValues>>>;
  /** Requires the string to begin with `prefix`. */
  startsWith<const TPrefix extends string>(
    prefix: TPrefix,
    message?: string
  ): Builder<AppendStringCheck<TSchema, SchemaCheck<"startsWith", TPrefix>>>;
  /** Requires the string to end with `suffix`. */
  endsWith<const TSuffix extends string>(
    suffix: TSuffix,
    message?: string
  ): Builder<AppendStringCheck<TSchema, SchemaCheck<"endsWith", TSuffix>>>;
  /** Requires the string to contain `needle`. */
  includes<const TNeedle extends string>(
    needle: TNeedle,
    message?: string
  ): Builder<AppendStringCheck<TSchema, SchemaCheck<"includes", TNeedle>>>;
  /** Requires a match for `pattern`; the regular expression remains a runtime binding. */
  regex(pattern: RegExp, message?: string): Builder<TSchema>;
  /**
   * Requires an email-shaped string. Pass a `RegExp` to override the default
   * pattern, or a string as the custom issue message.
   *
   * @example `JIT.string().email("Use a work email")`
   */
  email(
    this: HasStringCheck<TSchema, "email"> extends true ? never : StringCheckMethods<TSchema>,
    patternOrMessageOrOptions?: RegExp | string | { readonly pattern?: RegExp; readonly message?: string },
    message?: string
  ): Builder<AppendStringCheck<TSchema, SchemaCheck<"email", RegExp>>>;
  /** RFC 9562/4122 UUID; pass a version (1-8) to pin the accepted variant. */
  uuid(message?: string): Builder<TSchema>;
  /** Requires a UUID of the selected version. */
  uuid(version: number, message?: string): Builder<TSchema>;
  /** Requires a UUID using the supplied version and message options. */
  uuid(options: { readonly version?: number; readonly message?: string }): Builder<TSchema>;
  /** Requires a URL with any supported protocol. */
  url(message?: string): Builder<TSchema>;
  /** Requires an HTTP or HTTPS URL. */
  httpUrl(message?: string): Builder<TSchema>;
  /** Requires a compact JSON Web Token. */
  jwt(message?: string): Builder<TSchema>;
  /** Registers a named regular-expression format for diagnostics and JSON Schema output. */
  stringFormat(name: string, pattern: RegExp, message?: string): Builder<TSchema>;
  /** Rejects the empty string. */
  noEmpty(): Builder<AppendStringCheck<TSchema, SchemaCheck<"noEmpty">>>;
  /** Trims leading and trailing whitespace from parsed output. */
  trim(): Builder<TSchema>;
  /** Normalizes parsed output using the selected Unicode normalization form. */
  normalize(form?: StringNormalizationForm): Builder<TSchema>;
  /** Requires lowercase input without changing it. */
  lowercase(): Builder<TSchema>;
  /** Alias for `lowercase()`. */
  toLowerCase(): Builder<TSchema>;
  /** Requires uppercase input without changing it. */
  uppercase(): Builder<TSchema>;
  /** Alias for `uppercase()`. */
  toUpperCase(): Builder<TSchema>;
  /** Cleans strings through a source-emitted policy in parse and `JIT.security.sanitize`. */
  sanitize(options?: StringSanitizePreset | StringSanitizeSpec): Builder<TSchema>;
  /** Requires a GUID/UUID-shaped identifier. */
  guid(message?: string): Builder<TSchema>;
  /** Requires a CUID v1 identifier. */
  cuid(message?: string): Builder<TSchema>;
  /** Requires a CUID2 identifier. */
  cuid2(message?: string): Builder<TSchema>;
  /** Requires a ULID identifier. */
  ulid(message?: string): Builder<TSchema>;
  /** Requires a lowercase hexadecimal XID identifier. */
  xid(message?: string): Builder<TSchema>;
  /** Requires a KSUID identifier. */
  ksuid(message?: string): Builder<TSchema>;
  /** Requires a Nano ID identifier. */
  nanoid(message?: string): Builder<TSchema>;
  /** Requires an ISO 8601 duration. */
  duration(message?: string): Builder<TSchema>;
  /** Requires an emoji sequence. */
  emoji(message?: string): Builder<TSchema>;
  /** Requires an IPv4 address. */
  ipv4(message?: string): Builder<TSchema>;
  /** Requires an IPv6 address. */
  ipv6(message?: string): Builder<TSchema>;
  /** Requires an IPv4 CIDR range. */
  cidrv4(message?: string): Builder<TSchema>;
  /** Requires an IPv6 CIDR range. */
  cidrv6(message?: string): Builder<TSchema>;
  /** Requires standard Base64 text. */
  base64(message?: string): Builder<TSchema>;
  /** Requires URL-safe Base64 text. */
  base64url(message?: string): Builder<TSchema>;
  /** Requires a DNS hostname. */
  hostname(message?: string): Builder<TSchema>;
  /** Requires a DNS domain name. */
  domain(message?: string): Builder<TSchema>;
  /** Requires an E.164 phone number. */
  e164(message?: string): Builder<TSchema>;
  /** Requires hexadecimal text. */
  hex(message?: string): Builder<TSchema>;
  /** Requires an ISO calendar date string. */
  date(message?: string): Builder<TSchema>;
  /** The delimiter takes the first position, so a message goes second. */
  mac(delimiter?: string, message?: string): Builder<TSchema>;
  /** Requires an ISO time string; options can control seconds, offset and precision. */
  time(optionsOrMessage?: Regexes.TimeOptions | string, message?: string): Builder<TSchema>;
  /** Requires an ISO date-time string; options can control offset and precision. */
  datetime(optionsOrMessage?: Regexes.DatetimeOptions | string, message?: string): Builder<TSchema>;
  /** Hash digest format, e.g. `.digest("sha256", "base64url")`. */
  digest(
    algorithm: Regexes.HashAlgorithm,
    encodingOrMessage?: Regexes.HashEncoding | (string & {}),
    message?: string
  ): Builder<TSchema>;
  /**
   * Formats parsed strings through a `#` mask. By default non-digits are
   * stripped first, so `.format("###.###.###-##")` accepts raw CPF digits.
   */
  format<const TPattern extends string>(
    pattern: TPattern & ValidFormatPattern<TPattern>,
    optionsOrMessage?:
      | {
          readonly mode?: StringMaskMode;
          readonly stripNonDigits?: boolean;
        }
      | string,
    message?: string
  ): Builder<AppendStringCheck<TSchema, SchemaCheck<"format", StringMaskSpec>>>;
  /** Requires a valid Brazilian CPF. */
  cpf(message?: string): Builder<TSchema>;
  /** Requires a valid Brazilian CNPJ. */
  cnpj(message?: string): Builder<TSchema>;
  /** Requires a Brazilian phone number. */
  phoneBR(message?: string): Builder<TSchema>;
}

/** Numeric constraint methods; every call returns the same builder type. */
export interface NumberCheckMethods<TSchema extends AnyTypeSchema> {
  /** Requires a value greater than or equal to `value`. */
  min<const TValue extends number>(
    value: TValue,
    message?: string
  ): Builder<AppendNumberCheck<TSchema, SchemaCheck<"min", TValue>>>;
  /** Requires a value less than or equal to `value`. */
  max<const TValue extends number>(
    value: TValue,
    message?: string
  ): Builder<AppendNumberCheck<TSchema, SchemaCheck<"max", TValue>>>;
  /** Alias for the inclusive lower bound `min()`. */
  gte<const TValue extends number>(
    value: TValue,
    message?: string
  ): Builder<AppendNumberCheck<TSchema, SchemaCheck<"min", TValue>>>;
  /** Alias for the inclusive upper bound `max()`. */
  lte<const TValue extends number>(
    value: TValue,
    message?: string
  ): Builder<AppendNumberCheck<TSchema, SchemaCheck<"max", TValue>>>;
  /** Requires a value strictly greater than `value`. */
  moreThan<const TValue extends number>(
    value: TValue,
    message?: string
  ): Builder<AppendNumberCheck<TSchema, SchemaCheck<"moreThan", TValue>>>;
  /** Requires a value strictly less than `value`. */
  lessThan<const TValue extends number>(
    value: TValue,
    message?: string
  ): Builder<AppendNumberCheck<TSchema, SchemaCheck<"lessThan", TValue>>>;
  /** Alias for the exclusive lower bound `moreThan()`. */
  gt<const TValue extends number>(
    value: TValue,
    message?: string
  ): Builder<AppendNumberCheck<TSchema, SchemaCheck<"moreThan", TValue>>>;
  /** Alias for the exclusive upper bound `lessThan()`. */
  lt<const TValue extends number>(
    value: TValue,
    message?: string
  ): Builder<AppendNumberCheck<TSchema, SchemaCheck<"lessThan", TValue>>>;
  /** Accepts only one of the supplied numeric literals. */
  oneOf<const TValues extends readonly [number, ...number[]]>(
    values: TValues,
    message?: string
  ): Builder<AppendNumberCheck<TSchema, SchemaCheck<"oneOf", TValues>>>;
  /** Requires a value greater than zero. */
  positive(message?: string): Builder<AppendNumberCheck<TSchema, SchemaCheck<"positive">>>;
  /** Requires a value less than zero. */
  negative(message?: string): Builder<AppendNumberCheck<TSchema, SchemaCheck<"negative">>>;
  /** Requires a value greater than or equal to zero. */
  nonnegative(message?: string): Builder<AppendNumberCheck<TSchema, SchemaCheck<"min", 0>>>;
  /** Requires a value less than or equal to zero. */
  nonpositive(message?: string): Builder<AppendNumberCheck<TSchema, SchemaCheck<"max", 0>>>;
  /** Requires an exact multiple of `value`. */
  multipleOf(value: number, message?: string): Builder<TSchema>;
  /** Alias for `multipleOf()` for numeric step constraints. */
  step(value: number, message?: string): Builder<TSchema>;
  /** Rejects `NaN`, positive infinity and negative infinity. */
  finite(message?: string): Builder<TSchema>;
  /** Requires a JavaScript safe integer range value. */
  safe(message?: string): Builder<TSchema>;
  /** Requires an integer. */
  int(message?: string): Builder<AppendNumberCheck<TSchema, SchemaCheck<"integer">>>;
  /** Requires a signed 32-bit integer. */
  int32(message?: string): Builder<AppendNumberCheck<TSchema, SchemaCheck<"int32">>>;
  /** Requires a 32-bit floating-point-compatible value. */
  float32(message?: string): Builder<AppendNumberCheck<TSchema, SchemaCheck<"float32">>>;
  /** Requires a finite IEEE-754 double-compatible value. */
  float64(message?: string): Builder<AppendNumberCheck<TSchema, SchemaCheck<"float64">>>;
}

/** Array length constraint methods; every call returns the same builder type. */
export interface ArrayCheckMethods<TSchema extends AnyTypeSchema> {
  /** Requires at least `length` elements. */
  min(length: number, message?: string): Builder<TSchema>;
  /** Requires at most `length` elements. */
  max(length: number, message?: string): Builder<TSchema>;
  /** Requires exactly `length` elements. */
  length(length: number, message?: string): Builder<TSchema>;
  /** Rejects an empty array. */
  nonEmpty(message?: string): Builder<TSchema>;
  /**
   * Compiles this array of objects into an in-memory binary rowset loader.
   * The returned loader keeps rows in a compact ArrayBuffer and lets binary
   * queries scan typed bytes instead of allocating intermediate JS objects.
   */
  binary(
    options?: BinaryRowSetOptions
  ): TSchema extends { readonly type: "array" }
    ? BinaryArray<TypeofSchema<TSchema> extends (infer TElement)[] ? TElement : never>
    : never;
}

/** Describes the JIT date like check methods contract used by the public API. */
export interface DateLikeCheckMethods<TSchema extends AnyTypeSchema> {
  /** Requires a date-like value at or after `value`. */
  min(value: Date | string, message?: string): Builder<AppendDateLikeCheck<TSchema, SchemaCheck<"min", Date | string>>>;
  /** Requires a date-like value at or before `value`. */
  max(value: Date | string, message?: string): Builder<AppendDateLikeCheck<TSchema, SchemaCheck<"max", Date | string>>>;
  /** Requires a date-like value inside the inclusive `[min, max]` range. */
  between(
    min: Date | string,
    max: Date | string,
    message?: string
  ): Builder<
    AppendDateLikeCheck<TSchema, SchemaCheck<"between", { readonly min: Date | string; readonly max: Date | string }>>
  >;
  /** Requires a date-like value whose weekday is in `days` (`0` is Sunday). */
  daysOfWeek(
    days: readonly number[],
    message?: string
  ): Builder<AppendDateLikeCheck<TSchema, SchemaCheck<"daysOfWeek", readonly number[]>>>;
  /** Requires a date-like value whose month is in `months` (`1` is January). */
  monthsOfYear(
    months: readonly number[],
    message?: string
  ): Builder<AppendDateLikeCheck<TSchema, SchemaCheck<"monthsOfYear", readonly number[]>>>;
  /** Requires the value to equal its truncation to `unit`. */
  truncateTo(
    unit: TemporalUnit,
    message?: string
  ): Builder<AppendDateLikeCheck<TSchema, SchemaCheck<"truncateTo", TemporalUnit>>>;
}

type CheckMethods<TSchema extends AnyTypeSchema> = TSchema extends {
  readonly type: "string";
}
  ? StringCheckMethods<TSchema>
  : TSchema extends { readonly type: "number" | "int" }
    ? NumberCheckMethods<TSchema>
    : TSchema extends { readonly type: "array" }
      ? ArrayCheckMethods<TSchema>
      : TSchema extends { readonly type: "date" | "temporal" }
        ? DateLikeCheckMethods<TSchema>
        : unknown;

/** Describes the JIT object builder contract used by the public API. */
export type ObjectBuilder<
  TShape extends SchemaShape,
  TUnknownKeys extends ObjectUnknownKeys = undefined,
  TCatchall extends AnyTypeSchema | undefined = undefined,
> = Omit<BuilderCore<ObjectSchema<TShape, TUnknownKeys, TCatchall>>, "required"> &
  ObjectOperators<TShape, TUnknownKeys, TCatchall>;

/** Describes the JIT function builder contract used by the public API. */
export type FunctionBuilder<
  TInput extends readonly AnyTypeSchema[],
  TOutput extends AnyTypeSchema | undefined = AnyTypeSchema | undefined,
> = BuilderCore<FunctionSchema<TInput, TOutput>> & FunctionOperators<TInput, TOutput>;

/** Describes the JIT codec builder contract used by the public API. */
export type CodecBuilder<TInput extends AnyTypeSchema, TOutput extends AnyTypeSchema> = BuilderCore<
  CodecSchema<TInput, TOutput>
> &
  CodecOperators<TInput, TOutput>;

/** Describes the JIT builder contract used by the public API. */
export type Builder<TSchema extends AnyTypeSchema> =
  TSchema extends ObjectSchema<infer TShape, infer TUnknownKeys, infer TCatchall>
    ? ObjectBuilder<TShape, TUnknownKeys, TCatchall>
    : TSchema extends FunctionSchema<infer TInput, infer TOutput>
      ? FunctionBuilder<TInput, TOutput>
      : TSchema extends CodecSchema<infer TInput, infer TOutput>
        ? CodecBuilder<TInput, TOutput>
        : BaseBuilder<TSchema> & CheckMethods<TSchema>;

/** Describes the JIT any builder contract used by the public API. */
export type AnyBuilder = Builder<AnyTypeSchema>;
