/**
 * AOT definition entrypoint. It exposes the same namespace surface as the
 * runtime package, but artifacts are descriptors that deliberately cannot
 * execute before `jit generate` has lowered them.
 */
import type { Clone } from "./compiler/clone.js";
import type { Diff } from "./compiler/diff.js";
import type { Equal } from "./compiler/equal.js";
import type { ExecutionPlan, ExecutionStage } from "./compiler/execution-plan.js";
import type { Format } from "./compiler/format.js";
import type { Hash } from "./compiler/hash.js";
import type { Serialize } from "./compiler/serialize.js";
import type { SafeParseResult } from "./compiler/validate.js";
import type * as ATS from "./core/ats/index.js";
import type { SchemaInput } from "./core/builder/index.js";
import { unwrapSchema } from "./core/builder/index.js";
import { AOT_ARTIFACT, type AOTArtifact, type ArtifactDescriptor } from "./core/host.js";
import { JITError } from "./errors/index.js";
import type { CallableArtifact, ExecutionArtifact, SchemaArtifact } from "./factories/execution.js";
import * as RuntimeJIT from "./factories/index.js";
import { registerArtifact } from "./runtime/artifact-registry.js";

type DefineFunction<TFunction extends (...args: never[]) => unknown> = AOTArtifact<TFunction> &
  Pick<CallableArtifact<TFunction>, "compile" | "explain" | "plan">;

type RuntimeCollectionDescriptor = {
  readonly schema: ATS.ArraySchema<ATS.AnyTypeSchema>;
  readonly plan: ExecutionPlan;
  filter(predicate: unknown): RuntimeCollectionDescriptor;
  select(...fields: string[]): RuntimeCollectionDescriptor;
};

export type Typeof<TSchemaLike> = import("./core/ats/typeof.js").Typeof<TSchemaLike>;
export type { Strict } from "./core/builder/types.js";

const NO_EFFECTS = Object.freeze({ mayThrow: false, mayAllocate: false, usesExternalBindings: false });
const THROWING_EFFECTS = Object.freeze({ mayThrow: true, mayAllocate: false, usesExternalBindings: false });

const validate = Object.freeze({
  is<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationStub(schema, "is") as DefineFunction<(value: unknown) => value is ATS.TypeofSchema<TSchema>>;
  },
  parse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationStub(schema, "parse") as unknown as SchemaArtifact<unknown, TSchema>;
  },
  safeParse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationStub(schema, "safeParse") as unknown as ExecutionArtifact<
      unknown,
      SafeParseResult<ATS.TypeofSchema<TSchema>>
    >;
  },
  parseAsync<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationStub(schema, "parseAsync") as unknown as ExecutionArtifact<
      unknown,
      Promise<ATS.TypeofSchema<TSchema>>
    >;
  },
  safeParseAsync<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationStub(schema, "safeParseAsync") as unknown as ExecutionArtifact<
      unknown,
      Promise<SafeParseResult<ATS.TypeofSchema<TSchema>>>
    >;
  },
  issues<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationStub(schema, "issues") as unknown as ExecutionArtifact<unknown, IterableIterator<unknown>>;
  },
});

const json = Object.freeze({
  value: RuntimeJIT.json.value,
  parse<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return executionStub<TSchema, (json: string) => ATS.TypeofSchema<TSchema>>(schema, [
      {
        ...stage("json.decode", "json-text", "value"),
        schema: unwrapSchema(schema),
        provides: ["json-syntax-valid"],
      } as ExecutionStage,
    ]) as unknown as SchemaArtifact<string, TSchema>;
  },
  stringify<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return executionStub<TSchema, Serialize<ATS.TypeofSchema<TSchema>>>(schema, [
      stage("value", "value", "value"),
      stage("json.encode", "value", "json-text"),
    ]);
  },
});

const binary = Object.freeze({
  encode<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return executionStub<TSchema, (value: ATS.TypeofSchema<TSchema>) => Uint8Array>(schema, [
      stage("value", "value", "value"),
      stage("binary.encode", "value", "binary"),
    ]);
  },
  decode<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return executionStub<TSchema, (bytes: Uint8Array | ArrayBuffer) => ATS.TypeofSchema<TSchema>>(schema, [
      {
        ...stage("binary.decode", "binary", "value"),
        schema: unwrapSchema(schema),
        provides: ["binary-layout-valid"],
      } as ExecutionStage,
    ]) as unknown as SchemaArtifact<Uint8Array | ArrayBuffer, TSchema>;
  },
});

function from<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): SchemaArtifact<ATS.TypeofSchema<TSchema>, TSchema> {
  return executionStub<TSchema, (value: ATS.TypeofSchema<TSchema>) => ATS.TypeofSchema<TSchema>>(schema, [
    { ...stage("value", "value", "value"), schema: unwrapSchema(schema) } as ExecutionStage,
  ]) as unknown as SchemaArtifact<ATS.TypeofSchema<TSchema>, TSchema>;
}

