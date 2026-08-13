import { type Clone, compileClone } from "../compiler/clone.js";
import { compileDiff, type Diff } from "../compiler/diff.js";
import { compileEqual, type Equal } from "../compiler/equal.js";
import { compileFormat, type Format } from "../compiler/format.js";
import { compileHash, type Hash } from "../compiler/hash.js";
import { compileStringifyChunks, type JsonChunksOptions } from "../compiler/json-chunks.js";
import type { MapperOverridesInput } from "../compiler/mapper/build-mapper-plan.js";
import { compileMask, type Mask } from "../compiler/mask.js";
import { compileSanitize, type Sanitize } from "../compiler/sanitize.js";
import type { SafeParseResult } from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import type { Builder, SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import type { ValidationIssue } from "../errors/index.js";
import { map as mapSchema } from "./collection/collection.js";
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
import type { MapperOverrides } from "./mapper.js";
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

export interface ValidateNamespace {
  is<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): CallableArtifact<(value: unknown) => value is ATS.TypeofSchema<TSchema>>;
  parse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): SchemaArtifact<unknown, TSchema>;
  safeParse<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): ExecutionArtifact<unknown, SafeParseResult<ATS.TypeofSchema<TSchema>>>;
  parseAsync<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): ExecutionArtifact<unknown, Promise<ATS.TypeofSchema<TSchema>>>;
  safeParseAsync<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): ExecutionArtifact<unknown, Promise<SafeParseResult<ATS.TypeofSchema<TSchema>>>>;
  issues<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): ExecutionArtifact<unknown, IterableIterator<ValidationIssue>>;
}

/** Capability namespace for validation. It has no compile-selection chain. */
export const validate: ValidateNamespace = Object.freeze({
  is<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationArtifact(schema, "is") as CallableArtifact<(value: unknown) => value is ATS.TypeofSchema<TSchema>>;
  },
  parse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationArtifact(schema, "parse") as SchemaArtifact<unknown, TSchema>;
  },
  safeParse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationArtifact(schema, "safeParse") as ExecutionArtifact<
      unknown,
      SafeParseResult<ATS.TypeofSchema<TSchema>>
    >;
  },
  parseAsync<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationArtifact(schema, "parseAsync") as ExecutionArtifact<unknown, Promise<ATS.TypeofSchema<TSchema>>>;
  },
  safeParseAsync<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationArtifact(schema, "safeParseAsync") as ExecutionArtifact<
      unknown,
      Promise<SafeParseResult<ATS.TypeofSchema<TSchema>>>
    >;
  },
  issues<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationArtifact(schema, "issues") as ExecutionArtifact<unknown, IterableIterator<ValidationIssue>>;
  },
});

/** Root aliases intentionally reference the exact namespace factories. */
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

    return createExecutionArtifact(base.plan, () => compileStringifyChunks(unwrapped, options));
  },
});

export interface BinaryNamespace {
  encode<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): ExecutionArtifact<ATS.TypeofSchema<TSchema>, Uint8Array>;
  decode<TSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TSchema>
  ): SchemaArtifact<Uint8Array | ArrayBuffer, TSchema>;
}

/** Persisted binary codec capability. Binary rowsets remain under `process`. */
export const binary: BinaryNamespace = Object.freeze({
  encode: binaryEncode,
  decode: binaryDecode,
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

export function format<TSchema extends ATS.StringSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Format> {
  return operationArtifact(schema, "format", "value", "value", compileFormat);
}

export function mask<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Mask<ATS.TypeofSchema<TSchema>>> {
  return operationArtifact(schema, "mask", "value", "value", compileMask);
}

export function sanitize<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Sanitize<ATS.TypeofSchema<TSchema>>> {
  return operationArtifact(schema, "sanitize", "value", "value", compileSanitize);
}

/** Semantic grouping only: these are the same factories as their root aliases. */
export const compare = Object.freeze({ equal, diff, hash });
export const security = Object.freeze({ mask, sanitize });

export interface MapNamespace {
  <TKey extends ATS.AnyTypeSchema, TValue extends ATS.AnyTypeSchema>(
    key: SchemaInput<TKey>,
    value: SchemaInput<TValue>
  ): Builder<ATS.MapSchema<TKey, TValue>>;
  <TSourceSchema extends ATS.AnyTypeSchema, TTargetSchema extends ATS.AnyTypeSchema>(
    source: SchemaInput<TSourceSchema>,
    target: SchemaInput<TTargetSchema>,
    mapping: MapperOverrides<ATS.TypeofSchema<TSourceSchema>, ATS.TypeofSchema<TTargetSchema>>
  ): SchemaArtifact<ATS.TypeofSchema<TSourceSchema>, TTargetSchema>;
  many<TSourceSchema extends ATS.AnyTypeSchema, TTargetSchema extends ATS.AnyTypeSchema>(
    source: SchemaInput<TSourceSchema>,
    target: SchemaInput<TTargetSchema>,
    mapping: MapperOverrides<ATS.TypeofSchema<TSourceSchema>, ATS.TypeofSchema<TTargetSchema>>
  ): CollectionArtifact<
    ATS.TypeofSchema<TSourceSchema>[],
    ATS.TypeofSchema<TTargetSchema>,
    ATS.ArraySchema<TTargetSchema>
  >;
}

function mapCapability<TSourceSchema extends ATS.AnyTypeSchema, TTargetSchema extends ATS.AnyTypeSchema>(
  source: SchemaInput<TSourceSchema>,
  target: SchemaInput<TTargetSchema>,
  mapping: MapperOverrides<ATS.TypeofSchema<TSourceSchema>, ATS.TypeofSchema<TTargetSchema>>
): SchemaArtifact<ATS.TypeofSchema<TSourceSchema>, TTargetSchema>;
function mapCapability<TKey extends ATS.AnyTypeSchema, TValue extends ATS.AnyTypeSchema>(
  key: SchemaInput<TKey>,
  value: SchemaInput<TValue>
): Builder<ATS.MapSchema<TKey, TValue>>;
function mapCapability(
  source: SchemaInput<ATS.AnyTypeSchema>,
  target: SchemaInput<ATS.AnyTypeSchema>,
  ...rest: readonly unknown[]
): unknown {
  if (rest.length === 0) return mapSchema(source, target);

  const sourceSchema = unwrapSchema(source);
  return mappedValue(from(sourceSchema), sourceSchema, target, (rest[0] ?? {}) as MapperOverridesInput);
}

function mapMany<TSourceSchema extends ATS.AnyTypeSchema, TTargetSchema extends ATS.AnyTypeSchema>(
  source: SchemaInput<TSourceSchema>,
  target: SchemaInput<TTargetSchema>,
  mapping: MapperOverrides<ATS.TypeofSchema<TSourceSchema>, ATS.TypeofSchema<TTargetSchema>>
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
  return sourceCollection.map(target, mapping);
}

function arrayOf<TSchema extends ATS.AnyTypeSchema>(schema: TSchema): ATS.ArraySchema<TSchema> {
  return {
    type: "array",
    _type: null as unknown as ATS.TypeofSchema<TSchema>[],
    def: { element: schema },
    annotations: undefined,
  };
}

export const map: MapNamespace = Object.assign(mapCapability, { many: mapMany });
