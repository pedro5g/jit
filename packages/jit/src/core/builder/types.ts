import type { Regexes } from "../../shared/index.js";
import type {
  AnyTypeSchema,
  BrandSchema,
  CoerceSchema,
  DefaultSchema,
  InferSchema,
  MergeShape,
  NullableSchema,
  NullishSchema,
  ObjectSchema,
  OmitShape,
  OptionalSchema,
  PartialShape,
  PickShape,
  PipeSchema,
  PromiseSchema,
  ReadonlySchema,
  RefineSchema,
  RequiredShape,
  SchemaShape,
  TransformSchema,
  TransformSpec,
} from "../ats/index.js";
import type { EntityHint, HashStrategy, OrderDirection, PropertySelector } from "../hints/index.js";
import type { SchemaInput } from "./unwrap-schema.js";

export interface BuilderCore<TSchema extends AnyTypeSchema> {
  readonly schema: TSchema;
  optional(): Builder<OptionalSchema<TSchema>>;
  nullable(): Builder<NullableSchema<TSchema>>;
  nullish(): Builder<NullishSchema<TSchema>>;
  readonly(): Builder<ReadonlySchema<TSchema>>;
  promise(): Builder<PromiseSchema<TSchema>>;
  default(defaultValue: InferSchema<TSchema> | (() => InferSchema<TSchema>)): Builder<DefaultSchema<TSchema>>;
  brand<const TBrand extends string>(brandName: TBrand): Builder<BrandSchema<TSchema, TBrand>>;
  pipe<TOutput>(transform: (value: InferSchema<TSchema>) => TOutput): Builder<PipeSchema<TSchema, TOutput>>;
  refine(predicate: (value: InferSchema<TSchema>) => boolean, message?: string): Builder<RefineSchema<TSchema>>;
  coerce(coercer: (value: unknown) => InferSchema<TSchema>): Builder<CoerceSchema<TSchema>>;
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

export interface ObjectOperators<TShape extends SchemaShape> {
  partial(): ObjectBuilder<PartialShape<TShape>>;
  required(): ObjectBuilder<RequiredShape<TShape>>;
  transform<const TSpec extends TransformSpec<InferSchema<ObjectSchema<TShape>>>>(
    transforms: TSpec
  ): Builder<TransformSchema<ObjectSchema<TShape>, TSpec>>;
  pick<const TKeys extends readonly (keyof TShape)[]>(keys: TKeys): ObjectBuilder<PickShape<TShape, TKeys[number]>>;
  omit<const TKeys extends readonly (keyof TShape)[]>(keys: TKeys): ObjectBuilder<OmitShape<TShape, TKeys[number]>>;
  extend<const TExtension extends Record<string, SchemaInput>>(
    extension: TExtension
  ): ObjectBuilder<MergeShape<TShape, UnwrapBuilderShape<TExtension>>>;
  merge<TRight extends SchemaShape>(
    right: ObjectBuilder<TRight> | ObjectSchema<TRight>
  ): ObjectBuilder<MergeShape<TShape, TRight>>;
}

export type UnwrapBuilderShape<TShape extends Record<string, SchemaInput>> = {
  readonly [TKey in keyof TShape]: TShape[TKey] extends SchemaInput<infer TSchema extends AnyTypeSchema>
    ? TSchema
    : never;
};

export type BaseBuilder<TSchema extends AnyTypeSchema> = BuilderCore<TSchema>;

/** String constraint methods; every call returns the same builder type. */
export interface StringCheckMethods<TSchema extends AnyTypeSchema> {
  min(length: number, message?: string): Builder<TSchema>;
  max(length: number, message?: string): Builder<TSchema>;
  length(length: number, message?: string): Builder<TSchema>;
  regex(pattern: RegExp, message?: string): Builder<TSchema>;
  /** Email format; pass a RegExp to override the default pattern (e.g. `JIT.regexes.rfc5322Email`). */
  email(message?: string): Builder<TSchema>;
  email(pattern: RegExp, message?: string): Builder<TSchema>;
  /** RFC 9562/4122 UUID; pass a version (1-8) to pin it. */
  uuid(message?: string): Builder<TSchema>;
  uuid(version: number, message?: string): Builder<TSchema>;
  url(message?: string): Builder<TSchema>;
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
}

/** Numeric constraint methods; every call returns the same builder type. */
export interface NumberCheckMethods<TSchema extends AnyTypeSchema> {
  min(value: number, message?: string): Builder<TSchema>;
  max(value: number, message?: string): Builder<TSchema>;
  positive(message?: string): Builder<TSchema>;
  negative(message?: string): Builder<TSchema>;
  multipleOf(value: number, message?: string): Builder<TSchema>;
  finite(message?: string): Builder<TSchema>;
  safe(message?: string): Builder<TSchema>;
  int(message?: string): Builder<TSchema>;
}

/** Array length constraint methods; every call returns the same builder type. */
export interface ArrayCheckMethods<TSchema extends AnyTypeSchema> {
  min(length: number, message?: string): Builder<TSchema>;
  max(length: number, message?: string): Builder<TSchema>;
  length(length: number, message?: string): Builder<TSchema>;
  nonEmpty(message?: string): Builder<TSchema>;
}

type CheckMethods<TSchema extends AnyTypeSchema> = TSchema extends { readonly type: "string" }
  ? StringCheckMethods<TSchema>
  : TSchema extends { readonly type: "number" | "int" }
    ? NumberCheckMethods<TSchema>
    : TSchema extends { readonly type: "array" }
      ? ArrayCheckMethods<TSchema>
      : unknown;

export type ObjectBuilder<TShape extends SchemaShape> = BuilderCore<ObjectSchema<TShape>> & ObjectOperators<TShape>;

export type Builder<TSchema extends AnyTypeSchema> =
  TSchema extends ObjectSchema<infer TShape> ? ObjectBuilder<TShape> : BaseBuilder<TSchema> & CheckMethods<TSchema>;

export type AnyBuilder = Builder<AnyTypeSchema>;