function map<TSource extends ATS.AnyTypeSchema, TTarget extends ATS.AnyTypeSchema>(
  source: SchemaInput<TSource>,
  target: SchemaInput<TTarget>,
  mapping: Readonly<Record<string, unknown>>
): SchemaArtifact<ATS.TypeofSchema<TSource>, TTarget> {
  const sourceSchema = unwrapSchema(source);
  const targetSchema = unwrapSchema(target);

  return executionStub<TTarget, (value: ATS.TypeofSchema<TSource>) => ATS.TypeofSchema<TTarget>>(targetSchema, [
    { ...stage("value", "value", "value"), schema: sourceSchema } as ExecutionStage,
    mapStage(sourceSchema, targetSchema, false, mapping),
  ]) as unknown as SchemaArtifact<ATS.TypeofSchema<TSource>, TTarget>;
}

function mapMany<TSource extends ATS.AnyTypeSchema, TTarget extends ATS.AnyTypeSchema>(
  source: SchemaInput<TSource>,
  target: SchemaInput<TTarget>,
  mapping: Readonly<Record<string, unknown>>
): SchemaArtifact<ATS.TypeofSchema<TSource>[], ATS.ArraySchema<TTarget>> {
  const sourceSchema = unwrapSchema(source);
  const targetSchema = unwrapSchema(target);
  const collection = unwrapSchema(RuntimeJIT.array(sourceSchema)) as ATS.ArraySchema<TSource>;
  const result = unwrapSchema(RuntimeJIT.array(targetSchema)) as ATS.ArraySchema<TTarget>;

  return executionStub<ATS.ArraySchema<TTarget>, (value: ATS.TypeofSchema<TSource>[]) => ATS.TypeofSchema<TTarget>[]>(
    result,
    [
      { ...stage("value", "value", "value"), schema: collection } as ExecutionStage,
      mapStage(sourceSchema, targetSchema, true, mapping),
    ]
  ) as unknown as SchemaArtifact<ATS.TypeofSchema<TSource>[], ATS.ArraySchema<TTarget>>;
}

function equal<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Equal<ATS.TypeofSchema<TSchema>>> {
  return operationStub<TSchema, Equal<ATS.TypeofSchema<TSchema>>>(schema, "equal", "boolean");
}

function clone<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Clone<ATS.TypeofSchema<TSchema>>> {
  return operationStub<TSchema, Clone<ATS.TypeofSchema<TSchema>>>(schema, "clone", "value");
}

function diff<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Diff<ATS.TypeofSchema<TSchema>>> {
  return operationStub<TSchema, Diff<ATS.TypeofSchema<TSchema>>>(schema, "diff", "value");
}

function hash<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Hash<ATS.TypeofSchema<TSchema>>> {
  return operationStub<TSchema, Hash<ATS.TypeofSchema<TSchema>>>(schema, "hash", "value");
}

function format<TSchema extends ATS.StringSchema>(schema: SchemaInput<TSchema>): DefineFunction<Format> {
  return operationStub<TSchema, Format>(schema, "format", "value");
}

function validationStub<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  operation: "is" | "parse" | "safeParse" | "parseAsync" | "safeParseAsync" | "issues"
): DefineFunction<(...args: never[]) => unknown> {
  return executionStub(schema, [
    stage("value", "value", "value"),
    {
      ...stage("validate", "value", operation === "is" ? "boolean" : operation === "issues" ? "issues" : "value"),
      operation,
      provides: operation === "is" ? [] : ["schema-validated"],
    } as ExecutionStage,
  ]);
}

function operationStub<TSchema extends ATS.AnyTypeSchema, TFunction extends (...args: never[]) => unknown>(
  schema: SchemaInput<TSchema>,
  operation: "equal" | "clone" | "diff" | "hash" | "format" | "mask" | "sanitize",
  output: "value" | "boolean"
): DefineFunction<TFunction> {
  return executionStub<TSchema, TFunction>(schema, [
    stage("value", "value", "value"),
    { ...stage("operation", "value", output), operation } as ExecutionStage,
  ]);
}

