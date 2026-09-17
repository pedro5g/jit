import { emitLiteral } from "../source/literal.js";
import type { PathRef, SchemaCheckRecord, ValidatorEmitter } from "./emit-validate.js";

export function emitArrayCheck(
  emitter: ValidatorEmitter,
  check: SchemaCheckRecord,
  value: string,
  path: PathRef
): void {
  switch (check.kind) {
    case "min":
      emitter.failIf(
        `${value}.length < ${emitLiteral(check.value as number)}`,
        path,
        "too_small",
        `length >= ${check.value}`,
        check.message ?? `expected at least ${check.value} items`,
        { minimum: check.value as number, inclusive: true }
      );
      break;
    case "max":
      emitter.failIf(
        `${value}.length > ${emitLiteral(check.value as number)}`,
        path,
        "too_big",
        `length <= ${check.value}`,
        check.message ?? `expected at most ${check.value} items`,
        { maximum: check.value as number, inclusive: true }
      );
      break;
    case "length":
      emitter.failIf(
        `${value}.length !== ${emitLiteral(check.value as number)}`,
        path,
        "invalid_length",
        `length === ${check.value}`,
        check.message ?? `expected exactly ${check.value} items`
      );
      break;
    case "nonEmpty":
      emitter.failIf(
        `${value}.length === 0`,
        path,
        "too_small",
        "length >= 1",
        check.message ?? "expected a non-empty array"
      );
      break;
    default:
      break;
  }
}
