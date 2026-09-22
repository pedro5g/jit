import { allFieldPaths, compileChanged, resolveChangedDescriptor } from "../compiler/changed.js";
import { type Clone, compileClone } from "../compiler/clone.js";
import { type CodecCompileOptions, type CompiledCodec, compileCodec } from "../compiler/codec.js";
import { compileDiff, type Diff } from "../compiler/diff.js";
import { compileEqual, type Equal } from "../compiler/equal.js";
import { compileFormat, type Format } from "../compiler/format.js";
import { compileHash, type Hash } from "../compiler/hash.js";
import { compileStringifyChunks, type JsonChunksOptions } from "../compiler/json-chunks.js";
import type { MapperOverridesInput } from "../compiler/mapper/build-mapper-plan.js";
import { compileMask, type Mask } from "../compiler/mask.js";
import { compileMock, type Mock } from "../compiler/mock.js";
import { buildProjectionTree } from "../compiler/projection.js";
import { compileSanitize, type Sanitize } from "../compiler/sanitize.js";
import type { SafeParseResult } from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import type { Builder, SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import type { ValidationIssue } from "../errors/index.js";
import type { RuntimeClass } from "./class.js";
import {
  binaryDecode,
  binaryEncode,
  type CallableArtifact,
  type CollectionArtifact,
  createExecutionArtifact,
  type ExecutionArtifact,
  from,
  jsonParse,
  jsonStringify,
  mappedValue,
  operationArtifact,
  type SchemaArtifact,
  validationArtifact,
} from "./execution.js";
import type { MapperArgs } from "./mapper.js";
import { jsonValue } from "./special/special.js";
import type { ValidationMessage } from "./validation-message.js";

export type {
  CallableArtifact,
  CollectionArtifact,
  ExecutionArtifact,
  SchemaArtifact,
  ValueArtifact,
} from "./execution.js";
export { from } from "./execution.js";

/**
 * A direct callable artifact; `.compile()` is only an optional warm-up hook.
 *
 * @example
 * ```ts
 * const parse: JIT.RuntimeCompiledFunction<(value: unknown) => User> = JIT.validate.parse(User);
 * parse({ id: 1 });
 * ```
 */
export type RuntimeCompiledFunction<TFunction extends (...args: never[]) => unknown> = CallableArtifact<TFunction>;

/**
 * Async validation, for schemas that contain promises or async refinements.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Result = JIT.promise(JIT.number());
 * const parseResult = JIT.validate.async.parse(Result);
 * await parseResult(Promise.resolve(200));
 * ```
 */
export interface AsyncValidateNamespace {
  /** Compiles asynchronous validation that resolves with the parsed value. */
  parse<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: ValidationDiagnosticOptions
  ): ExecutionArtifact<unknown, Promise<ATS.TypeofSchema<TSchema>>>;
  /** Compiles asynchronous validation that resolves with success or issues. */
  safeParse<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: ValidationDiagnosticOptions
  ): ExecutionArtifact<unknown, Promise<SafeParseResult<ATS.TypeofSchema<TSchema>>>>;
}

/**
 * Validation capability. The unprefixed members are synchronous — the common
 * path — and `async` holds the awaited pair, so a call site never has to read
 * a suffix to know which one it is running.
 *
 * Only parser artifacts implement Standard Schema. Boolean guards and
 * SafeParse artifacts preserve their native callable contracts because their
 * outputs are not `unknown -> validated value`.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const User = JIT.object({ id: JIT.int() });
 * const result = JIT.validate.safeParse(User)({ id: "wrong" });
 * if (!result.success) result.issues;
 * ```
 */
export interface ValidateNamespace {
  /** Compiles a boolean type guard for the schema. */
  is<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): CallableArtifact<(value: unknown) => value is ATS.TypeofSchema<TSchema>>;
  /** Compiles parsing for a schema or Runtime Class. */
  parse<TSchema extends ATS.AnyTypeSchema, TInstance>(
    schema: RuntimeClass<TSchema, TInstance>,
    options?: ValidationDiagnosticOptions
  ): ExecutionArtifact<unknown, TInstance>;
  /** Parses a schema input and returns its validated value. */
  parse<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: ValidationDiagnosticOptions
  ): SchemaArtifact<unknown, TSchema>;
  /** Compiles diagnostic validation for a schema or Runtime Class. */
  safeParse<TSchema extends ATS.AnyTypeSchema, TInstance>(
    schema: RuntimeClass<TSchema, TInstance>,
    options?: ValidationDiagnosticOptions
  ): CallableArtifact<(value: unknown) => SafeParseResult<TInstance>>;
  /** Validates a schema input and returns issues without throwing. */
  safeParse<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: ValidationDiagnosticOptions
  ): CallableArtifact<(value: unknown) => SafeParseResult<ATS.TypeofSchema<TSchema>>>;
  /** Compiles an iterator that yields every validation issue for a value. */
  issues<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): ExecutionArtifact<unknown, IterableIterator<ValidationIssue>>;
  readonly async: AsyncValidateNamespace;
}

