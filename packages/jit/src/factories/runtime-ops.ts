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
  type StandardArtifact,
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

/** A direct callable artifact; `.compile()` is only an optional warm-up hook. */
export type RuntimeCompiledFunction<TFunction extends (...args: never[]) => unknown> = CallableArtifact<TFunction>;

/** Async validation, for schemas that contain promises or async refinements. */
export interface AsyncValidateNamespace {
  parse<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: ValidationDiagnosticOptions
  ): ExecutionArtifact<unknown, Promise<ATS.TypeofSchema<TSchema>>>;
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
 * Every artifact it returns is a Standard Schema (`~standard`), so it can be
 * handed directly to any consumer in the ecosystem.
 */
export interface ValidateNamespace {
  is<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): StandardArtifact<(value: unknown) => value is ATS.TypeofSchema<TSchema>, ATS.TypeofSchema<TSchema>>;
  parse<TSchema extends ATS.AnyTypeSchema, TInstance>(
    schema: RuntimeClass<TSchema, TInstance>,
    options?: ValidationDiagnosticOptions
  ): ExecutionArtifact<unknown, TInstance>;
  parse<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: ValidationDiagnosticOptions
  ): SchemaArtifact<unknown, TSchema>;
  safeParse<TSchema extends ATS.AnyTypeSchema, TInstance>(
    schema: RuntimeClass<TSchema, TInstance>,
    options?: ValidationDiagnosticOptions
  ): StandardArtifact<(value: unknown) => SafeParseResult<TInstance>, TInstance>;
  safeParse<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: ValidationDiagnosticOptions
  ): StandardArtifact<(value: unknown) => SafeParseResult<ATS.TypeofSchema<TSchema>>, ATS.TypeofSchema<TSchema>>;
  issues<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): ExecutionArtifact<unknown, IterableIterator<ValidationIssue>>;
  readonly async: AsyncValidateNamespace;
}

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

/** Capability namespace for validation. It has no compile-selection chain. */
export const validate: ValidateNamespace = Object.freeze({
  is<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationArtifact(schema, "is") as StandardArtifact<
      (value: unknown) => value is ATS.TypeofSchema<TSchema>,
      ATS.TypeofSchema<TSchema>
    >;
  },
  parse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>, options?: ValidationDiagnosticOptions) {
    return validationArtifact(schema, "parse", options) as SchemaArtifact<unknown, TSchema>;
  },
  safeParse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>, options?: ValidationDiagnosticOptions) {
    return validationArtifact(schema, "safeParse", options) as StandardArtifact<
      (value: unknown) => SafeParseResult<ATS.TypeofSchema<TSchema>>,
      ATS.TypeofSchema<TSchema>
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

export interface JsonNamespace {
  value(message?: ValidationMessage): Builder<ATS.JsonSchema>;
  parse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): SchemaArtifact<string, TSchema>;
  stringify<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): ExecutionArtifact<ATS.TypeofSchema<TSchema>, string>;
  stringifyChunks<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: JsonChunksOptions
  ): ExecutionArtifact<ATS.TypeofSchema<TSchema>, IterableIterator<string>>;
}

/** JSON is a capability namespace; `value()` keeps the JSON-value schema explicit. */
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

export interface BinaryNamespace {
  encode<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): ExecutionArtifact<ATS.TypeofSchema<TSchema>, Uint8Array>;
  decode<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): SchemaArtifact<Uint8Array | ArrayBuffer, TSchema>;
  /** Both directions plus `encodeInto`, sharing one wire version. */
  codec<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>,
    options?: CodecCompileOptions
  ): CompiledCodec<ATS.TypeofSchema<TSchema>>;
}

/** Persisted binary codec capability. Binary rowsets remain under `process`. */
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
 */
export interface ChangedMask<TValue, TPath extends string, TMask> {
  (left: TValue, right: TValue): TMask;
  has(mask: TMask, path: TPath): boolean;
  /** The watched fields in bit order, so a caller can report what moved. */
  readonly fields: readonly TPath[];
}

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
 */
export function mock<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): Mock<ATS.TypeofSchema<TSchema>> {
  return compileMock<ATS.TypeofSchema<TSchema>>(unwrapSchema(schema));
}

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

/** Structural comparison capability: one schema in, one compiled function out. */
export const compare = Object.freeze({ equal, diff, hash, changed });
/** Boundary hardening capability. `mask` redacts, `sanitize` rewrites. */
export const security = Object.freeze({ mask, sanitize });

/**
 * Specialized source-to-target mapping. The overrides argument only appears
 * when the target has a field that cannot be matched by name and type, so
 * a straight projection is `JIT.map(User, PublicUser)`. `Map` schemas are a
 * different thing entirely and live on `JIT.mapSchema(key, value)`.
 */
export interface MapNamespace {
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

export const map: MapNamespace = Object.assign(mapCapability, {
  many: mapMany,
});
