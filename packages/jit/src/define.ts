/**
 * AOT definition entrypoint. Schema factories are shared with runtime JIT,
 * while `.compile()` returns typed artifacts that cannot be executed from
 * declaration files. `jit generate` reads their registry metadata and emits
 * standalone code with the same compiler pipeline.
 */
import type { Clone } from "./compiler/clone.js";
import type { Diff } from "./compiler/diff.js";
import type { Equal } from "./compiler/equal.js";
import type { Format } from "./compiler/format.js";
import type { Hash } from "./compiler/hash.js";
import type { Serialize } from "./compiler/serialize.js";
import type { SafeParseResult, ValidatorOp } from "./compiler/validate.js";
import type * as ATS from "./core/ats/index.js";
import type { Builder, SchemaInput } from "./core/builder/index.js";
import { unwrapSchema } from "./core/builder/index.js";
import { AOT_ARTIFACT, type AOTArtifact, type ArtifactDescriptor } from "./core/host.js";
import { JITError } from "./errors/index.js";
import * as RuntimeJIT from "./factories/index.js";
import { registerArtifact } from "./runtime/artifact-registry.js";

type DefineFunction<TFunction extends (...args: never[]) => unknown> = AOTArtifact<TFunction> & {
  compile(): DefineFunction<TFunction>;
};

interface DefineStep<TFunction extends (...args: never[]) => unknown> {
  compile(): DefineFunction<TFunction>;
}

interface DefineValidateBuilder<T> {
  is(): DefineStep<(value: unknown) => value is T>;
  parse(): DefineStep<(value: unknown) => T>;
  safeParse(): DefineStep<(value: unknown) => SafeParseResult<T>>;
  parseAsync(): DefineStep<(value: unknown) => Promise<T>>;
  safeParseAsync(): DefineStep<(value: unknown) => Promise<SafeParseResult<T>>>;
}

interface DefineJsonBuilder<T> {
  stringify(): DefineStep<Serialize<T>>;
  parse(): DefineStep<(json: string) => T>;
}

export type Typeof<TSchemaLike> = import("./core/ats/typeof.js").Typeof<TSchemaLike>;
export type { Strict } from "./core/builder/types.js";

export const JIT = {
  ...RuntimeJIT,
  validate,
  equal,
  clone,
  diff,
  format,
  hash,
  json,
} as typeof RuntimeJIT & {
  readonly validate: typeof validate;
  readonly equal: typeof equal;
  readonly clone: typeof clone;
  readonly diff: typeof diff;
  readonly format: typeof format;
  readonly hash: typeof hash;
  readonly json: typeof json;
};

export namespace JIT {
  export type Typeof<TSchemaLike> = import("./core/ats/typeof.js").Typeof<TSchemaLike>;
  export type Strict<TSchemaLike, TValue> = import("./core/builder/types.js").Strict<TSchemaLike, TValue>;
}

function validate<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineValidateBuilder<ATS.TypeofSchema<TSchema>> {
  const unwrapped = unwrapSchema(schema);

  return Object.freeze({
    is: () => validatorStep(unwrapped, "is"),
    parse: () => validatorStep(unwrapped, "parse"),
    safeParse: () => validatorStep(unwrapped, "safeParse"),
    parseAsync: () => validatorStep(unwrapped, "parseAsync"),
    safeParseAsync: () => validatorStep(unwrapped, "safeParseAsync"),
  });
}

function equal<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Equal<ATS.TypeofSchema<TSchema>>> {
  return operationStub(schema, "equal");
}

function clone<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Clone<ATS.TypeofSchema<TSchema>>> {
  return operationStub(schema, "clone");
}

function diff<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Diff<ATS.TypeofSchema<TSchema>>> {
  return operationStub(schema, "diff");
}

function hash<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Hash<ATS.TypeofSchema<TSchema>>> {
  return operationStub(schema, "hash");
}

