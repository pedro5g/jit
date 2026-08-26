/**
 * AOT definition entrypoint. It exposes the same namespace surface as the
 * runtime package, but artifacts are descriptors that deliberately cannot
 * execute before `jit generate` has lowered them.
 */
import type { Clone } from "./compiler/clone.js";
import type { CompiledCodec } from "./compiler/codec.js";
import type { Diff } from "./compiler/diff.js";
import type { Equal } from "./compiler/equal.js";
import type { ExecutionPlan, ExecutionStage } from "./compiler/execution-plan.js";
import type { Format } from "./compiler/format.js";
import type { Hash } from "./compiler/hash.js";
import type { JsonChunksOptions } from "./compiler/json-chunks.js";
import type { ToJsonSchemaOptions } from "./compiler/json-schema/index.js";
import type { Mask } from "./compiler/mask.js";
import type { Mock } from "./compiler/mock.js";
import { type OrderDirection, resolveOrderingDescriptor } from "./compiler/ordering.js";
import { resolveWrappers } from "./compiler/resolvers/resolve-wrappers.js";
import type { Sanitize } from "./compiler/sanitize.js";
import type { Serialize } from "./compiler/serialize.js";
import type { UpdatePatch } from "./compiler/update.js";
import type { SafeParseResult } from "./compiler/validate.js";
import type * as ATS from "./core/ats/index.js";
import type { SchemaInput } from "./core/builder/index.js";
import { unwrapSchema } from "./core/builder/index.js";
import { AOT_ARTIFACT, type AOTArtifact, type ArtifactDescriptor } from "./core/host.js";
import { JITError } from "./errors/index.js";
import type { CqrsInput, CqrsQuery, ParsedCqrsInput } from "./factories/cqrs.js";
import type { CallableArtifact, ExecutionArtifact, SchemaArtifact } from "./factories/execution.js";
import * as RuntimeJIT from "./factories/index.js";
import type { SortBuilder, SortPlan } from "./factories/sort.js";
import { getArtifact, registerArtifact } from "./runtime/artifact-registry.js";

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

const NO_EFFECTS = Object.freeze({
  mayThrow: false,
  mayAllocate: false,
  usesExternalBindings: false,
});
const THROWING_EFFECTS = Object.freeze({
  mayThrow: true,
  mayAllocate: false,
  usesExternalBindings: false,
});

function parseAsync<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
  return validationStub(schema, "parseAsync") as unknown as ExecutionArtifact<
    unknown,
    Promise<ATS.TypeofSchema<TSchema>>
  >;
}

function safeParseAsync<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
  return validationStub(schema, "safeParseAsync") as unknown as ExecutionArtifact<
    unknown,
    Promise<SafeParseResult<ATS.TypeofSchema<TSchema>>>
  >;
}

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
  issues<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return validationStub(schema, "issues") as unknown as ExecutionArtifact<unknown, IterableIterator<unknown>>;
  },
  parseAsync,
  safeParseAsync,
  async: Object.freeze({
    parse: parseAsync,
    safeParse: safeParseAsync,
  }),
});

const is = validate.is;
const parse = validate.parse;
const safeParse = validate.safeParse;

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
  stringifyChunks<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>, options?: JsonChunksOptions) {
    const unwrapped = unwrapSchema(schema);

    return executionStub<TSchema, (value: ATS.TypeofSchema<TSchema>) => IterableIterator<string>>(unwrapped, [
      {
        ...stage("value", "value", "value"),
        schema: unwrapped,
      } as ExecutionStage,
      {
        ...stage("json.encode", "value", "json-text"),
        schema: unwrapped,
        mode: "chunks",
        ...(options?.chunkBytes === undefined ? {} : { chunkBytes: options.chunkBytes }),
      } as ExecutionStage,
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
  codec<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>) {
    return operationStub<TSchema, (value: ATS.TypeofSchema<TSchema>) => Uint8Array>(
      schema,
      "codec",
      "value"
    ) as unknown as CompiledCodec<ATS.TypeofSchema<TSchema>>;
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
    {
      ...stage("value", "value", "value"),
      schema: unwrapSchema(schema),
    } as ExecutionStage,
  ]) as unknown as SchemaArtifact<ATS.TypeofSchema<TSchema>, TSchema>;
}

