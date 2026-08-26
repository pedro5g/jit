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
    schema: SchemaInput<TSchema>
  ): ExecutionArtifact<unknown, Promise<ATS.TypeofSchema<TSchema>>>;
  safeParse<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
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
    schema: RuntimeClass<TSchema, TInstance>
  ): ExecutionArtifact<unknown, TInstance>;
  parse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): SchemaArtifact<unknown, TSchema>;
  safeParse<TSchema extends ATS.AnyTypeSchema, TInstance>(
    schema: RuntimeClass<TSchema, TInstance>
  ): StandardArtifact<(value: unknown) => SafeParseResult<TInstance>, TInstance>;
  safeParse<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): StandardArtifact<(value: unknown) => SafeParseResult<ATS.TypeofSchema<TSchema>>, ATS.TypeofSchema<TSchema>>;
  issues<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): ExecutionArtifact<unknown, IterableIterator<ValidationIssue>>;
  parseAsync<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): ExecutionArtifact<unknown, Promise<ATS.TypeofSchema<TSchema>>>;
  safeParseAsync<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): ExecutionArtifact<unknown, Promise<SafeParseResult<ATS.TypeofSchema<TSchema>>>>;
  readonly async: AsyncValidateNamespace;
}

function parseAsync<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
  return validationArtifact(schema, "parseAsync") as ExecutionArtifact<unknown, Promise<ATS.TypeofSchema<TSchema>>>;
}

function safeParseAsync<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
  return validationArtifact(schema, "safeParseAsync") as ExecutionArtifact<
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
  parse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationArtifact(schema, "parse") as SchemaArtifact<unknown, TSchema>;
  },
  safeParse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationArtifact(schema, "safeParse") as StandardArtifact<
      (value: unknown) => SafeParseResult<ATS.TypeofSchema<TSchema>>,
      ATS.TypeofSchema<TSchema>
    >;
  },
  issues<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationArtifact(schema, "issues") as ExecutionArtifact<unknown, IterableIterator<ValidationIssue>>;
  },
  parseAsync,
  safeParseAsync,
  async: Object.freeze({
    parse: parseAsync,
    safeParse: safeParseAsync,
  }),
});

/** Ergonomic validation leaf operations. They deliberately delegate to the namespace above. */
export const is = validate.is;
export const parse = validate.parse;
export const safeParse = validate.safeParse;

export interface JsonNamespace {
  value(): Builder<ATS.JsonSchema>;
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

export function equal<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Equal<ATS.TypeofSchema<TSchema>>> {
  return operationArtifact(schema, "equal", "value", "boolean", compileEqual) as RuntimeCompiledFunction<
    Equal<ATS.TypeofSchema<TSchema>>
  >;
}

export function clone<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Clone<ATS.TypeofSchema<TSchema>>> {
  return operationArtifact(schema, "clone", "value", "value", compileClone) as RuntimeCompiledFunction<
    Clone<ATS.TypeofSchema<TSchema>>
  >;
}

export function diff<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Diff<ATS.TypeofSchema<TSchema>>> {
  return operationArtifact(schema, "diff", "value", "value", compileDiff) as RuntimeCompiledFunction<
    Diff<ATS.TypeofSchema<TSchema>>
  >;
}

export function hash<TSchema extends ATS.AnyTypeSchema>(
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
export const compare = Object.freeze({ equal, diff, hash });
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