/**
 * Limits how many independent issues diagnostic validation collects.
 *
 * @example
 * ```ts
 * const parse = JIT.validate.safeParse(User, { maxIssues: 3 });
 * ```
 */
export interface ValidationDiagnosticOptions {
  readonly maxIssues?: number;
}

function parseAsync<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: ValidationDiagnosticOptions
) {
  return validationArtifact(schema, "parseAsync", options) as ExecutionArtifact<
    unknown,
    Promise<ATS.TypeofSchema<TSchema>>
  >;
}

function safeParseAsync<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options?: ValidationDiagnosticOptions
) {
  return validationArtifact(schema, "safeParseAsync", options) as ExecutionArtifact<
    unknown,
    Promise<SafeParseResult<ATS.TypeofSchema<TSchema>>>
  >;
}

/**
 * Capability namespace for validation. It has no compile-selection chain.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const User = JIT.object({ id: JIT.int() });
 * const parseUser = JIT.validate.parse(User);
 * parseUser({ id: 1 });
 * ```
 */
export const validate: ValidateNamespace = Object.freeze({
  is<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationArtifact(schema, "is") as CallableArtifact<(value: unknown) => value is ATS.TypeofSchema<TSchema>>;
  },
  parse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>, options?: ValidationDiagnosticOptions) {
    return validationArtifact(schema, "parse", options) as SchemaArtifact<unknown, TSchema>;
  },
  safeParse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>, options?: ValidationDiagnosticOptions) {
    return validationArtifact(schema, "safeParse", options) as CallableArtifact<
      (value: unknown) => SafeParseResult<ATS.TypeofSchema<TSchema>>
    >;
  },
  issues<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationArtifact(schema, "issues") as ExecutionArtifact<unknown, IterableIterator<ValidationIssue>>;
  },
  async: Object.freeze({
    parse: parseAsync,
    safeParse: safeParseAsync,
  }),
});

/**
 * JSON parsing and serialization operations specialized for one schema.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const User = JIT.object({ id: JIT.int() });
 * const parseUser = JIT.json.parse(User);
 * parseUser('{"id":1}');
 * ```
 *
 * @example
 * ```ts
 * const parse = JIT.json.parse(User);
 * parse('{"id":1}');
 * ```
 */
export interface JsonNamespace {
  /** Returns the recursive schema for JSON-compatible values. */
  value(message?: ValidationMessage): Builder<ATS.JsonSchema>;
  /** Parses JSON text and validates the decoded value against `schema`. */
  parse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): SchemaArtifact<string, TSchema>;
  /** Serializes a validated value to JSON text. */
  stringify<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): ExecutionArtifact<ATS.TypeofSchema<TSchema>, string>;
  /** Serializes a value as deterministic chunks of JSON text. */
  stringifyChunks<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: JsonChunksOptions
  ): ExecutionArtifact<ATS.TypeofSchema<TSchema>, IterableIterator<string>>;
}

/**
 * JSON is a capability namespace; `value()` keeps the JSON-value schema explicit.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const stringifyUser = JIT.json.stringify(JIT.object({ id: JIT.int() }));
 * stringifyUser({ id: 1 }); // '{"id":1}'
 * ```
 */
export const json: JsonNamespace = Object.freeze({
  value: jsonValue,
  parse: jsonParse,
  stringify: jsonStringify,
  stringifyChunks<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>, options?: JsonChunksOptions) {
    const unwrapped = unwrapSchema(schema);
    const base = jsonStringify(unwrapped);
    const last = base.plan.stages[base.plan.stages.length - 1];
    const plan = Object.freeze({
      ...base.plan,
      stages: Object.freeze([
        ...base.plan.stages.slice(0, -1),
        Object.freeze({
          ...last,
          mode: "chunks" as const,
          ...(options?.chunkBytes === undefined ? {} : { chunkBytes: options.chunkBytes }),
        }),
      ]),
    });

    return createExecutionArtifact(plan, () => compileStringifyChunks(unwrapped, options));
  },
});

