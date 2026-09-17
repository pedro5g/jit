import type { AnySchema, PathRef, SchemaCheckRecord, ValidatorEmitter } from "./emit-validate.js";
import {
  emitNumberChecks,
  emitStringFormatChecks,
  emitStringLengthChecks,
  emitStringMutations,
  emitStringTransforms,
} from "./emit-validate-text-checks.js";

export function emitString(emitter: ValidatorEmitter, schema: AnySchema, value: string, path: PathRef): string {
  const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];
  emitter.typeGate(
    `typeof ${value} !== "string"`,
    path,
    "expected_string",
    "string",
    emitter.requiredMessage(schema, "expected string"),
    () => emitStringBody(emitter, checks, value, path),
    `typeof ${value}`
  );
  return value;
}

function emitStringBody(
  emitter: ValidatorEmitter,
  checks: readonly SchemaCheckRecord[],
  value: string,
  path: PathRef
): void {
  emitStringMutations(emitter, checks, value, path);
  emitStringLengthChecks(emitter, checks, value, path);
  emitStringFormatChecks(emitter, checks, value, path);
  if (emitter.rootMode === "parse") emitStringTransforms(emitter, checks, value);
}

export function emitNumber(
  emitter: ValidatorEmitter,
  schema: AnySchema,
  value: string,
  path: PathRef,
  forceInteger: boolean
): string {
  const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];
  emitter.typeGate(
    `typeof ${value} !== "number"`,
    path,
    "expected_number",
    "number",
    emitter.requiredMessage(schema, "expected number"),
    () => emitNumberChecks(emitter, checks, value, path, forceInteger),
    `typeof ${value}`
  );
  return value;
}
