import type * as ATS from "../../core/ats/index.js";
import { Regexes } from "../../shared/index.js";
import { emitSanitizeChain } from "../sanitize.js";
import { countFormatPlaceholders, emitFormatMaskExpression, emitStrictFormatCondition } from "../source/format-mask.js";
import { emitLiteral } from "../source/literal.js";
import type { PathRef, SchemaCheckRecord, ValidatorEmitter } from "./emit-validate.js";

export function emitStringMutations(
  emitter: ValidatorEmitter,
  checks: readonly SchemaCheckRecord[],
  value: string,
  path: PathRef
): void {
  for (const check of checks) {
    if (check.kind === "trim") emitter.writer.line(`${value} = ${value}.trim();`);
    if (check.kind === "normalize") {
      const form = typeof check.value === "string" ? emitLiteral(check.value) : "";
      emitter.writer.line(`${value} = ${value}.normalize(${form});`);
    }
    if (check.kind === "lowercase") emitter.writer.line(`${value} = ${value}.toLowerCase();`);
    if (check.kind === "uppercase") emitter.writer.line(`${value} = ${value}.toUpperCase();`);
    if (check.kind === "sanitize") {
      emitter.writer.line(
        `${value} = ${emitSanitizeChain(value, check.value as ATS.StringSanitizeSpec | undefined, (pattern) => emitter.bind(pattern))};`
      );
    }
    if (check.kind === "format") emitStringFormatMutation(emitter, check, value, path);
    if (check.kind === "phoneBR") emitPhoneMutation(emitter, value, path, check);
  }
}

function emitStringFormatMutation(
  emitter: ValidatorEmitter,
  check: SchemaCheckRecord,
  value: string,
  path: PathRef
): void {
  const spec = check.value as ATS.StringMaskSpec;
  const length = countFormatPlaceholders(spec.pattern);
  if (spec.mode === "strict") {
    emitter.failIf(
      emitStrictFormatCondition(value, spec.pattern),
      path,
      "invalid_format",
      spec.pattern,
      check.message ?? `expected the ${spec.pattern} format`
    );
    return;
  }
  if (spec.stripNonDigits) emitter.writer.line(`${value} = ${value}.replace(/\\D+/g, "");`);
  emitter.failIf(
    `${value}.length !== ${emitLiteral(length)}`,
    path,
    "invalid_format",
    `length === ${length}`,
    check.message ?? `expected ${length} characters before formatting`
  );
}

function emitPhoneMutation(emitter: ValidatorEmitter, value: string, path: PathRef, check: SchemaCheckRecord): void {
  emitter.writer.line(`${value} = ${value}.replace(/\\D+/g, "");`);
  emitter.failIf(
    `${value}.length !== 10 && ${value}.length !== 11`,
    path,
    "invalid_format",
    "Brazilian phone with 10 or 11 digits",
    check.message ?? "expected a Brazilian phone number"
  );
}

type StringCheckEmitter = (emitter: ValidatorEmitter, check: SchemaCheckRecord, value: string, path: PathRef) => void;

