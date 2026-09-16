import type * as ATS from "../../core/ats/index.js";
import { Regexes } from "../../shared/index.js";
import { emitSanitizeChain } from "../sanitize.js";
import { countFormatPlaceholders, emitFormatMaskExpression, emitStrictFormatCondition } from "../source/format-mask.js";
import { emitLiteral } from "../source/literal.js";
import type { AnySchema, PathRef, SchemaCheckRecord, ValidatorEmitter } from "./emit-validate.js";

const EMAIL_REGEX = Regexes.email;
const UUID_REGEX = /*@__PURE__*/ Regexes.uuid();
export function emitString(emitter: ValidatorEmitter, schema: AnySchema, value: string, path: PathRef): string {
  const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];

  emitter.typeGate(
    `typeof ${value} !== "string"`,
    path,
    "expected_string",
    "string",
    emitter.requiredMessage(schema, "expected string"),
    () => {
      // Mutating checks first, cheap length window next, format regexes last.
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
        if (check.kind === "format") {
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
          } else {
            if (spec.stripNonDigits) emitter.writer.line(`${value} = ${value}.replace(/\\D+/g, "");`);
            emitter.failIf(
              `${value}.length !== ${emitLiteral(length)}`,
              path,
              "invalid_format",
              `length === ${length}`,
              check.message ?? `expected ${length} characters before formatting`
            );
          }
        }
        if (check.kind === "phoneBR") {
          emitter.writer.line(`${value} = ${value}.replace(/\\D+/g, "");`);
          emitter.failIf(
            `${value}.length !== 10 && ${value}.length !== 11`,
            path,
            "invalid_format",
            "Brazilian phone with 10 or 11 digits",
            check.message ?? "expected a Brazilian phone number"
          );
        }
      }

      for (const check of checks) {
        switch (check.kind) {
          case "min":
            emitter.failIf(
              `${value}.length < ${emitLiteral(check.value as number)}`,
              path,
              "too_small",
              `length >= ${check.value}`,
              check.message ?? `expected at least ${check.value} characters`,
              { minimum: check.value as number, inclusive: true }
            );
            break;
          case "max":
            emitter.failIf(
              `${value}.length > ${emitLiteral(check.value as number)}`,
              path,
              "too_big",
              `length <= ${check.value}`,
              check.message ?? `expected at most ${check.value} characters`,
              { maximum: check.value as number, inclusive: true }
            );
            break;
          case "length":
            emitter.failIf(
              `${value}.length !== ${emitLiteral(check.value as number)}`,
              path,
              "invalid_length",
              `length === ${check.value}`,
              check.message ?? `expected exactly ${check.value} characters`,
              { length: check.value as number }
            );
            break;
          case "oneOf": {
            const values = (check.value as readonly string[] | undefined) ?? [];
            const test = values.map((option) => `${value} !== ${emitLiteral(option)}`).join(" && ");

            emitter.failIf(
              values.length === 0 ? "true" : test,
              path,
              "invalid_enum",
              values.join(" | "),
              check.message ?? "expected one of the allowed values"
            );
            break;
          }
          case "startsWith":
            emitter.failIf(
              `!${value}.startsWith(${emitLiteral(check.value as string)})`,
              path,
              "invalid_string",
              `startsWith ${check.value}`,
              check.message ?? `expected string to start with ${check.value}`
            );
            break;
          case "endsWith":
            emitter.failIf(
              `!${value}.endsWith(${emitLiteral(check.value as string)})`,
              path,
              "invalid_string",
              `endsWith ${check.value}`,
              check.message ?? `expected string to end with ${check.value}`
            );
            break;
          case "includes":
            emitter.failIf(
              `!${value}.includes(${emitLiteral(check.value as string)})`,
              path,
              "invalid_string",
              `includes ${check.value}`,
              check.message ?? `expected string to include ${check.value}`
            );
            break;
          case "digitsLength": {
            const lengths = Array.isArray(check.value) ? (check.value as readonly number[]) : [check.value as number];
            const test = lengths.map((length) => `${value}.length !== ${emitLiteral(length)}`).join(" && ");

            emitter.failIf(
              lengths.length === 0 ? "true" : test,
              path,
              "invalid_length",
              lengths.map((length) => `length === ${length}`).join(" | "),
              check.message ?? `expected ${lengths.join(" or ")} digits`
            );
            break;
          }
          default:
            break;
        }
      }

      for (const check of checks) {
        switch (check.kind) {
          case "regex":
            emitter.failIf(
              `!${emitter.bindValidation(check.value)}.test(${value})`,
              path,
              "invalid_format",
              "regex",
              check.message ?? "expected the value to match the pattern"
            );
            break;
          case "email":
            emitter.failIf(
              `!${emitter.bindValidation(check.value instanceof RegExp ? check.value : EMAIL_REGEX)}.test(${value})`,
              path,
              "invalid_format",
              "email",
              check.message ?? "expected a valid email"
            );
            break;
          case "uuid":
            emitter.failIf(
              `!${emitter.bindValidation(check.value instanceof RegExp ? check.value : UUID_REGEX)}.test(${value})`,
              path,
              "invalid_format",
              "uuid",
              check.message ?? "expected a valid uuid"
            );
            break;
          case "url": {
            const holder = emitter.nextVar("u");

            emitter.writer.line(`let ${holder} = true;`);
            emitter.writer.line(`try { new URL(${value}); } catch { ${holder} = false; }`);
            emitter.failIf(`!${holder}`, path, "invalid_format", "url", check.message ?? "expected a valid URL");
            break;
          }
          case "httpUrl": {
            const holder = emitter.nextVar("u");
            const parsed = emitter.nextVar("url");

            emitter.writer.line(`let ${holder} = true;`);
            emitter.writer.line(
              `try { const ${parsed} = new URL(${value}); ${holder} = ${parsed}.protocol === "http:" || ${parsed}.protocol === "https:"; } catch { ${holder} = false; }`
            );
            emitter.failIf(
              `!${holder}`,
              path,
              "invalid_format",
              "httpUrl",
              check.message ?? "expected a valid HTTP(S) URL"
            );
            break;
          }
          case "stringFormat": {
            const spec = check.value as {
              readonly name: string;
              readonly pattern: RegExp;
            };

            emitter.failIf(
              `!${emitter.bindValidation(spec.pattern)}.test(${value})`,
              path,
              "invalid_format",
              spec.name,
              check.message ?? `expected a valid ${spec.name}`
            );
            break;
          }
          default:
            // Named formats (cuid2, ulid, ipv4, datetime, digest, ...) are
            // all a single compiled regex test carrying their kind.
            if (check.value instanceof RegExp) {
              emitter.failIf(
                `!${emitter.bindValidation(check.value)}.test(${value})`,
                path,
                "invalid_format",
                check.kind,
                check.message ?? `expected a valid ${check.kind}`
              );
            }
            break;
        }
      }

      if (emitter.rootMode === "parse") {
        for (const check of checks) {
          if (check.kind === "format") {
            const spec = check.value as ATS.StringMaskSpec;

            if (spec.mode === "transform") {
              const length = countFormatPlaceholders(spec.pattern);

              emitter.writer.line(`if (${value}.length === ${length}) {`);
              emitter.writer.indent(() => {
                emitter.writer.line(`${value} = ${emitFormatMaskExpression(value, spec.pattern)};`);
              });
              emitter.writer.line("}");
            }
          }
          if (check.kind === "phoneBR") {
            emitter.writer.line(`if (${value}.length === 10) {`);
            emitter.writer.indent(() => {
              emitter.writer.line(`${value} = ${emitFormatMaskExpression(value, "(##) ####-####")};`);
            });
            emitter.writer.line(`} else if (${value}.length === 11) {`);
            emitter.writer.indent(() => {
              emitter.writer.line(`${value} = ${emitFormatMaskExpression(value, "(##) #####-####")};`);
            });
            emitter.writer.line("}");
          }
        }
      }
    },
    `typeof ${value}`
  );

  return value;
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
    () => {
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

      for (const check of checks) {
        switch (check.kind) {
          case "min":
            emitter.failIf(
              `${value} < ${emitLiteral(check.value as number)}`,
              path,
              "too_small",
              `>= ${check.value}`,
              check.message ?? `expected a number >= ${check.value}`,
              { minimum: check.value as number, inclusive: true }
            );
            break;
          case "max":
            emitter.failIf(
              `${value} > ${emitLiteral(check.value as number)}`,
              path,
              "too_big",
              `<= ${check.value}`,
              check.message ?? `expected a number <= ${check.value}`,
              { maximum: check.value as number, inclusive: true }
            );
            break;
          case "moreThan":
            emitter.failIf(
              `${value} <= ${emitLiteral(check.value as number)}`,
              path,
              "too_small",
              `> ${check.value}`,
              check.message ?? `expected a number > ${check.value}`,
              { minimum: check.value as number, inclusive: false }
            );
            break;
          case "lessThan":
            emitter.failIf(
              `${value} >= ${emitLiteral(check.value as number)}`,
              path,
              "too_big",
              `< ${check.value}`,
              check.message ?? `expected a number < ${check.value}`,
              { maximum: check.value as number, inclusive: false }
            );
            break;
          case "oneOf": {
            const values = (check.value as readonly number[] | undefined) ?? [];
            const test = values.map((option) => `${value} !== ${emitLiteral(option)}`).join(" && ");

            emitter.failIf(
              values.length === 0 ? "true" : test,
              path,
              "invalid_enum",
              values.map((option) => String(option)).join(" | "),
              check.message ?? "expected one of the allowed values"
            );
            break;
          }
          case "positive":
            emitter.failIf(`${value} <= 0`, path, "not_positive", "> 0", check.message ?? "expected a positive number");
            break;
          case "negative":
            emitter.failIf(`${value} >= 0`, path, "not_negative", "< 0", check.message ?? "expected a negative number");
            break;
          case "finite":
            emitter.failIf(
              `!Number.isFinite(${value})`,
              path,
              "not_finite",
              "finite",
              check.message ?? "expected a finite number"
            );
            break;
          case "safe":
            emitter.failIf(
              `!Number.isSafeInteger(${value})`,
              path,
              "not_safe",
              "safe integer",
              check.message ?? "expected a safe integer"
            );
            break;
          case "int32":
            emitter.failIf(
              `(${value} | 0) !== ${value}`,
              path,
              "not_int32",
              "int32",
              check.message ?? "expected a 32-bit signed integer"
            );
            break;
          case "float32":
            emitter.failIf(
              `!Number.isFinite(${value}) || Math.fround(${value}) !== ${value}`,
              path,
              "not_float32",
              "float32",
              check.message ?? "expected a float32-representable number"
            );
            break;
          case "float64":
            emitter.failIf(
              `!Number.isFinite(${value})`,
              path,
              "not_float64",
              "float64",
              check.message ?? "expected a finite float64 number"
            );
            break;
          case "multipleOf":
            emitter.failIf(
              `${value} % ${emitLiteral(check.value as number)} !== 0`,
              path,
              "not_multiple_of",
              `multiple of ${check.value}`,
              check.message ?? `expected a multiple of ${check.value}`,
              { multipleOf: check.value as number }
            );
            break;
          default:
            break;
        }
      }
    },
    `typeof ${value}`
  );

  return value;
}
