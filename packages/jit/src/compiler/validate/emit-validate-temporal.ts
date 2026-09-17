import type * as ATS from "../../core/ats/index.js";
import { emitLiteral } from "../source/literal.js";
import type { AnySchema, PathRef, SchemaCheckRecord, ValidatorEmitter } from "./emit-validate.js";
import { temporalConstructorName } from "./emit-validate-helpers.js";
export function emitDate(emitter: ValidatorEmitter, schema: AnySchema, value: string, path: PathRef): string {
  const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];

  emitter.typeGate(
    `!(${value} instanceof Date) || ${value}.getTime() !== ${value}.getTime()`,
    path,
    "invalid_date",
    "Date",
    emitter.requiredMessage(schema, "expected a valid Date"),
    () => {
      emitter.emitDateLikeChecks(checks, value, path, "date");
    }
  );
  return value;
}

export function emitTemporal(emitter: ValidatorEmitter, schema: AnySchema, value: string, path: PathRef): string {
  const kind = schema.def.kind as ATS.TemporalKind;
  const ctor = temporalConstructorName(kind);
  const expected = `Temporal.${ctor}`;

  emitter.typeGate(
    `!(globalThis.Temporal !== undefined && ${value} instanceof globalThis.Temporal.${ctor})`,
    path,
    "invalid_temporal",
    expected,
    emitter.requiredMessage(schema, `expected ${expected}`),
    () => {
      emitter.emitDateLikeChecks(
        (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [],
        value,
        path,
        kind
      );
    }
  );
  return value;
}

export function emitDateLikeChecks(
  emitter: ValidatorEmitter,
  checks: readonly SchemaCheckRecord[],
  value: string,
  path: PathRef,
  target: "date" | ATS.TemporalKind
): void {
  for (const check of checks) DATE_CHECK_EMITTERS[check.kind]?.(emitter, check, value, path, target);
}

type DateCheckEmitter = (
  emitter: ValidatorEmitter,
  check: SchemaCheckRecord,
  value: string,
  path: PathRef,
  target: "date" | ATS.TemporalKind
) => void;

const DATE_CHECK_EMITTERS: Readonly<Record<string, DateCheckEmitter>> = {
  min: emitMinCheck,
  max: emitMaxCheck,
  between: emitBetweenCheck,
  daysOfWeek: emitDaysOfWeekCheck,
  monthsOfYear: emitMonthsOfYearCheck,
  truncateTo: emitTruncateCheck,
};

function emitMinCheck(
  emitter: ValidatorEmitter,
  check: SchemaCheckRecord,
  value: string,
  path: PathRef,
  target: "date" | ATS.TemporalKind
): void {
  const bound = emitter.dateLikeBound(check.value, target);
  emitter.failIf(
    emitter.dateLikeCompare(value, bound, target, "<"),
    path,
    "too_small",
    `>= ${String(check.value)}`,
    check.message ?? `expected a value >= ${String(check.value)}`,
    { minimum: String(check.value), inclusive: true }
  );
}

function emitMaxCheck(
  emitter: ValidatorEmitter,
  check: SchemaCheckRecord,
  value: string,
  path: PathRef,
  target: "date" | ATS.TemporalKind
): void {
  const bound = emitter.dateLikeBound(check.value, target);
  emitter.failIf(
    emitter.dateLikeCompare(value, bound, target, ">"),
    path,
    "too_big",
    `<= ${String(check.value)}`,
    check.message ?? `expected a value <= ${String(check.value)}`,
    { maximum: String(check.value), inclusive: true }
  );
}

function emitBetweenCheck(
  emitter: ValidatorEmitter,
  check: SchemaCheckRecord,
  value: string,
  path: PathRef,
  target: "date" | ATS.TemporalKind
): void {
  const range = check.value as { readonly min: Date | string; readonly max: Date | string };
  const min = emitter.dateLikeBound(range.min, target);
  const max = emitter.dateLikeBound(range.max, target);
  emitter.failIf(
    `${emitter.dateLikeCompare(value, min, target, "<")} || ${emitter.dateLikeCompare(value, max, target, ">")}`,
    path,
    "out_of_range",
    `${String(range.min)}..${String(range.max)}`,
    check.message ?? `expected a value between ${String(range.min)} and ${String(range.max)}`,
    { minimum: String(range.min), maximum: String(range.max), inclusive: true }
  );
}

function emitDaysOfWeekCheck(
  emitter: ValidatorEmitter,
  check: SchemaCheckRecord,
  value: string,
  path: PathRef,
  target: "date" | ATS.TemporalKind
): void {
  const days = (check.value as readonly number[] | undefined) ?? [];
  const dayExpr = target === "date" ? `(((${value}.getDay() + 6) % 7) + 1)` : `${value}.dayOfWeek`;
  const test = days.map((day) => `${dayExpr} !== ${emitLiteral(day)}`).join(" && ");
  emitter.failIf(
    days.length === 0 ? "true" : `typeof ${dayExpr} !== "number" || (${test})`,
    path,
    "invalid_day_of_week",
    days.join(" | "),
    check.message ?? "expected an allowed day of week"
  );
}

function emitMonthsOfYearCheck(
  emitter: ValidatorEmitter,
  check: SchemaCheckRecord,
  value: string,
  path: PathRef,
  target: "date" | ATS.TemporalKind
): void {
  const months = (check.value as readonly number[] | undefined) ?? [];
  const monthExpr = target === "date" ? `(${value}.getMonth() + 1)` : `${value}.month`;
  const test = months.map((month) => `${monthExpr} !== ${emitLiteral(month)}`).join(" && ");
  emitter.failIf(
    months.length === 0 ? "true" : `typeof ${monthExpr} !== "number" || (${test})`,
    path,
    "invalid_month_of_year",
    months.join(" | "),
    check.message ?? "expected an allowed month"
  );
}

function emitTruncateCheck(
  emitter: ValidatorEmitter,
  check: SchemaCheckRecord,
  value: string,
  path: PathRef,
  target: "date" | ATS.TemporalKind
): void {
  emitter.failIf(
    emitter.truncateFailure(value, check.value as ATS.TemporalUnit, target),
    path,
    "invalid_precision",
    String(check.value),
    check.message ?? `expected value truncated to ${String(check.value)}`
  );
}

export function dateLikeBound(_emitter: ValidatorEmitter, value: unknown, target: "date" | ATS.TemporalKind): string {
  if (target === "date") {
    const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();

    return emitLiteral(time);
  }
  return emitLiteral(value instanceof Date ? value.toISOString() : String(value));
}

export function dateLikeCompare(
  _emitter: ValidatorEmitter,
  value: string,
  bound: string,
  target: "date" | ATS.TemporalKind,
  operator: "<" | ">"
): string {
  return target === "date" ? `${value}.getTime() ${operator} ${bound}` : `${value}.toString() ${operator} ${bound}`;
}

export function truncateFailure(
  _emitter: ValidatorEmitter,
  value: string,
  unit: ATS.TemporalUnit,
  target: "date" | ATS.TemporalKind
): string {
  if (target === "date") {
    if (unit === "minute") return `${value}.getSeconds() !== 0 || ${value}.getMilliseconds() !== 0`;
    if (unit === "second") return `${value}.getMilliseconds() !== 0`;
    return "false";
  }

  const second = `(${value}.second ?? 0)`;
  const millisecond = `(${value}.millisecond ?? 0)`;
  const microsecond = `(${value}.microsecond ?? 0)`;
  const nanosecond = `(${value}.nanosecond ?? 0)`;

  if (unit === "minute")
    return `${second} !== 0 || ${millisecond} !== 0 || ${microsecond} !== 0 || ${nanosecond} !== 0`;
  if (unit === "second") return `${millisecond} !== 0 || ${microsecond} !== 0 || ${nanosecond} !== 0`;
  return `${microsecond} !== 0 || ${nanosecond} !== 0`;
}
