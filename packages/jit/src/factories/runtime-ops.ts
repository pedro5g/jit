import { type Clone, compileClone, emitCloneSource } from "../compiler/clone.js";
import { compileDiff, type Diff, emitDiffSource } from "../compiler/diff.js";
import { compileEqual, type Equal, emitEqualSource } from "../compiler/equal.js";
import { compileFormat, emitFormatSource, type Format } from "../compiler/format.js";
import { compileHash, emitHashSource, type Hash } from "../compiler/hash.js";
import { compileStringifyChunks, type JsonChunksOptions, type StringifyChunks } from "../compiler/json-chunks.js";
import { compileSerialize, emitSerializeSource, type Serialize } from "../compiler/serialize.js";
import {
  type CompiledValidator,
  compileValidatorSelection,
  emitValidatorSource,
  type SafeParseResult,
  type ValidatorOp,
} from "../compiler/validate.js";
import type * as ATS from "../core/ats/index.js";
import type { Builder, SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import type { ValidationIssue } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { json as jsonSchema } from "./special/special.js";

type AnyRuntimeFunction = (...args: never[]) => unknown;

export interface RuntimeFunctionExplain {
  readonly operation: string;
  readonly hash: string;
  readonly source: string;
  readonly cache: "identity";
}

export type RuntimeCompiledFunction<TFunction extends AnyRuntimeFunction> = TFunction & {
  readonly source: string;
  readonly hash: string;
  compile(): RuntimeCompiledFunction<TFunction>;
  explain(): RuntimeFunctionExplain;
};

interface RuntimeCompileStep<TFunction extends AnyRuntimeFunction> {
  compile(): RuntimeCompiledFunction<TFunction>;
}

export interface ValidateCompileBuilder<T> {
  is(): RuntimeCompileStep<(value: unknown) => value is T>;
  parse(): RuntimeCompileStep<(value: unknown) => T>;
  safeParse(): RuntimeCompileStep<(value: unknown) => SafeParseResult<T>>;
  parseAsync(): RuntimeCompileStep<(value: unknown) => Promise<T>>;
  safeParseAsync(): RuntimeCompileStep<(value: unknown) => Promise<SafeParseResult<T>>>;
  issues(): RuntimeCompileStep<(value: unknown) => IterableIterator<ValidationIssue>>;
}

export interface JsonCompileBuilder<T> {
  stringify(): RuntimeCompileStep<Serialize<T>>;
  stringifyChunks(options?: JsonChunksOptions): RuntimeCompileStep<StringifyChunks<T>>;
  parse(): RuntimeCompileStep<(json: string) => T>;
}

interface RuntimeMetadataFactory {
  readonly operation: string;
  readonly source: () => string;
}

export function validate<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): ValidateCompileBuilder<ATS.TypeofSchema<TSchema>> {
  const unwrapped = unwrapSchema(schema);

  return Object.freeze({
    is: () => validatorStep(unwrapped, "is"),
    parse: () => validatorStep(unwrapped, "parse"),
    safeParse: () => validatorStep(unwrapped, "safeParse"),
    parseAsync: () => validatorStep(unwrapped, "parseAsync"),
    safeParseAsync: () => validatorStep(unwrapped, "safeParseAsync"),
    issues: () => ({
      compile() {
        const safeParse = compileValidatorSelection(unwrapped, ["safeParse"]).safeParse;
        const issues = function* issues(value: unknown): IterableIterator<ValidationIssue> {
          const result = safeParse(value);

          if (!result.success) yield* result.issues;
        };
        return attachRuntimeMetadata(issues, {
          operation: "validate.issues",
          source: () =>
            "function* issues(value) {\n  const result = __safeParse(value);\n  if (!result.success) yield* result.issues;\n}",
        });
      },
    }),
  });
}

export function equal<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Equal<ATS.Typeof<TSchema>>> {
  const unwrapped = unwrapSchema(schema);

  return attachRuntimeMetadata(compileEqual(unwrapped as TSchema), {
    operation: "equal",
    source: () => emitEqualSource(unwrapped),
  });
}

export function clone<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Clone<ATS.Typeof<TSchema>>> {
  const unwrapped = unwrapSchema(schema);

  return attachRuntimeMetadata(compileClone(unwrapped as TSchema), {
    operation: "clone",
    source: () => emitCloneSource(unwrapped),
  });
}