const STRING_LENGTH_CHECKS: Readonly<Record<string, StringCheckEmitter>> = {
  min: (emitter, check, value, path) =>
    emitter.failIf(
      `${value}.length < ${emitLiteral(check.value as number)}`,
      path,
      "too_small",
      `length >= ${check.value}`,
      check.message ?? `expected at least ${check.value} characters`,
      { minimum: check.value as number, inclusive: true }
    ),
  max: (emitter, check, value, path) =>
    emitter.failIf(
      `${value}.length > ${emitLiteral(check.value as number)}`,
      path,
      "too_big",
      `length <= ${check.value}`,
      check.message ?? `expected at most ${check.value} characters`,
      { maximum: check.value as number, inclusive: true }
    ),
  length: (emitter, check, value, path) =>
    emitter.failIf(
      `${value}.length !== ${emitLiteral(check.value as number)}`,
      path,
      "invalid_length",
      `length === ${check.value}`,
      check.message ?? `expected exactly ${check.value} characters`,
      { length: check.value as number }
    ),
  oneOf: emitStringOneOf,
  startsWith: (emitter, check, value, path) =>
    emitter.failIf(
      `!${value}.startsWith(${emitLiteral(check.value as string)})`,
      path,
      "invalid_string",
      `startsWith ${check.value}`,
      check.message ?? `expected string to start with ${check.value}`
    ),
  endsWith: (emitter, check, value, path) =>
    emitter.failIf(
      `!${value}.endsWith(${emitLiteral(check.value as string)})`,
      path,
      "invalid_string",
      `endsWith ${check.value}`,
      check.message ?? `expected string to end with ${check.value}`
    ),
  includes: (emitter, check, value, path) =>
    emitter.failIf(
      `!${value}.includes(${emitLiteral(check.value as string)})`,
      path,
      "invalid_string",
      `includes ${check.value}`,
      check.message ?? `expected string to include ${check.value}`
    ),
  digitsLength: emitDigitsLength,
};

export function emitStringLengthChecks(
  emitter: ValidatorEmitter,
  checks: readonly SchemaCheckRecord[],
  value: string,
  path: PathRef
): void {
  for (const check of checks) STRING_LENGTH_CHECKS[check.kind]?.(emitter, check, value, path);
}

function emitStringOneOf(emitter: ValidatorEmitter, check: SchemaCheckRecord, value: string, path: PathRef): void {
  const values = (check.value as readonly string[] | undefined) ?? [];
  const test = values.map((option) => `${value} !== ${emitLiteral(option)}`).join(" && ");
  emitter.failIf(
    values.length === 0 ? "true" : test,
    path,
    "invalid_enum",
    values.join(" | "),
    check.message ?? "expected one of the allowed values"
  );
}

function emitDigitsLength(emitter: ValidatorEmitter, check: SchemaCheckRecord, value: string, path: PathRef): void {
  const lengths = Array.isArray(check.value) ? (check.value as readonly number[]) : [check.value as number];
  const test = lengths.map((length) => `${value}.length !== ${emitLiteral(length)}`).join(" && ");
  emitter.failIf(
    lengths.length === 0 ? "true" : test,
    path,
    "invalid_length",
    lengths.map((length) => `length === ${length}`).join(" | "),
    check.message ?? `expected ${lengths.join(" or ")} digits`
  );
}

const STRING_FORMAT_CHECKS: Readonly<Record<string, StringCheckEmitter>> = {
  regex: (emitter, check, value, path) =>
    emitter.failIf(
      `!${emitter.bindValidation(check.value)}.test(${value})`,
      path,
      "invalid_format",
      "regex",
      check.message ?? "expected the value to match the pattern"
    ),
  email: (emitter, check, value, path) =>
    emitter.failIf(
      `!${emitter.bindValidation(check.value instanceof RegExp ? check.value : Regexes.email)}.test(${value})`,
      path,
      "invalid_format",
      "email",
      check.message ?? "expected a valid email"
    ),
  uuid: (emitter, check, value, path) =>
    emitter.failIf(
      `!${emitter.bindValidation(check.value instanceof RegExp ? check.value : UUID_REGEX)}.test(${value})`,
      path,
      "invalid_format",
      "uuid",
      check.message ?? "expected a valid uuid"
    ),
  url: emitUrlCheck,
  httpUrl: emitHttpUrlCheck,
  stringFormat: emitNamedFormatCheck,
};

const UUID_REGEX = /*@__PURE__*/ Regexes.uuid();

