import type { ExecutionPlan, ExecutionStage } from "./compiler/execution-plan.js";
import { resolveWrappers } from "./compiler/resolvers/resolve-wrappers.js";
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
  if (extras !== undefined) {
    for (const [name, value] of Object.entries(extras)) {
      Object.defineProperty(artifact, name, { enumerable: false, value });
    }
  }
  registerArtifact(stub as object, { kind: "execution", plan });
  return Object.freeze(stub);
}

/** @internal Creates the execution stage for a schema-specialized map. */
export function mapStage(
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

/** @internal Creates the execution stage for a schema-specialized transform. */
export function transformStage(
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

/** @internal Checks the object-shape contract of a transform stage. */
export function assertTransformTarget(
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

/** @internal Creates the execution stage for an immutable update. */
export function updateStage(schema: ATS.AnyTypeSchema, many: boolean, patch: unknown): ExecutionStage {
  return {
    ...stage("update", "value", "value"),
    schema,
    many,
    patch,
    provides: ["updated"],
    effects: { ...NO_EFFECTS, mayAllocate: true, usesExternalBindings: true },
  } as ExecutionStage;
}

/** @internal Creates a mask or sanitize execution stage. */
export function securityStage(
  schema: ATS.AnyTypeSchema,
  operation: "mask" | "sanitize",
  many: boolean
): ExecutionStage {
  return {
    ...stage("security", "value", "value"),
    schema,
    operation,
    many,
    provides: [operation === "mask" ? "masked" : "sanitized"],
    effects: { ...NO_EFFECTS, mayAllocate: true },
  } as ExecutionStage;
}

/** @internal Creates a normalized execution stage descriptor. */
export function stage(kind: string, input: ExecutionStage["input"], output: ExecutionStage["output"]): ExecutionStage {
  return {
    kind,
    input,
    output,
    requires: [],
    provides: [],
    effects: kind === "value" ? NO_EFFECTS : THROWING_EFFECTS,
  } as ExecutionStage;
}