function map<TSource extends ATS.AnyTypeSchema, TTarget extends ATS.AnyTypeSchema>(
  source: SchemaInput<TSource>,
  target: SchemaInput<TTarget>,
  mapping: Readonly<Record<string, unknown>> = {}
): SchemaArtifact<ATS.TypeofSchema<TSource>, TTarget> {
  const sourceSchema = unwrapSchema(source);
  const targetSchema = unwrapSchema(target);

  return executionStub<TTarget, (value: ATS.TypeofSchema<TSource>) => ATS.TypeofSchema<TTarget>>(targetSchema, [
    {
      ...stage("value", "value", "value"),
      schema: sourceSchema,
    } as ExecutionStage,
    mapStage(sourceSchema, targetSchema, false, mapping),
  ]) as unknown as SchemaArtifact<ATS.TypeofSchema<TSource>, TTarget>;
}

function mapMany<TSource extends ATS.AnyTypeSchema, TTarget extends ATS.AnyTypeSchema>(
  source: SchemaInput<TSource>,
  target: SchemaInput<TTarget>,
  mapping: Readonly<Record<string, unknown>> = {}
): SchemaArtifact<ATS.TypeofSchema<TSource>[], ATS.ArraySchema<TTarget>> {
  const sourceSchema = unwrapSchema(source);
  const targetSchema = unwrapSchema(target);
  const collection = unwrapSchema(RuntimeJIT.array(sourceSchema)) as ATS.ArraySchema<TSource>;
  const result = unwrapSchema(RuntimeJIT.array(targetSchema)) as ATS.ArraySchema<TTarget>;

  return executionStub<ATS.ArraySchema<TTarget>, (value: ATS.TypeofSchema<TSource>[]) => ATS.TypeofSchema<TTarget>[]>(
    result,
    [
      {
        ...stage("value", "value", "value"),
        schema: collection,
      } as ExecutionStage,
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

/**
 * AOT mirror of the runtime namespace. `to` still produces the real document
 * (it is static data the generator inlines), while `from` builds a schema the
 * generator lowers exactly like a hand-written one.
 */
const jsonSchema = Object.freeze({
  to<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>, options?: ToJsonSchemaOptions) {
    const document = RuntimeJIT.jsonSchema.to(schema, options);

    registerArtifact(document, {
      kind: "operation",
      schema: unwrapSchema(schema),
      op: "jsonSchema",
    });
    return document;
  },
  from: RuntimeJIT.jsonSchema.from,
});

function mock<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Mock<ATS.TypeofSchema<TSchema>>> {
  return operationStub<TSchema, Mock<ATS.TypeofSchema<TSchema>>>(schema, "mock", "value");
}

function mask<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Mask<ATS.TypeofSchema<TSchema>>> {
  return operationStub<TSchema, Mask<ATS.TypeofSchema<TSchema>>>(schema, "mask", "value");
}

function sanitize<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): DefineFunction<Sanitize<ATS.TypeofSchema<TSchema>>> {
  return operationStub<TSchema, Sanitize<ATS.TypeofSchema<TSchema>>>(schema, "sanitize", "value");
}

function defineSort<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): SortBuilder<TSchema> {
  const unwrapped = unwrapSchema(schema);

  return Object.freeze({
    by(key: string, direction: OrderDirection = "asc") {
      return createDefineSortPlan(unwrapped, [{ key, direction }]);
    },
  }) as SortBuilder<TSchema>;
}

function createDefineSortPlan<TSchema extends ATS.AnyTypeSchema>(
  schema: TSchema,
  criteria: readonly { readonly key: string; readonly direction: OrderDirection }[]
): SortPlan<TSchema> {
  const descriptor = resolveOrderingDescriptor(schema, criteria);
  const stub = function aotSortArtifact(): never {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  } as unknown as SortPlan<TSchema>;
  const fail = (): never => {
    throw new JITError(
      "JIT_AOT_001_ARTIFACT_EXECUTED",
      "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
    );
  };

  Object.defineProperties(stub, {
    [AOT_ARTIFACT]: {
      value: {
        artifactId: "operation:sort",
        schemaId: schema.type,
        operation: { kind: "operation", op: "sort" },
      } satisfies ArtifactDescriptor,
    },
    compare: { value: fail },
    inPlace: { value: fail },
    by: {
      value: (key: string, direction: OrderDirection = "asc") => createDefineSortPlan(schema, [{ key, direction }]),
    },
    thenBy: {
      value: (key: string, direction: OrderDirection = "asc") =>
        createDefineSortPlan(schema, [...criteria, { key, direction }]),
    },
  });
  registerArtifact(stub, { kind: "sort-plan", schema, descriptor });
  return stub;
}

