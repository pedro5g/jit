import {
  type AnyTypeSchema,
  type CustomSchema,
  createSchema,
  type EnumSchema,
  type EnumValuesInput,
  type FunctionInputSchemas,
  type FunctionSchema,
  type InstanceOfSchema,
  type JsonSchema,
  type LazySchema,
  type LiteralSchema,
  type TemplateLiteralInputPart,
  type TemplateLiteralSchema,
  type TemporalKind,
  type TemporalSchema,
  type TupleSchema,
  TypeName,
} from "../../core/ats/index.js";
import type { Builder } from "../../core/builder/index.js";
import { createBuilder, type SchemaInput, unwrapSchema } from "../../core/builder/index.js";
import { type ValidationMessage, withValidationMessage } from "../validation-message.js";

/**
 * Creates a literal schema builder.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Ready = JIT.literal("ready");
 * JIT.validate.is(Ready)("ready"); // true
 * ```
 *
 * @template TValue - The literal value type.
 * @param value - The literal runtime value.
 * @returns A builder wrapping a literal schema.
 */
export function literal<const TValue>(value: TValue, message?: ValidationMessage): Builder<LiteralSchema<TValue>> {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.literal, withValidationMessage({ value }, message)));
}

/**
 * Creates an enum schema builder from a native enum-like object.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Status = JIT.enum({ Draft: "draft", Published: "published" });
 * JIT.validate.is(Status)("draft"); // true
 * ```
 *
 * @template TValues - The enum object type.
 * @param values - An object whose values are strings or numbers.
 * @returns A builder wrapping an enum schema.
 */
function nativeEnum<const TValues extends EnumValuesInput>(
  values: TValues,
  message?: ValidationMessage
): Builder<EnumSchema<TValues>> {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.enum, withValidationMessage({ values }, message)));
}

/**
 * Creates an enum schema from a string/number-valued object.
 *
 * @example
 * ```ts
 * const Status = JIT.enum({ Draft: "draft", Published: "published" });
 * ```
 */
export { nativeEnum as enum };

/**
 * Creates a lazy schema builder.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Numbers = JIT.lazy(() => JIT.array(JIT.number()));
 * JIT.validate.is(Numbers)([1, 2]); // true
 * ```
 *
 * @template TSchema - The schema returned by the lazy getter.
 * @param getter - A callback that returns the schema or builder when resolved.
 * @returns A builder wrapping a lazy schema.
 */
export function lazy<TSchema extends AnyTypeSchema>(getter: () => SchemaInput<TSchema>): Builder<LazySchema<TSchema>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.lazy, {
      getter: () => unwrapSchema(getter()),
    })
  );
}

/**
 * Creates an instanceof schema builder.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const ErrorValue = JIT.instanceOf(Error);
 * JIT.validate.is(ErrorValue)(new Error("failed")); // true
 * ```
 *
 * @template TCtor - The constructor used for runtime instanceof checks.
 * @param ctor - The constructor accepted by the schema.
 * @returns A builder wrapping an instanceof schema.
 */
export function instanceOf<TCtor extends abstract new (...args: any[]) => unknown>(
  ctor: TCtor,
  message?: ValidationMessage
): Builder<InstanceOfSchema<TCtor>> {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.instanceof, withValidationMessage({ ctor }, message)));
}

/**
 * Creates a schema that accepts JSON-encodable values. Kept under `JIT.json.value()`.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Json = JIT.json.value();
 * JIT.validate.is(Json)({ ok: true, count: 2 }); // true
 * ```
 */
export function jsonValue(message?: ValidationMessage): Builder<JsonSchema> {
  return /* @__PURE__ */ createBuilder(createSchema(TypeName.json, withValidationMessage({}, message)));
}

/**
 * Creates a custom schema backed by an external predicate. Omitting the
 * predicate intentionally accepts any value while preserving `TOutput`.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Port = JIT.custom((value): value is number => typeof value === "number" && value > 0);
 * JIT.validate.is(Port)(8080); // true
 * ```
 */
export function custom<TOutput = unknown>(
  predicate?: ((value: unknown) => value is TOutput) | ((value: unknown) => boolean),
  message?: string
): Builder<CustomSchema<TOutput>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.custom, {
      predicate,
      message,
    })
  );
}

/**
 * A literal or schema component accepted by `JIT.templateLiterals()`.
 *
 * @example
 * ```ts
 * const Path = JIT.templateLiterals(["/users/", JIT.int()]);
 * ```
 */
export type TemplateLiteralFactoryPart = string | SchemaInput;

/**
 * Creates a template-literal string schema from literal and schema parts.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const UserPath = JIT.templateLiterals(["/users/", JIT.int()]);
 * JIT.validate.is(UserPath)("/users/42"); // true
 * ```
 */
export function templateLiteral<const TParts extends readonly TemplateLiteralFactoryPart[]>(
  parts: TParts,
  message?: ValidationMessage
): Builder<TemplateLiteralSchema<TParts>> {
  const normalized = parts.map((part) => (typeof part === "string" ? part : unwrapSchema(part))) as unknown as TParts;

  return /* @__PURE__ */ createBuilder(
    createSchema(
      TypeName.templateLiteral,
      withValidationMessage({ parts: normalized as readonly TemplateLiteralInputPart[] }, message)
    ) as TemplateLiteralSchema<TParts>
  );
}