export function emitStringFormatChecks(
  emitter: ValidatorEmitter,
  checks: readonly SchemaCheckRecord[],
  value: string,
  path: PathRef
): void {
  for (const check of checks) {
    const handler = STRING_FORMAT_CHECKS[check.kind];
    if (handler !== undefined) {
      handler(emitter, check, value, path);
    } else if (check.value instanceof RegExp) {
      emitter.failIf(
        `!${emitter.bindValidation(check.value)}.test(${value})`,
        path,
        "invalid_format",
        check.kind,
        check.message ?? `expected a valid ${check.kind}`
      );
    }
  }
}

function emitUrlCheck(emitter: ValidatorEmitter, check: SchemaCheckRecord, value: string, path: PathRef): void {
  const holder = emitter.nextVar("u");
  emitter.writer.line(`let ${holder} = true;`);
  emitter.writer.line(`try { new URL(${value}); } catch { ${holder} = false; }`);
  emitter.failIf(`!${holder}`, path, "invalid_format", "url", check.message ?? "expected a valid URL");
}

function emitHttpUrlCheck(emitter: ValidatorEmitter, check: SchemaCheckRecord, value: string, path: PathRef): void {
  const holder = emitter.nextVar("u");
  const parsed = emitter.nextVar("url");
  emitter.writer.line(`let ${holder} = true;`);
  emitter.writer.line(
    `try { const ${parsed} = new URL(${value}); ${holder} = ${parsed}.protocol === "http:" || ${parsed}.protocol === "https:"; } catch { ${holder} = false; }`
  );
  emitter.failIf(`!${holder}`, path, "invalid_format", "httpUrl", check.message ?? "expected a valid HTTP(S) URL");
}

function emitNamedFormatCheck(emitter: ValidatorEmitter, check: SchemaCheckRecord, value: string, path: PathRef): void {
  const spec = check.value as { readonly name: string; readonly pattern: RegExp };
  emitter.failIf(
    `!${emitter.bindValidation(spec.pattern)}.test(${value})`,
    path,
    "invalid_format",
    spec.name,
    check.message ?? `expected a valid ${spec.name}`
  );
}

export function emitStringTransforms(
  emitter: ValidatorEmitter,
  checks: readonly SchemaCheckRecord[],
  value: string
): void {
  for (const check of checks) {
    if (check.kind === "format") emitFormatTransform(emitter, check, value);
    if (check.kind === "phoneBR") emitPhoneTransform(emitter, value);
  }
}

function emitFormatTransform(emitter: ValidatorEmitter, check: SchemaCheckRecord, value: string): void {
  const spec = check.value as ATS.StringMaskSpec;
  if (spec.mode !== "transform") return;
  const length = countFormatPlaceholders(spec.pattern);
  emitter.writer.line(`if (${value}.length === ${length}) {`);
  emitter.writer.indent(() => emitter.writer.line(`${value} = ${emitFormatMaskExpression(value, spec.pattern)};`));
  emitter.writer.line("}");
}

function emitPhoneTransform(emitter: ValidatorEmitter, value: string): void {
  emitter.writer.line(`if (${value}.length === 10) {`);
  emitter.writer.indent(() => emitter.writer.line(`${value} = ${emitFormatMaskExpression(value, "(##) ####-####")};`));
  emitter.writer.line(`} else if (${value}.length === 11) {`);
  emitter.writer.indent(() => emitter.writer.line(`${value} = ${emitFormatMaskExpression(value, "(##) #####-####")};`));
  emitter.writer.line("}");
}

type NumberCheckEmitter = (emitter: ValidatorEmitter, check: SchemaCheckRecord, value: string, path: PathRef) => void;