/**
 * Binary encoding and decoding operations specialized for one schema.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const User = JIT.object({ id: JIT.int() });
 * const codec = JIT.binary.codec(User);
 * const bytes = codec.encode({ id: 1 });
 * codec.decode(bytes); // { id: 1 }
 * ```
 *
 * @example
 * ```ts
 * const codec = JIT.binary.codec(User);
 * codec.decode(codec.encode({ id: 1 }));
 * ```
 */
export interface BinaryNamespace {
  /** Encodes a value into the schema's binary wire representation. */
  encode<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): ExecutionArtifact<ATS.TypeofSchema<TSchema>, Uint8Array>;
  /** Decodes binary input and validates the resulting value against `schema`. */
  decode<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): SchemaArtifact<Uint8Array | ArrayBuffer, TSchema>;
  /** Both directions plus `encodeInto`, sharing one wire version. */
  codec<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: CodecCompileOptions
  ): CompiledCodec<ATS.TypeofSchema<TSchema>>;
}

/**
 * Persisted binary codec capability. Binary rowsets remain under `process`.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const codec = JIT.binary.codec(JIT.string());
 * codec.decode(codec.encode("jit")); // "jit"
 * ```
 */
export const binary: BinaryNamespace = Object.freeze({
  encode: binaryEncode,
  decode: binaryDecode,
  codec<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>, options?: CodecCompileOptions) {
    return compileCodec(unwrapSchema(schema), options) as CompiledCodec<ATS.TypeofSchema<TSchema>>;
  },
});

/** Paths a selection may name: a declared field, or a dotted path into one. */
type SelectablePath<TValue, TDepth extends readonly unknown[] = []> = TDepth["length"] extends 4
  ? never
  : TValue extends readonly unknown[]
    ? never
    : TValue extends Date
      ? never
      : TValue extends object
        ? {
            [K in Extract<keyof TValue, string>]:
              | K
              | (SelectablePath<NonNullable<TValue[K]>, [...TDepth, unknown]> extends infer TNested extends string
                  ? `${K}.${TNested}`
                  : never);
          }[Extract<keyof TValue, string>]
        : never;

/**
 * A schema-aware equality function with optional field selection.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const User = JIT.object({ id: JIT.int(), name: JIT.string() });
 * const sameId = JIT.compare.equal(User).select("id");
 * sameId({ id: 1, name: "Ada" }, { id: 1, name: "Grace" }); // true
 * ```
 */
export interface SelectableEqual<TValue> extends RuntimeCompiledFunction<Equal<TValue>> {
  /**
   * Compares only the named fields. The other fields are not read, not
   * compared and not present in the generated source at all.
   */
  select<const TPaths extends readonly SelectablePath<TValue>[]>(
    ...paths: TPaths
  ): RuntimeCompiledFunction<Equal<TValue>>;
}

function equal<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): SelectableEqual<ATS.TypeofSchema<TSchema>> {
  const artifact = operationArtifact(schema, "equal", "value", "boolean", compileEqual);

  // Operation artifacts are cached per schema, so the same object comes back on
  // every call and `select` is installed exactly once.
  if ("select" in artifact) return artifact as SelectableEqual<ATS.TypeofSchema<TSchema>>;

  // A selection lowers to an ordinary `equal` over the projection's own schema,
  // so it inherits the equality optimizer, the artifact registry and the AOT
  // emitter without any of them learning what a projection is.
  Object.defineProperty(artifact, "select", {
    value: (...paths: string[]) =>
      operationArtifact(
        buildProjectionTree(unwrapSchema(schema), paths, "JIT.compare.equal().select()").schema,
        "equal",
        "value",
        "boolean",
        compileEqual
      ),
  });
  return artifact as SelectableEqual<ATS.TypeofSchema<TSchema>>;
}

/**
 * Which watched fields differ, as a bitmask.
 *
 * `has` is the reason the result is a number: testing one field is a single
 * bitwise `and`, where a `{ field: boolean }` result would have allocated an
 * object per comparison to answer it.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const User = JIT.object({ id: JIT.int(), name: JIT.string() });
 * const changed = JIT.compare.changed(User).select("name");
 * const mask = changed({ id: 1, name: "Ada" }, { id: 1, name: "Grace" });
 * changed.has(mask, "name"); // true
 * ```
 */