function executionStub<TSchema extends ATS.AnyTypeSchema, TFunction extends (...args: never[]) => unknown>(
  schema: SchemaInput<TSchema>,
  stages: readonly ExecutionStage[],
  queryBuilder?: RuntimeCollectionDescriptor
): DefineFunction<TFunction> {
  const unwrapped = unwrapSchema(schema);
  const plan: ExecutionPlan = Object.freeze({ version: 1, schema: unwrapped, stages: Object.freeze(stages) });
  const operation: ArtifactDescriptor["operation"] = { kind: "operation", op: "fromJSON" };
  const stub = function aotExecutionArtifact(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  } as unknown as DefineFunction<TFunction>;

  Object.defineProperties(stub, {
    plan: { enumerable: true, value: plan },
    compile: { enumerable: false, value: () => stub },
    explain: { enumerable: false, value: () => plan },
    [AOT_ARTIFACT]: {
      enumerable: false,
      value: {
        artifactId: `execution:${stages.map((item) => item.kind).join(">")}`,
        schemaId: unwrapped.type,
        operation,
      },
    },
  });
  const artifact = stub as unknown as Record<string, unknown>;
  const append = (nextSchema: ATS.AnyTypeSchema, nextStage: ExecutionStage, nextQuery?: RuntimeCollectionDescriptor) =>
    executionStub(nextSchema, [...plan.stages, nextStage], nextQuery);

  Object.defineProperties(artifact, {
    schema: { enumerable: true, value: unwrapped },
    validate: {
      enumerable: false,
      value: () =>
        append(unwrapped, {
          ...stage("validate", "value", "value"),
          schema: unwrapped,
          operation: "parse",
          provides: ["schema-validated"],
        } as ExecutionStage),
    },
    map: {
      enumerable: false,
      value: (target: SchemaInput<ATS.AnyTypeSchema>, mapping: Readonly<Record<string, unknown>> = {}) => {
        const targetSchema = unwrapSchema(target);
        const many = unwrapped.type === "array";
        const source = many ? (unwrapped as ATS.ArraySchema<ATS.AnyTypeSchema>).def.element : unwrapped;
        const output = many
          ? (unwrapSchema(RuntimeJIT.array(targetSchema)) as ATS.ArraySchema<ATS.AnyTypeSchema>)
          : targetSchema;

        return append(output, mapStage(source, targetSchema, many, mapping));
      },
    },
    to: {
      enumerable: true,
      value: Object.freeze({
        array: () => append(unwrapped, stage("to.array", "value", "value")),
        json: () =>
          append(unwrapped, { ...stage("json.encode", "value", "json-text"), schema: unwrapped } as ExecutionStage),
        binary: () =>
          append(unwrapped, { ...stage("binary.encode", "value", "binary"), schema: unwrapped } as ExecutionStage),
      }),
    },
  });

  if (unwrapped.type === "array") {
    const source = queryBuilder ?? (RuntimeJIT.from(unwrapped) as unknown as RuntimeCollectionDescriptor);

    Object.defineProperties(artifact, {
      filter: {
        enumerable: false,
        value: (predicate: unknown) => {
          const next = source.filter(predicate);
          const query = next.plan.stages[next.plan.stages.length - 1];

          return append(next.schema, query, next);
        },
      },
      select: {
        enumerable: false,
        value: (...fields: string[]) => {
          const next = source.select(...fields);
          const query = next.plan.stages[next.plan.stages.length - 1];

          return append(next.schema, query, next);
        },
      },
    });
  }
  registerArtifact(stub as object, { kind: "execution", plan });
  return Object.freeze(stub);
}

function mapStage(
  source: ATS.AnyTypeSchema,
  target: ATS.AnyTypeSchema,
  many: boolean,
  mapping: Readonly<Record<string, unknown>>
): ExecutionStage {
  return {
    ...stage("map", "value", "value"),
    schema: target,
    source,
    target,
    many,
    bindings: [mapping],
    provides: ["mapped"],
    effects: { ...NO_EFFECTS, mayAllocate: true, usesExternalBindings: Object.keys(mapping).length > 0 },
  } as ExecutionStage;
}

function stage(kind: string, input: ExecutionStage["input"], output: ExecutionStage["output"]): ExecutionStage {
  return {
    kind,
    input,
    output,
    requires: [],
    provides: [],
    effects: kind === "value" ? NO_EFFECTS : THROWING_EFFECTS,
  } as ExecutionStage;
}

export const JIT = {
  ...RuntimeJIT,
  validate,
  is: validate.is,
  parse: validate.parse,
  safeParse: validate.safeParse,
  json,
  binary,
  from,
  map: Object.assign(
    ((
      source: SchemaInput<ATS.AnyTypeSchema>,
      target: SchemaInput<ATS.AnyTypeSchema>,
      mapping?: Readonly<Record<string, unknown>>
    ) =>
      mapping === undefined ? RuntimeJIT.map(source, target) : map(source, target, mapping)) as typeof RuntimeJIT.map,
    { many: mapMany }
  ),
  equal,
  clone,
  diff,
  hash,
  format,
  compare: Object.freeze({ equal, diff, hash }),
} as Omit<
  typeof RuntimeJIT,
  | "validate"
  | "is"
  | "parse"
  | "safeParse"
  | "json"
  | "binary"
  | "from"
  | "map"
  | "equal"
  | "clone"
  | "diff"
  | "hash"
  | "format"
  | "compare"
> & {
  readonly validate: typeof validate;
  readonly is: typeof validate.is;
  readonly parse: typeof validate.parse;
  readonly safeParse: typeof validate.safeParse;
  readonly json: typeof json;
  readonly binary: typeof binary;
  readonly from: typeof from;
  readonly map: typeof map;
  readonly equal: typeof equal;
  readonly clone: typeof clone;
  readonly diff: typeof diff;
  readonly hash: typeof hash;
  readonly format: typeof format;
  readonly compare: { readonly equal: typeof equal; readonly diff: typeof diff; readonly hash: typeof hash };
};

export namespace JIT {
  export type Typeof<TSchemaLike> = import("./core/ats/typeof.js").Typeof<TSchemaLike>;
  export type Strict<TSchemaLike, TValue> = import("./core/builder/types.js").Strict<TSchemaLike, TValue>;
}