export function diff<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Diff<ATS.Typeof<TSchema>>> {
  const unwrapped = unwrapSchema(schema);

  return attachRuntimeMetadata(compileDiff(unwrapped as TSchema), {
    operation: "diff",
    source: () => emitDiffSource(unwrapped),
  });
}

export function hash<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Hash<ATS.Typeof<TSchema>>> {
  const unwrapped = unwrapSchema(schema);

  return attachRuntimeMetadata(compileHash(unwrapped as TSchema), {
    operation: "hash",
    source: () => emitHashSource(unwrapped),
  });
}

/** Compiles only the string-formatting checks declared on a string schema. */
export function format<TSchema extends ATS.StringSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Format> {
  const unwrapped = unwrapSchema(schema);

  return attachRuntimeMetadata(compileFormat(unwrapped as TSchema), {
    operation: "format",
    source: () => emitFormatSource(unwrapped),
  });
}

export function json(): Builder<ATS.JsonSchema>;
export function json<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): JsonCompileBuilder<ATS.TypeofSchema<TSchema>>;
export function json<TSchema extends ATS.AnyTypeSchema>(
  schema?: SchemaInput<TSchema>
): Builder<ATS.JsonSchema> | JsonCompileBuilder<ATS.TypeofSchema<TSchema>> {
  if (schema === undefined) return jsonSchema();

  const unwrapped = unwrapSchema(schema);

  return Object.freeze({
    stringify(): RuntimeCompileStep<Serialize<ATS.TypeofSchema<TSchema>>> {
      return {
        compile() {
          return attachRuntimeMetadata(compileSerialize(unwrapped), {
            operation: "json.stringify",
            source: () => emitSerializeSource(unwrapped),
          });
        },
      };
    },
    stringifyChunks(options?: JsonChunksOptions): RuntimeCompileStep<StringifyChunks<ATS.TypeofSchema<TSchema>>> {
      return {
        compile() {
          return attachRuntimeMetadata(compileStringifyChunks(unwrapped, options), {
            operation: "json.stringifyChunks",
            source: () => "function* stringifyChunks(value) { /* specialized chunk emitter */ }",
          });
        },
      };
    },
    parse(): RuntimeCompileStep<(json: string) => ATS.TypeofSchema<TSchema>> {
      return {
        compile() {
          const parse = compileValidatorSelection(unwrapped, ["parse"]).parse;
          const parseJson = ((value: string) => parse(JSON.parse(value))) as (
            json: string
          ) => ATS.TypeofSchema<TSchema>;

          registerArtifact(parseJson as object, {
            kind: "operation",
            schema: unwrapped,
            op: "fromJSON",
          });
          return attachRuntimeMetadata(parseJson, {
            operation: "json.parse",
            source: () => "function parseJson(json) {\n  return __parse(JSON.parse(json));\n}",
          });
        },
      };
    },
  });
}

function validatorStep<TSchema extends ATS.AnyTypeSchema, TOp extends ValidatorOp>(
  schema: TSchema,
  op: TOp
): RuntimeCompileStep<CompiledValidator<ATS.TypeofSchema<TSchema>>[TOp]> {
  return {
    compile() {
      const compiled = compileValidatorSelection(schema, [op])[op];

      return attachRuntimeMetadata(compiled, {
        operation: `validate.${op}`,
        source: () => emitValidatorSource(schema, { ops: [op] }),
      });
    },
  };
}

function attachRuntimeMetadata<TFunction extends AnyRuntimeFunction>(
  fn: TFunction,
  metadata: RuntimeMetadataFactory
): RuntimeCompiledFunction<TFunction> {
  const target = fn as RuntimeCompiledFunction<TFunction>;
  const existing = Object.getOwnPropertyDescriptor(target, "compile");

  if (existing) return target;

  let source: string | undefined;
  let hash: string | undefined;

  Object.defineProperties(target, {
    compile: {
      enumerable: false,
      value: () => target,
    },
    source: {
      enumerable: false,
      get() {
        source = source ?? metadata.source();
        return source;
      },
    },
    hash: {
      enumerable: false,
      get() {
        hash = hash ?? hashSource(target.source);
        return hash;
      },
    },
    explain: {
      enumerable: false,
      value: (): RuntimeFunctionExplain => ({
        operation: metadata.operation,
        hash: target.hash,
        source: target.source,
        cache: "identity",
      }),
    },
  });

  return target;
}

function hashSource(source: string): string {
  let hash = 2166136261;

  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(36)}`;
}