export interface ChangedMask<TValue, TPath extends string, TMask> {
  /** Compares two values and returns the watched-field bitmask. */
  (left: TValue, right: TValue): TMask;
  /** Tests whether the bit for `path` is set in a previously computed mask. */
  has(mask: TMask, path: TPath): boolean;
  /** The watched fields in bit order, so a caller can report what moved. */
  readonly fields: readonly TPath[];
}

/**
 * Builder for schema-specialized changed-field masks.
 *
 * @example
 * ```ts
 * const changed = JIT.compare.changed(User).select("name");
 * const mask = changed(userA, userB);
 * changed.has(mask, "name");
 * ```
 */
export interface ChangedBuilder<TValue> extends ChangedMask<TValue, SelectablePath<TValue>, number> {
  /**
   * Watches only the named fields. Bit order follows the order given here.
   */
  select<const TPaths extends readonly SelectablePath<TValue>[]>(
    ...paths: TPaths
  ): ChangedMask<TValue, TPaths[number], number>;
}

function changed<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): ChangedBuilder<ATS.TypeofSchema<TSchema>> {
  const unwrapped = unwrapSchema(schema);
  const plan = createChangedMask(unwrapped, allFieldPaths(unwrapped, "JIT.compare.changed()"));

  Object.defineProperty(plan, "select", {
    value: (...paths: string[]) => createChangedMask(unwrapped, paths),
  });
  return plan as ChangedBuilder<ATS.TypeofSchema<TSchema>>;
}

function createChangedMask(schema: ATS.AnyTypeSchema, paths: readonly string[]) {
  const descriptor = resolveChangedDescriptor(schema, paths);
  const compiled = compileChanged<unknown, number>(schema, descriptor);
  const fields = descriptor.fields.map((field) => field.path);
  // The bit for a path is its position, so `has` is a lookup and one `and`.
  const bits = new Map(fields.map((path, index) => [path, index]));

  Object.defineProperties(compiled, {
    fields: { value: Object.freeze(fields) },
    has: {
      value: (mask: number | bigint, path: string) => {
        const bit = bits.get(path);

        if (bit === undefined) return false;
        return typeof mask === "bigint" ? (mask & (1n << BigInt(bit))) !== 0n : (mask & (1 << bit)) !== 0;
      },
    },
  });
  return compiled as ChangedMask<unknown, string, number>;
}

/**
 * Compiles immutable cloning for a schema.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const User = JIT.object({ id: JIT.int(), tags: JIT.array(JIT.string()) });
 * const cloneUser = JIT.clone(User);
 * const copy = cloneUser({ id: 1, tags: ["jit"] });
 * ```
 */
export function clone<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Clone<ATS.TypeofSchema<TSchema>>> {
  return operationArtifact(schema, "clone", "value", "value", compileClone) as RuntimeCompiledFunction<
    Clone<ATS.TypeofSchema<TSchema>>
  >;
}

function diff<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Diff<ATS.TypeofSchema<TSchema>>> {
  return operationArtifact(schema, "diff", "value", "value", compileDiff) as RuntimeCompiledFunction<
    Diff<ATS.TypeofSchema<TSchema>>
  >;
}

function hash<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Hash<ATS.TypeofSchema<TSchema>>> {
  return operationArtifact(schema, "hash", "value", "value", compileHash) as RuntimeCompiledFunction<
    Hash<ATS.TypeofSchema<TSchema>>
  >;
}

/**
 * Compiles a deterministic sample generator. Values satisfy the same checks
 * the validator enforces, so fixtures cannot drift from the schema.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const User = JIT.object({ id: JIT.int(), name: JIT.string() });
 * const sample = JIT.mock(User)();
 * JIT.validate.is(User)(sample); // true
 * ```
 */
export function mock<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): Mock<ATS.TypeofSchema<TSchema>> {
  return compileMock<ATS.TypeofSchema<TSchema>>(unwrapSchema(schema));
}

/**
 * Compiles formatting for a string schema's declared checks.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const Code = JIT.string().trim().toUpperCase();
 * const formatCode = JIT.format(Code);
 * formatCode(" jit "); // "JIT"
 * ```
 */
export function format<TSchema extends ATS.StringSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Format> {
  return operationArtifact(schema, "format", "value", "value", compileFormat);
}

function mask<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Mask<ATS.TypeofSchema<TSchema>>> {
  return operationArtifact(schema, "mask", "value", "value", compileMask);
}

function sanitize<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Sanitize<ATS.TypeofSchema<TSchema>>> {
  return operationArtifact(schema, "sanitize", "value", "value", compileSanitize);
}

