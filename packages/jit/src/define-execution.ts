import type { ExecutionPlan, ExecutionStage } from "./compiler/execution-plan.js";
import {
  createMapStage as mapStage,
  createSecurityStage as securityStage,
  createExecutionStage as stage,
  createTransformStage as transformStage,
  createUpdateStage as updateStage,
} from "./compiler/execution-stage.js";
import type { UpdatePatch } from "./compiler/update.js";
import type * as ATS from "./core/ats/index.js";
import type { SchemaInput } from "./core/builder/index.js";
import { unwrapSchema } from "./core/builder/index.js";
import { AOT_ARTIFACT, type AOTArtifact, type ArtifactDescriptor } from "./core/host.js";
import { JITError } from "./errors/index.js";
import type { CallableArtifact } from "./factories/execution.js";
import * as RuntimeJIT from "./factories/index.js";
import { registerArtifact } from "./runtime/artifact-registry.js";

/** @internal Type shared by non-executable define-host artifacts. */
export type DefineFunction<TFunction extends (...args: never[]) => unknown> = AOTArtifact<TFunction> &
  Pick<CallableArtifact<TFunction>, "compile" | "explain" | "plan">;

/** @internal Minimal collection surface used while extending an execution plan. */
export type RuntimeCollectionDescriptor = {
  readonly schema: ATS.ArraySchema<ATS.AnyTypeSchema>;
  readonly plan: ExecutionPlan;
  filter(predicate: unknown): RuntimeCollectionDescriptor;
  select(...fields: string[]): RuntimeCollectionDescriptor;
};

export { mapStage, stage };
/** @internal Creates a non-executable AOT operation descriptor. */
export function operationStub<TSchema extends ATS.AnyTypeSchema, TFunction extends (...args: never[]) => unknown>(
  schema: SchemaInput<TSchema>,
  operation: "equal" | "clone" | "diff" | "hash" | "format" | "mask" | "sanitize" | "codec" | "jsonSchema" | "mock",
  output: "value" | "boolean",
  extras?: Readonly<Record<string, unknown>>
): DefineFunction<TFunction> {
  return executionStub<TSchema, TFunction>(
    schema,
    [stage("value", "value", "value"), { ...stage("operation", "value", output), operation } as ExecutionStage],
    undefined,
    extras
  );
}

/** @internal Builds and extends an immutable execution descriptor chain. */
export function executionStub<TSchema extends ATS.AnyTypeSchema, TFunction extends (...args: never[]) => unknown>(
  schema: SchemaInput<TSchema>,
  stages: readonly ExecutionStage[],
  queryBuilder?: RuntimeCollectionDescriptor,
  /** Members a specific operation adds, installed before the stub is frozen. */
  extras?: Readonly<Record<string, unknown>>
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

  defineValidationOperation(artifact, unwrapped, append);
  defineValueOperations(artifact, unwrapped, append);
  defineEncodingOperations(artifact, unwrapped, append);
  defineQueryOperations(artifact, unwrapped, queryBuilder, append);
  if (extras !== undefined) {
    for (const [name, value] of Object.entries(extras)) {
      Object.defineProperty(artifact, name, { enumerable: false, value });
    }
  }
  registerArtifact(stub as object, { kind: "execution", plan });
  return Object.freeze(stub);
}

type ExecutionAppender = (
  schema: ATS.AnyTypeSchema,
  nextStage: ExecutionStage,
  query?: RuntimeCollectionDescriptor
) => unknown;

function defineValidationOperation(
  artifact: Record<string, unknown>,
  schema: ATS.AnyTypeSchema,
  append: ExecutionAppender
): void {
  Object.defineProperties(artifact, {
    schema: { enumerable: true, value: schema },
    validate: {
      enumerable: false,
      value: () =>
        append(schema, {
          ...stage("validate", "value", "value"),
          schema,
          operation: "parse",
          provides: ["schema-validated"],
        } as ExecutionStage),
    },
  });
}

function defineValueOperations(
  artifact: Record<string, unknown>,
  schema: ATS.AnyTypeSchema,
  append: ExecutionAppender
): void {
  const many = schema.type === "array";
  const element = many ? (schema as ATS.ArraySchema<ATS.AnyTypeSchema>).def.element : schema;
  Object.defineProperties(artifact, {
    map: {
      enumerable: false,
      value: (target: SchemaInput<ATS.AnyTypeSchema>, mapping = {}) =>
        appendMapped(target, mapping, many, element, append),
    },
    transform: {
      enumerable: false,
      value: (target: SchemaInput<ATS.AnyTypeSchema>, transforms: ATS.TransformSpec<unknown>) => {
        const targetSchema = unwrapSchema(target);
        const output = many
          ? (unwrapSchema(RuntimeJIT.array(targetSchema)) as ATS.ArraySchema<ATS.AnyTypeSchema>)
          : targetSchema;
        return append(output, transformStage(element, targetSchema, many, transforms));
      },
    },
    update: {
      enumerable: false,
      value: (patch: UpdatePatch<unknown>) => append(schema, updateStage(element, many, patch)),
    },
    mask: { enumerable: false, value: () => append(schema, securityStage(element, "mask", many)) },
    sanitize: { enumerable: false, value: () => append(schema, securityStage(element, "sanitize", many)) },
  });
}

function appendMapped(
  target: SchemaInput<ATS.AnyTypeSchema>,
  mapping: Readonly<Record<string, unknown>>,
  many: boolean,
  element: ATS.AnyTypeSchema,
  append: ExecutionAppender
): unknown {
  const targetSchema = unwrapSchema(target);
  const output = many
    ? (unwrapSchema(RuntimeJIT.array(targetSchema)) as ATS.ArraySchema<ATS.AnyTypeSchema>)
    : targetSchema;
  return append(output, mapStage(element, targetSchema, many, mapping));
}

function defineEncodingOperations(
  artifact: Record<string, unknown>,
  schema: ATS.AnyTypeSchema,
  append: ExecutionAppender
): void {
  Object.defineProperty(artifact, "to", {
    enumerable: true,
    value: Object.freeze({
      array: () => append(schema, stage("to.array", "value", "value")),
      json: () => append(schema, { ...stage("json.encode", "value", "json-text"), schema } as ExecutionStage),
      binary: () => append(schema, { ...stage("binary.encode", "value", "binary"), schema } as ExecutionStage),
    }),
  });
}

function defineQueryOperations(
  artifact: Record<string, unknown>,
  schema: ATS.AnyTypeSchema,
  queryBuilder: RuntimeCollectionDescriptor | undefined,
  append: ExecutionAppender
): void {
  if (schema.type !== "array") return;
  const source = queryBuilder ?? (RuntimeJIT.from(schema) as unknown as RuntimeCollectionDescriptor);
  Object.defineProperties(artifact, {
    filter: { enumerable: false, value: (predicate: unknown) => appendQuery(source.filter(predicate), append) },
    select: { enumerable: false, value: (...fields: string[]) => appendQuery(source.select(...fields), append) },
  });
}

function appendQuery(next: RuntimeCollectionDescriptor, append: ExecutionAppender): unknown {
  const query = next.plan.stages[next.plan.stages.length - 1];
  return append(next.schema, query, next);
}