function format<TSchema extends ATS.StringSchema>(schema: SchemaInput<TSchema>): DefineFunction<Format> {
  return operationStub(schema, "format");
}

function json(): Builder<ATS.JsonSchema>;
function json<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineJsonBuilder<ATS.TypeofSchema<TSchema>>;
function json<TSchema extends ATS.AnyTypeSchema>(
  schema?: SchemaInput<TSchema>
): Builder<ATS.JsonSchema> | DefineJsonBuilder<ATS.TypeofSchema<TSchema>> {
  if (schema === undefined) return RuntimeJIT.json();

  const unwrapped = unwrapSchema(schema);

  return Object.freeze({
    stringify: () => operationStep(unwrapped, "stringify"),
    parse: () => operationStep(unwrapped, "fromJSON"),
  });
}

function validatorStep<TSchema extends ATS.AnyTypeSchema, TOp extends ValidatorOp>(
  schema: TSchema,
  op: TOp
): DefineStep<ValidatorFunction<ATS.TypeofSchema<TSchema>, TOp>> {
  return {
    compile() {
      return createAotStub(schema, { kind: "validate", op }, { kind: "validator", schema, op });
    },
  };
}

function operationStep<
  TSchema extends ATS.AnyTypeSchema,
  TOp extends "equal" | "clone" | "diff" | "hash" | "stringify" | "fromJSON" | "format",
>(schema: TSchema, op: TOp): DefineStep<OperationFunction<ATS.TypeofSchema<TSchema>, TOp>> {
  return {
    compile() {
      return operationStub(schema, op);
    },
  };
}

function operationStub<
  TSchema extends ATS.AnyTypeSchema,
  TOp extends "equal" | "clone" | "diff" | "hash" | "stringify" | "fromJSON" | "format",
>(schema: SchemaInput<TSchema>, op: TOp): DefineFunction<OperationFunction<ATS.TypeofSchema<TSchema>, TOp>> {
  const unwrapped = unwrapSchema(schema);

  return createAotStub(unwrapped, { kind: "operation", op }, { kind: "operation", schema: unwrapped, op });
}

function createAotStub<TFunction extends (...args: never[]) => unknown>(
  schema: ATS.AnyTypeSchema,
  operation: ArtifactDescriptor["operation"],
  artifact: Parameters<typeof registerArtifact>[1]
): DefineFunction<TFunction> {
  const descriptor: ArtifactDescriptor = {
    artifactId: `${operation.kind}:${"op" in operation ? operation.op : "query"}`,
    schemaId: schema.type,
    operation,
  };
  const stub = function aotArtifactStub(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated function instead."
    );
  } as unknown as DefineFunction<TFunction>;

  Object.defineProperties(stub, {
    compile: {
      enumerable: false,
      value: () => stub,
    },
    [AOT_ARTIFACT]: {
      enumerable: false,
      value: descriptor,
    },
  });
  registerArtifact(stub as object, artifact);
  return stub;
}

type ValidatorFunction<T, TOp extends ValidatorOp> = TOp extends "is"
  ? (value: unknown) => value is T
  : TOp extends "parse"
    ? (value: unknown) => T
    : TOp extends "safeParse"
      ? (value: unknown) => SafeParseResult<T>
      : TOp extends "parseAsync"
        ? (value: unknown) => Promise<T>
        : (value: unknown) => Promise<SafeParseResult<T>>;

type OperationFunction<
  T,
  TOp extends "equal" | "clone" | "diff" | "hash" | "stringify" | "fromJSON" | "format",
> = TOp extends "equal"
  ? Equal<T>
  : TOp extends "clone"
    ? Clone<T>
    : TOp extends "diff"
      ? Diff<T>
      : TOp extends "hash"
        ? Hash<T>
        : TOp extends "stringify"
          ? Serialize<T>
          : TOp extends "format"
            ? Format
            : (json: string) => T;