/**
 * Structural comparison capability: one schema in, one compiled function out.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const same = JIT.compare.equal(JIT.array(JIT.int()));
 * same([1, 2], [1, 2]); // true
 * ```
 */
export const compare = Object.freeze({ equal, diff, hash, changed });
/**
 * Boundary hardening capability. `mask` redacts, `sanitize` rewrites.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const PublicUser = JIT.security.mask(JIT.object({ secret: JIT.string() }));
 * PublicUser({ secret: "hidden" });
 * ```
 */
export const security = Object.freeze({ mask, sanitize });

/**
 * Specialized source-to-target mapping. The overrides argument only appears
 * when the target has a field that cannot be matched by name and type, so
 * a straight projection is `JIT.map(User, PublicUser)`. `Map` schemas are a
 * different thing entirely and live on `JIT.mapSchema(key, value)`.
 *
 * @example
 * ```ts
 * import { JIT } from "@jit-compiler/jit";
 *
 * const User = JIT.object({ id: JIT.int(), name: JIT.string() });
 * const PublicUser = JIT.object({ id: JIT.int(), name: JIT.string() });
 * const toPublic = JIT.map(User, PublicUser);
 * toPublic({ id: 1, name: "Ada" });
 * ```
 */
export interface MapNamespace {
  /** Maps one source value into the target schema. */
  <TSourceSchema extends ATS.AnyTypeSchema, TTargetSchema extends ATS.AnyTypeSchema>(
    source: SchemaInput<TSourceSchema>,
    target: SchemaInput<TTargetSchema>,
    ...overrides: MapperArgs<ATS.TypeofSchema<TSourceSchema>, ATS.TypeofSchema<TTargetSchema>>
  ): SchemaArtifact<ATS.TypeofSchema<TSourceSchema>, TTargetSchema>;
  /** The same mapping applied over a collection, in one generated loop. */
  many<TSourceSchema extends ATS.AnyTypeSchema, TTargetSchema extends ATS.AnyTypeSchema>(
    source: SchemaInput<TSourceSchema>,
    target: SchemaInput<TTargetSchema>,
    ...overrides: MapperArgs<ATS.TypeofSchema<TSourceSchema>, ATS.TypeofSchema<TTargetSchema>>
  ): CollectionArtifact<
    ATS.TypeofSchema<TSourceSchema>[],
    ATS.TypeofSchema<TTargetSchema>,
    ATS.ArraySchema<TTargetSchema>
  >;
}

function mapCapability<TSourceSchema extends ATS.AnyTypeSchema, TTargetSchema extends ATS.AnyTypeSchema>(
  source: SchemaInput<TSourceSchema>,
  target: SchemaInput<TTargetSchema>,
  ...overrides: MapperArgs<ATS.TypeofSchema<TSourceSchema>, ATS.TypeofSchema<TTargetSchema>>
): SchemaArtifact<ATS.TypeofSchema<TSourceSchema>, TTargetSchema> {
  const sourceSchema = unwrapSchema(source);

  return mappedValue(
    from(sourceSchema),
    sourceSchema,
    target,
    (overrides[0] ?? {}) as MapperOverridesInput
  ) as SchemaArtifact<ATS.TypeofSchema<TSourceSchema>, TTargetSchema>;
}

function mapMany<TSourceSchema extends ATS.AnyTypeSchema, TTargetSchema extends ATS.AnyTypeSchema>(
  source: SchemaInput<TSourceSchema>,
  target: SchemaInput<TTargetSchema>,
  ...overrides: MapperArgs<ATS.TypeofSchema<TSourceSchema>, ATS.TypeofSchema<TTargetSchema>>
): CollectionArtifact<
  ATS.TypeofSchema<TSourceSchema>[],
  ATS.TypeofSchema<TTargetSchema>,
  ATS.ArraySchema<TTargetSchema>
> {
  const sourceSchema = unwrapSchema(source);
  const sourceCollection = from(arrayOf(sourceSchema));

  if (sourceCollection.schema.type !== "array") {
    throw new Error("unreachable collection schema");
  }
  return sourceCollection.map(target, (overrides[0] ?? {}) as MapperOverridesInput);
}

function arrayOf<TSchema extends ATS.AnyTypeSchema>(schema: TSchema): ATS.ArraySchema<TSchema> {
  return {
    type: "array",
    _type: null as unknown as ATS.TypeofSchema<TSchema>[],
    def: { element: schema },
    annotations: undefined,
  };
}

/** Converts the supplied input into the JIT map representation. */
export const map: MapNamespace = Object.assign(mapCapability, {
  many: mapMany,
});