const NUMBER_CHECKS: Readonly<Record<string, NumberCheckEmitter>> = {
  min: (emitter, check, value, path) =>
    emitter.failIf(
      `${value} < ${emitLiteral(check.value as number)}`,
      path,
      "too_small",
      `>= ${check.value}`,
      check.message ?? `expected a number >= ${check.value}`,
      { minimum: check.value as number, inclusive: true }
    ),
  max: (emitter, check, value, path) =>
    emitter.failIf(
      `${value} > ${emitLiteral(check.value as number)}`,
      path,
      "too_big",
      `<= ${check.value}`,
      check.message ?? `expected a number <= ${check.value}`,
      { maximum: check.value as number, inclusive: true }
    ),
  moreThan: (emitter, check, value, path) =>
    emitter.failIf(
      `${value} <= ${emitLiteral(check.value as number)}`,
      path,
      "too_small",
      `> ${check.value}`,
      check.message ?? `expected a number > ${check.value}`,
      { minimum: check.value as number, inclusive: false }
    ),
  lessThan: (emitter, check, value, path) =>
    emitter.failIf(
      `${value} >= ${emitLiteral(check.value as number)}`,
      path,
      "too_big",
      `< ${check.value}`,
      check.message ?? `expected a number < ${check.value}`,
      { maximum: check.value as number, inclusive: false }
    ),
  oneOf: emitNumberOneOf,
  positive: (emitter, check, value, path) =>
    emitter.failIf(`${value} <= 0`, path, "not_positive", "> 0", check.message ?? "expected a positive number"),
  negative: (emitter, check, value, path) =>
    emitter.failIf(`${value} >= 0`, path, "not_negative", "< 0", check.message ?? "expected a negative number"),
  finite: (emitter, check, value, path) =>
    emitter.failIf(
      `!Number.isFinite(${value})`,
      path,
      "not_finite",
      "finite",
      check.message ?? "expected a finite number"
    ),
  safe: (emitter, check, value, path) =>
    emitter.failIf(
      `!Number.isSafeInteger(${value})`,
      path,
      "not_safe",
      "safe integer",
      check.message ?? "expected a safe integer"
    ),
  int32: (emitter, check, value, path) =>
    emitter.failIf(
      `(${value} | 0) !== ${value}`,
      path,
      "not_int32",
      "int32",
      check.message ?? "expected a 32-bit signed integer"
    ),
  float32: (emitter, check, value, path) =>
    emitter.failIf(
      `!Number.isFinite(${value}) || Math.fround(${value}) !== ${value}`,
      path,
      "not_float32",
      "float32",
      check.message ?? "expected a float32-representable number"
    ),
  float64: (emitter, check, value, path) =>
    emitter.failIf(
      `!Number.isFinite(${value})`,
      path,
      "not_float64",
      "float64",
      check.message ?? "expected a finite float64 number"
    ),
  multipleOf: (emitter, check, value, path) =>
    emitter.failIf(
      `${value} % ${emitLiteral(check.value as number)} !== 0`,
      path,
      "not_multiple_of",
      `multiple of ${check.value}`,
      check.message ?? `expected a multiple of ${check.value}`,
      { multipleOf: check.value as number }
    ),
};

export function emitNumberChecks(
  emitter: ValidatorEmitter,
  checks: readonly SchemaCheckRecord[],
  value: string,
  path: PathRef,
  forceInteger: boolean
): void {
  if (forceInteger || checks.some((check) => check.kind === "integer")) {
    const integerMessage = checks.find((check) => check.kind === "integer")?.message;
    emitter.failIf(
      `!Number.isInteger(${value})`,
      path,
      "not_integer",
      "integer",
      integerMessage ?? "expected an integer"
    );
  }
  for (const check of checks) NUMBER_CHECKS[check.kind]?.(emitter, check, value, path);
}

function emitNumberOneOf(emitter: ValidatorEmitter, check: SchemaCheckRecord, value: string, path: PathRef): void {
  const values = (check.value as readonly number[] | undefined) ?? [];
  const test = values.map((option) => `${value} !== ${emitLiteral(option)}`).join(" && ");
  emitter.failIf(
    values.length === 0 ? "true" : test,
    path,
    "invalid_enum",
    values.map((option) => String(option)).join(" | "),
    check.message ?? "expected one of the allowed values"
  );
}