/**
 * Options for a function schema's argument and return-value boundaries.
 *
 * @example
 * ```ts
 * const NumberSchema = JIT.number();
 * const StringSchema = JIT.string();
 * const options: FunctionSchemaOptions<[typeof NumberSchema], typeof StringSchema> = {
 *   input: [JIT.number()],
 *   output: JIT.string(),
 * };
 * ```
 */
export interface FunctionSchemaOptions<
  TInput extends readonly SchemaInput[],
  TOutput extends SchemaInput | undefined = undefined,
> {
  readonly input: TInput;
  readonly output?: TOutput;
  readonly message?: string;
}

type UnwrapFunctionInputs<TInput extends readonly SchemaInput[]> = {
  readonly [TKey in keyof TInput]: TInput[TKey] extends SchemaInput<infer TSchema> ? TSchema : never;
} extends infer TInputs extends FunctionInputSchemas
  ? TInputs
  : never;

type UnwrapFunctionOutput<TOutput extends SchemaInput | undefined> =
  TOutput extends SchemaInput<infer TSchema> ? TSchema : undefined;

/**
 * Creates a function schema with input/output validation wrappers.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Add = JIT.function({ input: [JIT.number(), JIT.number()], output: JIT.number() });
 * const isAdd = JIT.validate.is(Add);
 * isAdd((left: number, right: number) => left + right); // true
 * ```
 */
function functionSchema<
  const TInput extends readonly SchemaInput[],
  TOutput extends SchemaInput | undefined = undefined,
>(
  options: FunctionSchemaOptions<TInput, TOutput>
): Builder<FunctionSchema<UnwrapFunctionInputs<TInput>, UnwrapFunctionOutput<TOutput>>> {
  const input = options.input.map((item) => unwrapSchema(item)) as unknown as UnwrapFunctionInputs<TInput>;
  const output = (
    options.output === undefined ? undefined : unwrapSchema(options.output)
  ) as UnwrapFunctionOutput<TOutput>;
  const args = createSchema(TypeName.tuple, {
    items: input,
    rest: undefined,
  }) as TupleSchema<UnwrapFunctionInputs<TInput>>;

  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.function, withValidationMessage({ input, output, args }, options.message)) as FunctionSchema<
      UnwrapFunctionInputs<TInput>,
      UnwrapFunctionOutput<TOutput>
    >
  );
}

/**
 * Creates function schemas with argument and return boundaries; the same
 * module also exposes `templateLiterals` as the plural alias of
 * `templateLiteral`.
 *
 * @example
 * ```ts
 * const Add = JIT.function({ input: [JIT.number(), JIT.number()], output: JIT.number() });
 * const Path = JIT.templateLiterals(["/users/", JIT.int()]);
 * ```
 */
export { functionSchema as function, templateLiteral as templateLiterals };

function temporalSchema<TKind extends TemporalKind>(kind: TKind): Builder<TemporalSchema<TKind, []>> {
  return /* @__PURE__ */ createBuilder(
    createSchema(TypeName.temporal, {
      kind,
    }) as TemporalSchema<TKind, []>
  );
}

/**
 * Temporal schema factories for native Temporal values.
 *
 * @example
 * ```ts
 * const Instant = JIT.temporal.instant();
 * JIT.validate.is(Instant)(Temporal.Instant.from("2024-01-01T00:00:00Z"));
 * ```
 */
export interface TemporalFactories {
  /** Builds an instant schema. */
  instant(): Builder<TemporalSchema<"instant", []>>;
  /** Builds a calendar date schema without a time zone. */
  plainDate(): Builder<TemporalSchema<"plainDate", []>>;
  /** Builds a wall-clock time schema without a date. */
  plainTime(): Builder<TemporalSchema<"plainTime", []>>;
  /** Builds a local date-time schema without a time zone. */
  plainDateTime(): Builder<TemporalSchema<"plainDateTime", []>>;
  /** Builds a date-time schema with a time zone. */
  zonedDateTime(): Builder<TemporalSchema<"zonedDateTime", []>>;
  /** Builds a year-and-month schema. */
  plainYearMonth(): Builder<TemporalSchema<"plainYearMonth", []>>;
  /** Builds a month-and-day schema. */
  plainMonthDay(): Builder<TemporalSchema<"plainMonthDay", []>>;
  /** Builds a duration schema. */
  duration(): Builder<TemporalSchema<"duration", []>>;
}

/**
 * Temporal schema factories for native Temporal values.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Instant = JIT.temporal.instant();
 * JIT.validate.is(Instant)(Temporal.Instant.from("2024-01-01T00:00:00Z")); // true
 * ```
 */
export const temporal: TemporalFactories = {
  instant: () => temporalSchema("instant"),
  plainDate: () => temporalSchema("plainDate"),
  plainTime: () => temporalSchema("plainTime"),
  plainDateTime: () => temporalSchema("plainDateTime"),
  zonedDateTime: () => temporalSchema("zonedDateTime"),
  plainYearMonth: () => temporalSchema("plainYearMonth"),
  plainMonthDay: () => temporalSchema("plainMonthDay"),
  duration: () => temporalSchema("duration"),
};
