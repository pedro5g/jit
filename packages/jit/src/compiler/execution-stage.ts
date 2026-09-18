import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import type { ExecutionStage, Representation } from "./execution-plan.js";
import { NO_EFFECTS, THROWING_EFFECTS } from "./execution-plan.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";

/** Creates the common descriptor fields shared by every execution stage. */
export function createExecutionStage(kind: string, input: Representation, output: Representation): ExecutionStage {
  return {
    kind,
    input,
    output,
    requires: [],
    provides: [],
    effects: kind === "value" ? NO_EFFECTS : THROWING_EFFECTS,
  } as ExecutionStage;
}

/** Creates the schema-specialized map stage used by runtime and define hosts. */
export function createMapStage(
  source: ATS.AnyTypeSchema,
  target: ATS.AnyTypeSchema,
  many: boolean,
  mapping: Readonly<Record<string, unknown>>
): ExecutionStage {
  return {
    ...createExecutionStage("map", "value", "value"),
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

/** Creates and validates the schema-aware transform stage. */
export function createTransformStage(
  source: ATS.AnyTypeSchema,
  target: ATS.AnyTypeSchema,
  many: boolean,
  transforms: ATS.TransformSpec<unknown>
): ExecutionStage {
  assertTransformTarget(source, target, transforms);

  return {
    ...createExecutionStage("transform", "value", "value"),
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

/** Creates an immutable update stage. */
export function createUpdateStage(schema: ATS.AnyTypeSchema, many: boolean, patch: unknown): ExecutionStage {
  return {
    ...createExecutionStage("update", "value", "value"),
    schema,
    many,
    patch,
    provides: ["updated"],
    effects: { ...NO_EFFECTS, mayAllocate: true, usesExternalBindings: true },
  } as ExecutionStage;
}

/** Creates a mask or sanitize stage. */
export function createSecurityStage(
  schema: ATS.AnyTypeSchema,
  operation: "mask" | "sanitize",
  many: boolean
): ExecutionStage {
  return {
    ...createExecutionStage("security", "value", "value"),
    schema,
    operation,
    many,
    provides: [operation === "mask" ? "masked" : "sanitized"],
    effects: { ...NO_EFFECTS, mayAllocate: true },
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

  if (sourceObject.type !== TypeName.object || targetObject.type !== TypeName.object) {
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
