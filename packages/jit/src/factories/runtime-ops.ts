import { type Clone, compileClone, emitCloneSource } from "../compiler/clone.js";
import { compileDiff, type Diff, emitDiffSource } from "../compiler/diff.js";
import { compileEqual, type Equal, emitEqualSource } from "../compiler/equal.js";
import { compileHash, emitHashSource, type Hash } from "../compiler/hash.js";
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
}

export interface JsonCompileBuilder<T> {
  stringify(): RuntimeCompileStep<Serialize<T>>;
  parse(): RuntimeCompileStep<(json: string) => T>;
}

interface RuntimeMetadataFactory {
  readonly operation: string;
  readonly source: () => string;
}

export function validate<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): ValidateCompileBuilder<ATS.InferSchema<TSchema>> {
  const unwrapped = unwrapSchema(schema);

  return Object.freeze({
    is: () => validatorStep(unwrapped, "is"),
    parse: () => validatorStep(unwrapped, "parse"),
    safeParse: () => validatorStep(unwrapped, "safeParse"),
    parseAsync: () => validatorStep(unwrapped, "parseAsync"),
    safeParseAsync: () => validatorStep(unwrapped, "safeParseAsync"),
  });
}

export function equal<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Equal<ATS.Infer<TSchema>>> {
  const unwrapped = unwrapSchema(schema);

  return attachRuntimeMetadata(compileEqual(unwrapped as TSchema), {
    operation: "equal",
    source: () => emitEqualSource(unwrapped),
  });
}

export function clone<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Clone<ATS.Infer<TSchema>>> {
  const unwrapped = unwrapSchema(schema);

  return attachRuntimeMetadata(compileClone(unwrapped as TSchema), {
    operation: "clone",
    source: () => emitCloneSource(unwrapped),
  });
}

export function diff<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Diff<ATS.Infer<TSchema>>> {
  const unwrapped = unwrapSchema(schema);

  return attachRuntimeMetadata(compileDiff(unwrapped as TSchema), {
    operation: "diff",
    source: () => emitDiffSource(unwrapped),
  });
}

export function hash<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): RuntimeCompiledFunction<Hash<ATS.Infer<TSchema>>> {
  const unwrapped = unwrapSchema(schema);

  return attachRuntimeMetadata(compileHash(unwrapped as TSchema), {
    operation: "hash",
    source: () => emitHashSource(unwrapped),
  });
}

export function json(): Builder<ATS.JsonSchema>;
export function json<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): JsonCompileBuilder<ATS.InferSchema<TSchema>>;
export function json<TSchema extends ATS.AnyTypeSchema>(
  schema?: SchemaInput<TSchema>
): Builder<ATS.JsonSchema> | JsonCompileBuilder<ATS.InferSchema<TSchema>> {
  if (schema === undefined) return jsonSchema();

  const unwrapped = unwrapSchema(schema);

  return Object.freeze({
    stringify(): RuntimeCompileStep<Serialize<ATS.InferSchema<TSchema>>> {
      return {
        compile() {
          return attachRuntimeMetadata(compileSerialize(unwrapped), {
            operation: "json.stringify",
            source: () => emitSerializeSource(unwrapped),
          });
        },
      };
    },
    parse(): RuntimeCompileStep<(json: string) => ATS.InferSchema<TSchema>> {
      return {
        compile() {
          const parse = compileValidatorSelection(unwrapped, ["parse"]).parse;
          const parseJson = ((value: string) => parse(JSON.parse(value))) as (json: string) => ATS.InferSchema<TSchema>;

          registerArtifact(parseJson as object, { kind: "operation", schema: unwrapped, op: "fromJSON" });
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
): RuntimeCompileStep<CompiledValidator<ATS.InferSchema<TSchema>>[TOp]> {
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