function defineCqrsQuery<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<ATS.ArraySchema<TSchema>>
): CqrsQuery<TSchema>;
function defineCqrsQuery<TSchema extends ATS.AnyTypeSchema>(schema: SchemaInput<TSchema>): CqrsQuery<TSchema>;
function defineCqrsQuery(schema: SchemaInput): CqrsQuery<ATS.AnyTypeSchema> {
  return wrapDefineCqrsQuery(RuntimeJIT.cqrs.query(schema));
}

function wrapDefineCqrsQuery<TQuery extends (...args: never[]) => unknown>(builder: TQuery): TQuery {
  const artifact = getArtifact(builder);
  if (artifact?.kind !== "query-plan") {
    throw new JITError("INVALID_QUERY", "CQRS definition query is missing its reconstructive QueryProgram");
  }
  const terminal = (mode: "array" | "iterator" | "async-iterator" | "visitor") => {
    const stub = function aotQueryArtifact(): never {
      throw new JITError(
        "JIT_AOT_001_ARTIFACT_EXECUTED",
        "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
      );
    } as (...args: unknown[]) => unknown;

    Object.defineProperty(stub, AOT_ARTIFACT, {
      value: {
        artifactId: `query:${mode}`,
        schemaId: artifact.schema.type,
        operation: {
          kind: "query",
          ...(artifact.program.params === undefined ? {} : { params: artifact.program.params }),
        },
      } satisfies ArtifactDescriptor,
    });
    registerArtifact(stub, { ...artifact, mode });
    return stub;
  };
  const stub = terminal("array") as unknown as Record<string, unknown>;
  const source = builder as unknown as Record<string, unknown>;
  const chainMethods = [
    "params",
    "filter",
    "where",
    "select",
    "unique",
    "keyed",
    "groupBy",
    "orderBy",
    "flatMap",
    "take",
    "limit",
    "drop",
    "takeWhile",
    "dropWhile",
    "chunk",
    "window",
    "pairwise",
    "scan",
    "groupAdjacentBy",
    "delete",
    "update",
    "sum",
    "count",
    "avg",
    "min",
    "max",
  ] as const;

  for (const key of chainMethods) {
    const method = source[key] as (...args: unknown[]) => (...args: never[]) => unknown;
    Object.defineProperty(stub, key, { value: (...args: unknown[]) => wrapDefineCqrsQuery(method(...args)) });
  }
  Object.defineProperties(stub, {
    "~query": { get: () => source["~query"] },
    explain: { value: (...args: unknown[]) => (source.explain as (...values: unknown[]) => unknown)(...args) },
    to: {
      value: Object.freeze({
        iterator: () => terminal("iterator"),
        asyncIterator: () => terminal("async-iterator"),
        visitor: () => terminal("visitor"),
      }),
    },
    lazy: {
      value: () => {
        const lazy = terminal("iterator") as unknown as Record<string, unknown>;
        Object.defineProperties(lazy, {
          explain: { value: (...args: unknown[]) => (source.explain as (...values: unknown[]) => unknown)(...args) },
          to: {
            value: Object.freeze({
              asyncIterator: () => terminal("async-iterator"),
              visitor: () => terminal("visitor"),
            }),
          },
        });
        return lazy;
      },
    },
  });
  registerArtifact(stub as object, artifact);
  return stub as unknown as TQuery;
}

const cqrs = Object.freeze({
  ...RuntimeJIT.cqrs,
  parse<TSchema extends ATS.AnyTypeSchema>(definition: CqrsInput<TSchema>) {
    const artifact = getArtifact(definition);
    if (artifact?.kind !== "cqrs-input") {
      throw new JITError("INVALID_QUERY", "CQRS input is missing reconstructive parser metadata");
    }
    const stub = function aotCqrsParser(): never {
      throw new JITError(
        "JIT_AOT_001_ARTIFACT_EXECUTED",
        "AOT artifacts cannot be executed from definition files. Run `jit generate` and import the generated artifact instead."
      );
    } as (input: unknown) => ParsedCqrsInput;
    Object.defineProperty(stub, AOT_ARTIFACT, {
      value: {
        artifactId: "cqrs:parse",
        schemaId: definition.schema.type,
        operation: { kind: "query" },
      } satisfies ArtifactDescriptor,
    });
    registerArtifact(stub, { kind: "cqrs-parser", definition: artifact.definition, source: artifact.source });
    return stub;
  },
  query: defineCqrsQuery,
});

function operationStub<TSchema extends ATS.AnyTypeSchema, TFunction extends (...args: never[]) => unknown>(
  schema: SchemaInput<TSchema>,
  operation: "equal" | "clone" | "diff" | "hash" | "format" | "mask" | "sanitize" | "codec" | "jsonSchema" | "mock",
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
  const plan: ExecutionPlan = Object.freeze({
    version: 1,
    schema: unwrapped,
    stages: Object.freeze(stages),
  });
  const operation: ArtifactDescriptor["operation"] = {
    kind: "operation",
    op: "fromJSON",
  };
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
    transform: {
      enumerable: false,
      value: (target: SchemaInput<ATS.AnyTypeSchema>, transforms: ATS.TransformSpec<unknown>) => {
        const targetSchema = unwrapSchema(target);
        const many = unwrapped.type === "array";
        const source = many ? (unwrapped as ATS.ArraySchema<ATS.AnyTypeSchema>).def.element : unwrapped;
        const output = many
          ? (unwrapSchema(RuntimeJIT.array(targetSchema)) as ATS.ArraySchema<ATS.AnyTypeSchema>)
          : targetSchema;

        return append(output, transformStage(source, targetSchema, many, transforms));
      },
    },
    update: {
      enumerable: false,
      value: (patch: UpdatePatch<unknown>) => {
        const many = unwrapped.type === "array";
        const schema = many ? (unwrapped as ATS.ArraySchema<ATS.AnyTypeSchema>).def.element : unwrapped;

        return append(unwrapped, updateStage(schema, many, patch));
      },
    },
    mask: {
      enumerable: false,
      value: () => {
        const many = unwrapped.type === "array";
        const schema = many ? (unwrapped as ATS.ArraySchema<ATS.AnyTypeSchema>).def.element : unwrapped;

        return append(unwrapped, securityStage(schema, "mask", many));
      },
    },
    sanitize: {
      enumerable: false,
      value: () => {
        const many = unwrapped.type === "array";
        const schema = many ? (unwrapped as ATS.ArraySchema<ATS.AnyTypeSchema>).def.element : unwrapped;

        return append(unwrapped, securityStage(schema, "sanitize", many));
      },
    },
    to: {
      enumerable: true,
      value: Object.freeze({
        array: () => append(unwrapped, stage("to.array", "value", "value")),
        json: () =>
          append(unwrapped, {
            ...stage("json.encode", "value", "json-text"),
            schema: unwrapped,
          } as ExecutionStage),
        binary: () =>
          append(unwrapped, {
            ...stage("binary.encode", "value", "binary"),
            schema: unwrapped,
          } as ExecutionStage),
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
    effects: {
      ...NO_EFFECTS,
      mayAllocate: true,
      usesExternalBindings: Object.keys(mapping).length > 0,
    },
  } as ExecutionStage;
}

function transformStage(
  source: ATS.AnyTypeSchema,
  target: ATS.AnyTypeSchema,
  many: boolean,
  transforms: ATS.TransformSpec<unknown>
): ExecutionStage {
  assertTransformTarget(source, target, transforms);

  return {
    ...stage("transform", "value", "value"),
    schema: target,
    source,
    target,
    many,
    transforms: transforms as Readonly<Record<string, unknown>>,
    provides: ["transformed"],
    effects: {
      ...NO_EFFECTS,
      mayAllocate: true,
      usesExternalBindings: Object.keys(transforms).length > 0,
    },
  } as ExecutionStage;
}

function assertTransformTarget(
  source: ATS.AnyTypeSchema,
  target: ATS.AnyTypeSchema,
  transforms: ATS.TransformSpec<unknown>
): void {
  if (transforms === null || typeof transforms !== "object" || Array.isArray(transforms)) {
    throw new JITError("INVALID_OPERATION", "execution transforms must be a field-to-callback object");
  }

  const sourceObject = resolveWrappers(source).base;
  const targetObject = resolveWrappers(target).base;

  if (sourceObject.type !== "object" || targetObject.type !== "object") {
    throw new JITError("INVALID_OPERATION", "execution transforms require object source and target schemas");
  }

  const sourceKeys = Object.keys((sourceObject as ATS.ObjectSchema).def.props);
  const targetKeys = Object.keys((targetObject as ATS.ObjectSchema).def.props);

  if (sourceKeys.length !== targetKeys.length || sourceKeys.some((key) => !targetKeys.includes(key))) {
    throw new JITError(
      "INVALID_OPERATION",
      "execution transform targets must preserve the source object's field set; use .map() for projections or renames"
    );
  }

  for (const key of Object.keys(transforms)) {
    if (!sourceKeys.includes(key)) {
      throw new JITError("INVALID_OPERATION", `execution transform selected unknown field ${JSON.stringify(key)}`);
    }
    if (typeof transforms[key as keyof typeof transforms] !== "function") {
      throw new JITError("INVALID_OPERATION", `execution transform for ${JSON.stringify(key)} must be a function`);
    }
  }
}

function updateStage(schema: ATS.AnyTypeSchema, many: boolean, patch: unknown): ExecutionStage {
  return {
    ...stage("update", "value", "value"),
    schema,
    many,
    patch,
    provides: ["updated"],
    effects: { ...NO_EFFECTS, mayAllocate: true, usesExternalBindings: true },
  } as ExecutionStage;
}

function securityStage(schema: ATS.AnyTypeSchema, operation: "mask" | "sanitize", many: boolean): ExecutionStage {
  return {
    ...stage("security", "value", "value"),
    schema,
    operation,
    many,
    provides: [operation === "mask" ? "masked" : "sanitized"],
    effects: { ...NO_EFFECTS, mayAllocate: true },
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
  is,
  parse,
  safeParse,
  validate,
  json,
  binary,
  from,
  map: Object.assign(
    ((
      source: SchemaInput<ATS.AnyTypeSchema>,
      target: SchemaInput<ATS.AnyTypeSchema>,
      mapping?: Readonly<Record<string, unknown>>
    ) => map(source, target, mapping ?? {})) as unknown as typeof RuntimeJIT.map,
    { many: mapMany }
  ),
  clone,
  format,
  jsonSchema,
  mock,
  sort: defineSort,
  cqrs,
  compare: Object.freeze({ equal, diff, hash }),
  security: Object.freeze({ mask, sanitize }),
} as Omit<
  typeof RuntimeJIT,
  | "is"
  | "parse"
  | "safeParse"
  | "validate"
  | "json"
  | "binary"
  | "from"
  | "map"
  | "clone"
  | "format"
  | "jsonSchema"
  | "mock"
  | "sort"
  | "cqrs"
  | "compare"
  | "security"
> & {
  readonly is: typeof is;
  readonly parse: typeof parse;
  readonly safeParse: typeof safeParse;
  readonly validate: typeof validate;
  readonly json: typeof json;
  readonly binary: typeof binary;
  readonly from: typeof from;
  readonly map: typeof RuntimeJIT.map;
  readonly clone: typeof clone;
  readonly format: typeof format;
  readonly jsonSchema: typeof jsonSchema;
  readonly mock: typeof mock;
  readonly sort: typeof defineSort;
  readonly cqrs: typeof cqrs;
  readonly compare: {
    readonly equal: typeof equal;
    readonly diff: typeof diff;
    readonly hash: typeof hash;
  };
  readonly security: {
    readonly mask: typeof mask;
    readonly sanitize: typeof sanitize;
  };
};

export namespace JIT {
  export type Typeof<TSchemaLike> = import("./core/ats/typeof.js").Typeof<TSchemaLike>;
  export type Input<TSchemaLike> = import("./core/ats/input.js").Input<TSchemaLike>;
  export type Hydrate<TSchemaLike> = import("./core/ats/representations.js").Hydrate<TSchemaLike>;
  export type Wire<TSchemaLike> = import("./core/ats/representations.js").Wire<TSchemaLike>;
  export type Update<TSchemaLike> = import("./core/ats/input.js").Update<TSchemaLike>;
  export type Strict<TSchemaLike, TValue> = import("./core/builder/types.js").Strict<TSchemaLike, TValue>;
}
