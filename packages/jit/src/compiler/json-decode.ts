import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITValidationError } from "../errors/index.js";
import { Regexes } from "../shared/index.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { emitSanitizeChain } from "./sanitize.js";
import { countFormatPlaceholders, emitFormatMaskExpression, emitStrictFormatCondition } from "./source/format-mask.js";
import { needsBuild } from "./validate/emit-validate.js";

type AnySchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };

interface SchemaCheckRecord {
  readonly kind: string;
  readonly value?: unknown;
  readonly message?: string;
}

/** A schema-directed JSON decoder which validates while consuming tokens. */
export interface EmittedJsonDecoder {
  readonly source: string;
  readonly bindingNames: readonly string[];
  readonly bindingValues: readonly unknown[];
  readonly backend: "schema-directed";
}

export interface JsonDecoderSupport {
  readonly supported: boolean;
  readonly reason?: string;
}

/** Explains whether the schema can use the single-pass decoder without changing parse semantics. */
export function jsonDecoderSupport(schema: ATS.AnyTypeSchema): JsonDecoderSupport {
  const reason = unsupportedReason(schema, new Set());

  return reason === undefined ? { supported: true } : { supported: false, reason };
}

/** Emits a JSON scanner specialized for `schema`, or `undefined` when a lossless lowering is unavailable. */
export function tryEmitJsonDecoder(schema: ATS.AnyTypeSchema): EmittedJsonDecoder | undefined {
  if (!jsonDecoderSupport(schema).supported) return undefined;
  return new JsonDecoderEmitter(schema).emit();
}

/** Compiles the schema-directed decoder when the schema has a lossless lowering. */
export function tryCompileJsonDecoder<T>(schema: ATS.AnyTypeSchema): ((json: string) => T) | undefined {
  const emitted = tryEmitJsonDecoder(schema);

  if (!emitted) return undefined;
  const decode = globalThis.Function(
    ...emitted.bindingNames,
    `return (${emitted.source});`
  )(...emitted.bindingValues) as (json: string) => T;

  return (json) => {
    try {
      return decode(json);
    } catch (error) {
      if (Array.isArray(error)) throw new JITValidationError(error);
      throw error;
    }
  };
}

class JsonDecoderEmitter {
  private readonly bindingNames: string[] = [];
  private readonly bindingValues: unknown[] = [];
  private readonly bindingIds = new Map<unknown, string>();
  private readonly parserNames = new Map<ATS.AnyTypeSchema, string>();
  private readonly parserSources: string[] = [];

  constructor(private readonly schema: ATS.AnyTypeSchema) {}

  emit(): EmittedJsonDecoder {
    const root = this.parser(this.schema);
    const freeze = rootHasReadonly(this.schema)
      ? 'if (value !== null && (typeof value === "object" || typeof value === "function")) value = Object.freeze(value);'
      : "";
    const source = `(() => {
${JSON_RUNTIME_SOURCE}
${this.parserSources.join("\n")}
return function decode(input) {
  input = String(input);
  const state = { i: 0 };
  const issues = [];
  let value = ${root}(input, state, "", issues);
  ws(input, state);
  if (state.i !== input.length) syntax(state, "unexpected trailing token");
  if (issues.length !== 0) throw issues;
  ${freeze}
  return value;
};
})()`;

    return {
      source,
      bindingNames: this.bindingNames,
      bindingValues: this.bindingValues,
      backend: "schema-directed",
    };
  }

  private bind(value: unknown): string {
    const existing = this.bindingIds.get(value);

    if (existing) return existing;
    const name = `__j${this.bindingNames.length}`;

    this.bindingNames.push(name);
    this.bindingValues.push(value);
    this.bindingIds.set(value, name);
    return name;
  }

  private parser(schema: ATS.AnyTypeSchema): string {
    const existing = this.parserNames.get(schema);

    if (existing) return existing;
    const name = `jp${this.parserNames.size}`;
    const writer = new CodeWriter();
    const current = schema as AnySchema;

    this.parserNames.set(schema, name);
    writer.line(`function ${name}(input, state, path, issues) {`);
    writer.indent(() => {
      switch (current.type) {
        case TypeName.optional:
        case TypeName.default:
        case TypeName.brand:
        case TypeName.readonly:
          writer.line(`return ${this.parser(current.def.innerType as ATS.AnyTypeSchema)}(input, state, path, issues);`);
          break;
        case TypeName.lazy:
          writer.line(
            `return ${this.parser((current.def.getter as () => ATS.AnyTypeSchema)())}(input, state, path, issues);`
          );
          break;
        case TypeName.nullable:
        case TypeName.nullish:
          this.emitNullable(writer, current);
          break;
        case TypeName.string:
          this.emitString(writer, current);
          break;
        case TypeName.number:
        case TypeName.int:
          this.emitNumber(writer, current, current.type === TypeName.int);
          break;
        case TypeName.boolean:
          this.emitBoolean(writer);
          break;
        case TypeName.null:
          this.emitNull(writer);
          break;
        case TypeName.literal:
          this.emitLiteral(writer, current);
          break;
        case TypeName.enum:
          this.emitEnum(writer, current);
          break;
        case TypeName.array:
          this.emitArray(writer, current);
          break;
        case TypeName.tuple:
          this.emitTuple(writer, current);
          break;
        case TypeName.object:
          this.emitObject(writer, current);
          break;
        case TypeName.record:
          this.emitRecord(writer, current);
          break;
        case TypeName.json:
          writer.line("return any(input, state, issues, path);");
          break;
        case TypeName.any:
        case TypeName.unknown:
          writer.line("return any(input, state);");
          break;
        default:
          throw new Error(`unsupported JSON decoder schema ${current.type}`);
      }
    });
    writer.line("}");
    this.parserSources.push(writer.toString());
    return name;
  }

  private emitNullable(writer: CodeWriter, schema: AnySchema): void {
    const inner = this.parser(schema.def.innerType as ATS.AnyTypeSchema);

    writer.line("ws(input, state);");
    writer.line("if (input.charCodeAt(state.i) === 110) { readNull(input, state); return null; }");
    writer.line(`return ${inner}(input, state, path, issues);`);
  }

  private emitString(writer: CodeWriter, schema: AnySchema): void {
    const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];

    writer.line("ws(input, state);");
    writer.line("if (input.charCodeAt(state.i) !== 34) {");
    writer.indent(() => {
      writer.line('mismatch(input, state, issues, path, "expected_string", "string", ');
      writer.line(`  ${literal(requiredMessage(schema, "expected string"))});`);
      writer.line("return undefined;");
    });
    writer.line("}");
    writer.line("let value = string(input, state);");

    for (const check of checks) {
      if (check.kind === "trim") writer.line("value = value.trim();");
      if (check.kind === "normalize") {
        writer.line(
          typeof check.value === "string"
            ? `value = value.normalize(${literal(check.value)});`
            : "value = value.normalize();"
        );
      }
      if (check.kind === "lowercase") writer.line("value = value.toLowerCase();");
      if (check.kind === "uppercase") writer.line("value = value.toUpperCase();");
      if (check.kind === "sanitize") {
        writer.line(
          `value = ${emitSanitizeChain("value", check.value as ATS.StringSanitizeSpec | undefined, (pattern) => this.bind(pattern))};`
        );
      }
      if (check.kind === "format") {
        const spec = check.value as ATS.StringMaskSpec;
        const length = countFormatPlaceholders(spec.pattern);

        if (spec.mode === "strict") {
          this.issueIf(
            writer,
            emitStrictFormatCondition("value", spec.pattern),
            "invalid_format",
            spec.pattern,
            check.message ?? `expected the ${spec.pattern} format`
          );
        } else {
          if (spec.stripNonDigits) writer.line('value = value.replace(/\\D+/g, "");');
          this.issueIf(
            writer,
            `value.length !== ${length}`,
            "invalid_format",
            `length === ${length}`,
            check.message ?? `expected ${length} characters before formatting`
          );
        }
      }
      if (check.kind === "phoneBR") {
        writer.line('value = value.replace(/\\D+/g, "");');
        this.issueIf(
          writer,
          "value.length !== 10 && value.length !== 11",
          "invalid_format",
          "Brazilian phone with 10 or 11 digits",
          check.message ?? "expected a Brazilian phone number"
        );
      }
    }

    for (const check of checks) this.emitStringCheck(writer, check);
    for (const check of checks) {
      if (check.kind === "format") {
        const spec = check.value as ATS.StringMaskSpec;

        if (spec.mode === "transform") {
          const length = countFormatPlaceholders(spec.pattern);

          writer.line(`if (value.length === ${length}) {`);
          writer.indent(() => {
            writer.line(`value = ${emitFormatMaskExpression("value", spec.pattern)};`);
          });
          writer.line("}");
        }
      }
      if (check.kind === "phoneBR") {
        writer.line("if (value.length === 10) {");
        writer.indent(() => {
          writer.line(`value = ${emitFormatMaskExpression("value", "(##) ####-####")};`);
        });
        writer.line("} else if (value.length === 11) {");
        writer.indent(() => {
          writer.line(`value = ${emitFormatMaskExpression("value", "(##) #####-####")};`);
        });
        writer.line("}");
      }
    }
    writer.line("return value;");
  }

  private emitStringCheck(writer: CodeWriter, check: SchemaCheckRecord): void {
    switch (check.kind) {
      case "trim":
      case "normalize":
      case "lowercase":
      case "uppercase":
      case "sanitize":
      case "format":
      case "phoneBR":
        return;
      case "min":
        this.issueIf(
          writer,
          `value.length < ${literal(check.value)}`,
          "too_small",
          `length >= ${String(check.value)}`,
          check.message ?? `expected at least ${String(check.value)} characters`
        );
        return;
      case "max":
        this.issueIf(
          writer,
          `value.length > ${literal(check.value)}`,
          "too_big",
          `length <= ${String(check.value)}`,
          check.message ?? `expected at most ${String(check.value)} characters`
        );
        return;
      case "length":
        this.issueIf(
          writer,
          `value.length !== ${literal(check.value)}`,
          "invalid_length",
          `length === ${String(check.value)}`,
          check.message ?? `expected exactly ${String(check.value)} characters`
        );
        return;
      case "oneOf": {
        const values = (check.value as readonly string[] | undefined) ?? [];
        const condition =
          values.length === 0 ? "true" : values.map((value) => `value !== ${literal(value)}`).join(" && ");

        this.issueIf(
          writer,
          condition,
          "invalid_enum",
          values.join(" | "),
          check.message ?? "expected one of the allowed values"
        );
        return;
      }
      case "startsWith":
        this.issueIf(
          writer,
          `!value.startsWith(${literal(check.value)})`,
          "invalid_string",
          `startsWith ${String(check.value)}`,
          check.message ?? `expected string to start with ${String(check.value)}`
        );
        return;
      case "endsWith":
        this.issueIf(
          writer,
          `!value.endsWith(${literal(check.value)})`,
          "invalid_string",
          `endsWith ${String(check.value)}`,
          check.message ?? `expected string to end with ${String(check.value)}`
        );
        return;
      case "includes":
        this.issueIf(
          writer,
          `!value.includes(${literal(check.value)})`,
          "invalid_string",
          `includes ${String(check.value)}`,
          check.message ?? `expected string to include ${String(check.value)}`
        );
        return;
      case "digitsLength": {
        const values = Array.isArray(check.value) ? (check.value as readonly number[]) : [check.value as number];
        const condition =
          values.length === 0 ? "true" : values.map((value) => `value.length !== ${value}`).join(" && ");

        this.issueIf(
          writer,
          condition,
          "invalid_length",
          values.map((value) => `length === ${value}`).join(" | "),
          check.message ?? `expected ${values.join(" or ")} digits`
        );
        return;
      }
      case "url":
        writer.line("let validUrl = true;");
        writer.line("try { new URL(value); } catch { validUrl = false; }");
        this.issueIf(writer, "!validUrl", "invalid_format", "url", check.message ?? "expected a valid URL");
        return;
      case "httpUrl":
        writer.line("let validHttpUrl = true;");
        writer.line(
          'try { const parsedUrl = new URL(value); validHttpUrl = parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:"; } catch { validHttpUrl = false; }'
        );
        this.issueIf(
          writer,
          "!validHttpUrl",
          "invalid_format",
          "httpUrl",
          check.message ?? "expected a valid HTTP(S) URL"
        );
        return;
      case "regex":
        this.regexIssue(writer, check.value, "regex", check.message ?? "expected the value to match the pattern");
        return;
      case "email":
        this.regexIssue(
          writer,
          check.value instanceof RegExp ? check.value : Regexes.email,
          "email",
          check.message ?? "expected a valid email"
        );
        return;
      case "uuid":
        this.regexIssue(
          writer,
          check.value instanceof RegExp ? check.value : Regexes.uuid(),
          "uuid",
          check.message ?? "expected a valid uuid"
        );
        return;
      case "stringFormat": {
        const spec = check.value as {
          readonly name: string;
          readonly pattern: RegExp;
        };

        this.regexIssue(writer, spec.pattern, spec.name, check.message ?? `expected a valid ${spec.name}`);
        return;
      }
      default:
        if (check.value instanceof RegExp) {
          this.regexIssue(writer, check.value, check.kind, check.message ?? `expected a valid ${check.kind}`);
        }
    }
  }

  private regexIssue(writer: CodeWriter, regex: unknown, expected: string, message: string): void {
    const binding = this.bind(regex);

    this.issueIf(writer, `!${binding}.test(value)`, "invalid_format", expected, message);
  }

  private emitNumber(writer: CodeWriter, schema: AnySchema, forceInteger: boolean): void {
    const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];

    writer.line("ws(input, state);");
    writer.line("const code = input.charCodeAt(state.i);");
    writer.line("if (code !== 45 && (code < 48 || code > 57)) {");
    writer.indent(() => {
      writer.line(
        `mismatch(input, state, issues, path, "expected_number", "number", ${literal(requiredMessage(schema, "expected number"))});`
      );
      writer.line("return undefined;");
    });
    writer.line("}");
    writer.line("const value = number(input, state);");
    const integerCheck = checks.find((check) => check.kind === "integer");

    if (forceInteger || integerCheck) {
      this.issueIf(
        writer,
        "!Number.isInteger(value)",
        "not_integer",
        "integer",
        integerCheck?.message ?? "expected an integer"
      );
    }
    for (const check of checks) this.emitNumberCheck(writer, check);
    writer.line("return value;");
  }

  private emitNumberCheck(writer: CodeWriter, check: SchemaCheckRecord): void {
    switch (check.kind) {
      case "integer":
        return;
      case "min":
        this.issueIf(
          writer,
          `value < ${literal(check.value)}`,
          "too_small",
          `>= ${String(check.value)}`,
          check.message ?? `expected a number >= ${String(check.value)}`
        );
        return;
      case "max":
        this.issueIf(
          writer,
          `value > ${literal(check.value)}`,
          "too_big",
          `<= ${String(check.value)}`,
          check.message ?? `expected a number <= ${String(check.value)}`
        );
        return;
      case "moreThan":
        this.issueIf(
          writer,
          `value <= ${literal(check.value)}`,
          "too_small",
          `> ${String(check.value)}`,
          check.message ?? `expected a number > ${String(check.value)}`
        );
        return;
      case "lessThan":
        this.issueIf(
          writer,
          `value >= ${literal(check.value)}`,
          "too_big",
          `< ${String(check.value)}`,
          check.message ?? `expected a number < ${String(check.value)}`
        );
        return;
      case "oneOf": {
        const values = (check.value as readonly number[] | undefined) ?? [];
        const condition =
          values.length === 0 ? "true" : values.map((value) => `value !== ${literal(value)}`).join(" && ");

        this.issueIf(
          writer,
          condition,
          "invalid_enum",
          values.join(" | "),
          check.message ?? "expected one of the allowed values"
        );
        return;
      }
      case "positive":
        this.issueIf(writer, "value <= 0", "not_positive", "> 0", check.message ?? "expected a positive number");
        return;
      case "negative":
        this.issueIf(writer, "value >= 0", "not_negative", "< 0", check.message ?? "expected a negative number");
        return;
      case "finite":
        this.issueIf(
          writer,
          "!Number.isFinite(value)",
          "not_finite",
          "finite",
          check.message ?? "expected a finite number"
        );
        return;
      case "safe":
        this.issueIf(
          writer,
          "!Number.isSafeInteger(value)",
          "not_safe",
          "safe integer",
          check.message ?? "expected a safe integer"
        );
        return;
      case "int32":
        this.issueIf(
          writer,
          "!Number.isInteger(value) || value < -2147483648 || value > 2147483647",
          "not_int32",
          "int32",
          check.message ?? "expected a 32-bit signed integer"
        );
        return;
      case "float32":
        this.issueIf(
          writer,
          "!Number.isFinite(value) || Math.fround(value) !== value",
          "not_float32",
          "float32",
          check.message ?? "expected a float32-representable number"
        );
        return;
      case "float64":
        this.issueIf(
          writer,
          "!Number.isFinite(value)",
          "not_float64",
          "float64",
          check.message ?? "expected a finite float64 number"
        );
        return;
      case "multipleOf":
        this.issueIf(
          writer,
          `value % ${literal(check.value)} !== 0`,
          "not_multiple_of",
          `multiple of ${String(check.value)}`,
          check.message ?? `expected a multiple of ${String(check.value)}`
        );
    }
  }

  private emitBoolean(writer: CodeWriter): void {
    writer.line("ws(input, state);");
    writer.line('if (input.startsWith("true", state.i)) { state.i += 4; return true; }');
    writer.line('if (input.startsWith("false", state.i)) { state.i += 5; return false; }');
    writer.line("any(input, state);");
    writer.line('issue(issues, path, "expected_boolean", "boolean", "expected boolean");');
    writer.line("return undefined;");
  }

  private emitNull(writer: CodeWriter): void {
    writer.line("ws(input, state);");
    writer.line("if (input.charCodeAt(state.i) === 110) { readNull(input, state); return null; }");
    writer.line("any(input, state);");
    writer.line('issue(issues, path, "invalid_type", "null", "expected null");');
    writer.line("return undefined;");
  }

  private emitLiteral(writer: CodeWriter, schema: AnySchema): void {
    const expected = schema.def.value;

    writer.line("const value = any(input, state);");
    this.issueIf(
      writer,
      `value !== ${literal(expected)}`,
      "invalid_literal",
      String(expected),
      `expected literal ${String(expected)}`
    );
    writer.line("return value;");
  }

  private emitEnum(writer: CodeWriter, schema: AnySchema): void {
    const values = Object.values(schema.def.values as Record<string, string | number>);
    const condition = values.length === 0 ? "true" : values.map((value) => `value !== ${literal(value)}`).join(" && ");

    writer.line("const value = any(input, state);");
    this.issueIf(writer, condition, "invalid_enum", values.join(" | "), "expected one of the enum values");
    writer.line("return value;");
  }

  private emitArray(writer: CodeWriter, schema: AnySchema): void {
    const element = this.parser(schema.def.element as ATS.AnyTypeSchema);
    const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];

    writer.line("ws(input, state);");
    writer.line("if (input.charCodeAt(state.i) !== 91) {");
    writer.indent(() => {
      writer.line('mismatch(input, state, issues, path, "expected_array", "array", "expected array");');
      writer.line("return undefined;");
    });
    writer.line("}");
    writer.line("state.i++;");
    writer.line("const value = [];");
    writer.line("let index = 0;");
    writer.line("ws(input, state);");
    writer.line("if (input.charCodeAt(state.i) !== 93) {");
    writer.indent(() => {
      writer.line("for (;;) {");
      writer.indent(() => {
        writer.line(`value[index] = ${element}(input, state, path + "[" + index + "]", issues);`);
        writer.line("index++;");
        writer.line("ws(input, state);");
        writer.line("const separator = input.charCodeAt(state.i++);");
        writer.line("if (separator === 93) break;");
        writer.line('if (separator !== 44) syntax(state, "expected comma or closing bracket");');
      });
      writer.line("}");
    });
    writer.line("} else state.i++;");
    for (const check of checks) this.emitArrayCheck(writer, check);
    writer.line("return value;");
  }

  private emitArrayCheck(writer: CodeWriter, check: SchemaCheckRecord): void {
    switch (check.kind) {
      case "min":
        this.issueIf(
          writer,
          `value.length < ${literal(check.value)}`,
          "too_small",
          `length >= ${String(check.value)}`,
          check.message ?? `expected at least ${String(check.value)} items`
        );
        break;
      case "max":
        this.issueIf(
          writer,
          `value.length > ${literal(check.value)}`,
          "too_big",
          `length <= ${String(check.value)}`,
          check.message ?? `expected at most ${String(check.value)} items`
        );
        break;
      case "length":
        this.issueIf(
          writer,
          `value.length !== ${literal(check.value)}`,
          "invalid_length",
          `length === ${String(check.value)}`,
          check.message ?? `expected exactly ${String(check.value)} items`
        );
        break;
      case "nonEmpty":
        this.issueIf(
          writer,
          "value.length === 0",
          "too_small",
          "length >= 1",
          check.message ?? "expected a non-empty array"
        );
        break;
    }
  }

  private emitTuple(writer: CodeWriter, schema: AnySchema): void {
    const items = (schema.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];
    const parsers = items.map((item) => this.parser(item));
    const restSchema = schema.def.rest as ATS.AnyTypeSchema | undefined;
    const rest = restSchema ? this.parser(restSchema) : undefined;

    writer.line("ws(input, state);");
    writer.line("if (input.charCodeAt(state.i) !== 91) {");
    writer.indent(() => {
      writer.line('mismatch(input, state, issues, path, "expected_array", "tuple", "expected tuple");');
      writer.line("return undefined;");
    });
    writer.line("}");
    writer.line("state.i++;");
    writer.line("const value = [];");
    writer.line("let index = 0;");
    writer.line("ws(input, state);");
    writer.line("if (input.charCodeAt(state.i) !== 93) {");
    writer.indent(() => {
      writer.line("for (;;) {");
      writer.indent(() => {
        if (parsers.length > 0) {
          writer.line("switch (index) {");
          writer.indent(() => {
            parsers.forEach((parser, index) => {
              writer.line(`case ${index}: value[index] = ${parser}(input, state, path + "[${index}]", issues); break;`);
            });
            writer.line(
              `default: value[index] = ${rest ? `${rest}(input, state, path + "[" + index + "]", issues)` : "any(input, state)"};`
            );
          });
          writer.line("}");
        } else {
          writer.line(
            `value[index] = ${rest ? `${rest}(input, state, path + "[" + index + "]", issues)` : "any(input, state)"};`
          );
        }
        writer.line("index++;");
        writer.line("ws(input, state);");
        writer.line("const separator = input.charCodeAt(state.i++);");
        writer.line("if (separator === 93) break;");
        writer.line('if (separator !== 44) syntax(state, "expected comma or closing bracket");');
      });
      writer.line("}");
    });
    writer.line("} else state.i++;");
    const lengthCondition = rest ? `value.length < ${items.length}` : `value.length !== ${items.length}`;
    const expected = rest ? `length >= ${items.length}` : `length === ${items.length}`;
    const message = rest ? `expected at least ${items.length} items` : `expected exactly ${items.length} items`;

    this.issueIf(writer, lengthCondition, "invalid_length", expected, message);
    parsers.forEach((_, index) => {
      const missing = missingValue(items[index], this.bind.bind(this));

      if (missing.kind === "default") {
        writer.line(`if (value.length <= ${index}) value[${index}] = ${missing.expression};`);
      } else if (missing.kind === "required") {
        writer.line(`if (value.length <= ${index}) ${this.missingIssue(items[index], `path + "[${index}]"`)};`);
      }
    });
    writer.line("return value;");
  }

  private emitObject(writer: CodeWriter, schema: AnySchema): void {
    const props = schema.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;
    const keys = Object.keys(props);
    const parsers = keys.map((key) => this.parser(props[key]));
    const unknownKeys = schema.def.unknownKeys as "strip" | "passthrough" | "strict" | undefined;
    const catchallSchema = schema.def.catchall as ATS.AnyTypeSchema | undefined;
    const catchall = catchallSchema ? this.parser(catchallSchema) : undefined;
    const rebuildKnown = needsBuild(schema) && unknownKeys !== "passthrough" && catchall === undefined;
    const preserveUnknown =
      unknownKeys === "passthrough" || catchall !== undefined || (!needsBuild(schema) && unknownKeys !== "strip");

    writer.line("ws(input, state);");
    writer.line("if (input.charCodeAt(state.i) !== 123) {");
    writer.indent(() => {
      writer.line('mismatch(input, state, issues, path, "expected_object", "object", "expected object");');
      writer.line("return undefined;");
    });
    writer.line("}");
    writer.line("state.i++;");
    writer.line("const value = {};");
    writer.line("let expectedKey = 0;");
    keys.forEach((_, index) => {
      writer.line(`let seen${index} = false, field${index};`);
    });
    if (unknownKeys === "strict") writer.line("const seenUnknown = {};");
    writer.line("ws(input, state);");
    writer.line("if (input.charCodeAt(state.i) !== 125) {");
    writer.indent(() => {
      writer.line("for (;;) {");
      writer.indent(() => {
        writer.line("ws(input, state);");
        writer.line("let handled = false;");
        if (keys.length > 0) {
          keys.forEach((key, index) => {
            const token = `${JSON.stringify(key)}:`;
            const childPath = `path + (path ? "." : "") + ${literal(key)}`;

            writer.line(
              `${index === 0 ? "if" : "else if"} (expectedKey === ${index} && input.startsWith(${literal(token)}, state.i)) {`
            );
            writer.indent(() => {
              writer.line(`state.i += ${token.length};`);
              writer.line(`expectedKey = ${index + 1};`);
              writer.line(`if (seen${index}) drop(issues, ${childPath});`);
              writer.line(`seen${index} = true;`);
              writer.line(`field${index} = ${parsers[index]}(input, state, ${childPath}, issues);`);
              if (!rebuildKnown) {
                writer.line(`set(value, ${literal(key)}, field${index});`);
              }
              writer.line("handled = true;");
            });
            writer.line("}");
          });
        }
        writer.line("if (!handled) {");
        writer.indent(() => {
          writer.line("let key;");
          writer.line('if (input.charCodeAt(state.i) !== 34) syntax(state, "expected object key");');
          writer.line("key = string(input, state);");
          writer.line("ws(input, state);");
          writer.line('if (input.charCodeAt(state.i++) !== 58) syntax(state, "expected colon");');
          writer.line("switch (key) {");
          writer.indent(() => {
            keys.forEach((key, index) => {
              const childPath = `path + (path ? "." : "") + ${literal(key)}`;

              writer.line(`case ${literal(key)}:`);
              writer.indent(() => {
                writer.line(`expectedKey = ${index + 1};`);
                writer.line(`if (seen${index}) drop(issues, ${childPath});`);
                writer.line(`seen${index} = true;`);
                writer.line(`field${index} = ${parsers[index]}(input, state, ${childPath}, issues);`);
                if (!rebuildKnown) {
                  writer.line(`set(value, ${literal(key)}, field${index});`);
                }
                writer.line("break;");
              });
            });
            writer.line("default:");
            writer.indent(() => {
              if (unknownKeys === "strict") {
                writer.line('const unknownPath = path + (path ? "." : "") + key;');
                writer.line("if (Object.prototype.hasOwnProperty.call(seenUnknown, key)) drop(issues, unknownPath);");
                writer.line("set(seenUnknown, key, true);");
                writer.line("const unknown = any(input, state);");
                writer.line(
                  'issue(issues, unknownPath, "unknown_key", "known keys only", "object contains unknown keys");'
                );
                if (preserveUnknown) writer.line("set(value, key, unknown);");
              } else if (catchall) {
                writer.line(
                  'const unknownPath = path + (path ? "." : "") + key; if (Object.prototype.hasOwnProperty.call(value, key)) drop(issues, unknownPath);'
                );
                writer.line(`set(value, key, ${catchall}(input, state, unknownPath, issues));`);
              } else if (preserveUnknown) {
                writer.line("set(value, key, any(input, state));");
              } else {
                writer.line("any(input, state);");
              }
              writer.line("break;");
            });
          });
          writer.line("}");
        });
        writer.line("}");
        writer.line("ws(input, state);");
        writer.line("const separator = input.charCodeAt(state.i++);");
        writer.line("if (separator === 125) break;");
        writer.line('if (separator !== 44) syntax(state, "expected comma or closing brace");');
      });
      writer.line("}");
    });
    writer.line("} else state.i++;");

    keys.forEach((key, index) => {
      const childPath = `path + (path ? "." : "") + ${literal(key)}`;
      const missing = missingValue(props[key], this.bind.bind(this));

      writer.line(`if (!seen${index}) {`);
      writer.indent(() => {
        if (missing.kind === "default") {
          writer.line(`field${index} = ${missing.expression};`);
          writer.line(`seen${index} = true;`);
          if (!rebuildKnown) writer.line(`set(value, ${literal(key)}, field${index});`);
        } else if (missing.kind === "required") {
          writer.line(this.missingIssue(props[key], childPath));
        }
      });
      writer.line("}");
    });

    if (rebuildKnown) {
      keys.forEach((key, index) => {
        writer.line(`if (seen${index}) set(value, ${literal(key)}, field${index});`);
      });
    }
    writer.line("return value;");
  }

  private emitRecord(writer: CodeWriter, schema: AnySchema): void {
    const valueParser = this.parser(schema.def.value as ATS.AnyTypeSchema);

    writer.line("ws(input, state);");
    writer.line("if (input.charCodeAt(state.i) !== 123) {");
    writer.indent(() => {
      writer.line('mismatch(input, state, issues, path, "expected_object", "record", "expected a plain object");');
      writer.line("return undefined;");
    });
    writer.line("}");
    writer.line("state.i++;");
    writer.line("const value = {};");
    writer.line("ws(input, state);");
    writer.line("if (input.charCodeAt(state.i) !== 125) {");
    writer.indent(() => {
      writer.line("for (;;) {");
      writer.indent(() => {
        writer.line("ws(input, state);");
        writer.line('if (input.charCodeAt(state.i) !== 34) syntax(state, "expected object key");');
        writer.line("const key = string(input, state);");
        writer.line("ws(input, state);");
        writer.line('if (input.charCodeAt(state.i++) !== 58) syntax(state, "expected colon");');
        writer.line('const childPath = path + (path ? "." : "") + key;');
        writer.line("if (Object.prototype.hasOwnProperty.call(value, key)) drop(issues, childPath);");
        writer.line(`set(value, key, ${valueParser}(input, state, childPath, issues));`);
        writer.line("ws(input, state);");
        writer.line("const separator = input.charCodeAt(state.i++);");
        writer.line("if (separator === 125) break;");
        writer.line('if (separator !== 44) syntax(state, "expected comma or closing brace");');
      });
      writer.line("}");
    });
    writer.line("} else state.i++;");
    writer.line("return value;");
  }

  private issueIf(writer: CodeWriter, condition: string, code: string, expected: string, message: string): void {
    writer.line(`if (${condition}) issue(issues, path, ${literal(code)}, ${literal(expected)}, ${literal(message)});`);
  }

  private missingIssue(schema: ATS.AnyTypeSchema, path: string): string {
    const failure = missingFailure(schema);

    return `issue(issues, ${path}, ${literal(failure.code)}, ${literal(failure.expected)}, ${literal(failure.message)}, ${failure.received ? literal(failure.received) : "undefined"})`;
  }
}

function unsupportedReason(schema: ATS.AnyTypeSchema, seen: Set<ATS.AnyTypeSchema>): string | undefined {
  if (seen.has(schema)) return undefined;
  seen.add(schema);
  const current = schema as AnySchema;

  switch (current.type) {
    case TypeName.string: {
      if (current.def.coerce === true) return "coercive string schemas require the generic validator";
      const checks = (current.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];
      const unsupported = checks.find((check) => ["noEmpty", "normalize"].includes(check.kind));

      return unsupported ? `string check ${unsupported.kind} has no schema-directed JSON lowering yet` : undefined;
    }
    case TypeName.number:
    case TypeName.int:
    case TypeName.boolean:
      return current.def.coerce === true ? `coercive ${current.type} schemas require the generic validator` : undefined;
    case TypeName.null:
    case TypeName.json:
    case TypeName.any:
    case TypeName.unknown:
      return undefined;
    case TypeName.literal: {
      const value = current.def.value;

      return isJsonPrimitive(value) ? undefined : "only JSON primitive literals can be decoded directly";
    }
    case TypeName.enum:
      return Object.values(current.def.values as Record<string, unknown>).every(isJsonPrimitive)
        ? undefined
        : "only JSON primitive enum values can be decoded directly";
    case TypeName.optional:
    case TypeName.nullable:
    case TypeName.nullish:
    case TypeName.default:
    case TypeName.brand:
    case TypeName.readonly:
      return unsupportedReason(current.def.innerType as ATS.AnyTypeSchema, seen);
    case TypeName.lazy:
      return unsupportedReason((current.def.getter as () => ATS.AnyTypeSchema)(), seen);
    case TypeName.array:
      return unsupportedReason(current.def.element as ATS.AnyTypeSchema, seen);
    case TypeName.tuple: {
      const items = (current.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];

      for (const item of items) {
        const reason = unsupportedReason(item, seen);

        if (reason) return reason;
      }
      return current.def.rest ? unsupportedReason(current.def.rest as ATS.AnyTypeSchema, seen) : undefined;
    }
    case TypeName.record:
      return unsupportedReason(current.def.value as ATS.AnyTypeSchema, seen);
    case TypeName.object: {
      const checks = (current.def.checks as readonly unknown[] | undefined) ?? [];

      if (checks.length !== 0) return "object checks have no schema-directed JSON lowering yet";
      const props = current.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;

      for (const key of Object.keys(props)) {
        const reason = unsupportedReason(props[key], seen);

        if (reason) return `${key}: ${reason}`;
      }
      return current.def.catchall ? unsupportedReason(current.def.catchall as ATS.AnyTypeSchema, seen) : undefined;
    }
    default:
      return `${current.type} schemas require the generic JSON.parse + validator fallback`;
  }
}

function isJsonPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

type MissingValue =
  | { readonly kind: "optional" }
  | { readonly kind: "required" }
  | { readonly kind: "default"; readonly expression: string };

function missingValue(
  schema: ATS.AnyTypeSchema,
  bind: (value: unknown) => string,
  seen = new Set<ATS.AnyTypeSchema>()
): MissingValue {
  if (seen.has(schema)) return { kind: "required" };
  seen.add(schema);
  const current = schema as AnySchema;

  switch (current.type) {
    case TypeName.optional:
    case TypeName.nullish:
      return { kind: "optional" };
    case TypeName.default: {
      const value = current.def.defaultValue;
      const binding = bind(value);

      return {
        kind: "default",
        expression: typeof value === "function" ? `${binding}()` : binding,
      };
    }
    case TypeName.nullable:
    case TypeName.brand:
    case TypeName.readonly:
      return missingValue(current.def.innerType as ATS.AnyTypeSchema, bind, seen);
    case TypeName.lazy:
      return missingValue((current.def.getter as () => ATS.AnyTypeSchema)(), bind, seen);
    default:
      return { kind: "required" };
  }
}

interface MissingFailure {
  readonly code: string;
  readonly expected: string;
  readonly message: string;
  readonly received?: string;
}

function missingFailure(schema: ATS.AnyTypeSchema, seen = new Set<ATS.AnyTypeSchema>()): MissingFailure {
  if (seen.has(schema))
    return {
      code: "invalid_type",
      expected: "value",
      message: "expected value",
    };
  seen.add(schema);
  const current = schema as AnySchema;

  switch (current.type) {
    case TypeName.optional:
    case TypeName.nullish:
      return {
        code: "invalid_type",
        expected: "value",
        message: "expected value",
      };
    case TypeName.default:
    case TypeName.nullable:
    case TypeName.brand:
    case TypeName.readonly:
      return missingFailure(current.def.innerType as ATS.AnyTypeSchema, seen);
    case TypeName.lazy:
      return missingFailure((current.def.getter as () => ATS.AnyTypeSchema)(), seen);
    case TypeName.string:
      return {
        code: "expected_string",
        expected: "string",
        message: requiredMessage(current, "expected string"),
        received: "undefined",
      };
    case TypeName.number:
    case TypeName.int:
      return {
        code: "expected_number",
        expected: "number",
        message: requiredMessage(current, "expected number"),
        received: "undefined",
      };
    case TypeName.boolean:
      return {
        code: "expected_boolean",
        expected: "boolean",
        message: "expected boolean",
      };
    case TypeName.null:
      return {
        code: "invalid_type",
        expected: "null",
        message: "expected null",
      };
    case TypeName.literal: {
      const value = current.def.value;

      return {
        code: "invalid_literal",
        expected: String(value),
        message: `expected literal ${String(value)}`,
      };
    }
    case TypeName.enum: {
      const values = Object.values(current.def.values as Record<string, unknown>);

      return {
        code: "invalid_enum",
        expected: values.join(" | "),
        message: "expected one of the enum values",
      };
    }
    case TypeName.array:
      return {
        code: "expected_array",
        expected: "array",
        message: "expected array",
        received: "undefined",
      };
    case TypeName.tuple:
      return {
        code: "expected_array",
        expected: "tuple",
        message: "expected tuple",
        received: "undefined",
      };
    case TypeName.object:
      return {
        code: "expected_object",
        expected: "object",
        message: "expected object",
        received: "undefined",
      };
    case TypeName.record:
      return {
        code: "expected_object",
        expected: "record",
        message: "expected a plain object",
        received: "undefined",
      };
    default:
      return {
        code: "invalid_type",
        expected: current.type,
        message: `expected ${current.type}`,
      };
  }
}

function requiredMessage(schema: AnySchema, fallback: string): string {
  return typeof schema.def.requiredMessage === "string" ? schema.def.requiredMessage : fallback;
}

function rootHasReadonly(schema: ATS.AnyTypeSchema, seen = new Set<ATS.AnyTypeSchema>()): boolean {
  if (seen.has(schema)) return false;
  seen.add(schema);
  const current = schema as AnySchema;

  if (current.type === TypeName.readonly) return true;
  if (current.type === TypeName.lazy) return rootHasReadonly((current.def.getter as () => ATS.AnyTypeSchema)(), seen);
  if (
    current.type === TypeName.optional ||
    current.type === TypeName.nullable ||
    current.type === TypeName.nullish ||
    current.type === TypeName.default ||
    current.type === TypeName.brand
  ) {
    return rootHasReadonly(current.def.innerType as ATS.AnyTypeSchema, seen);
  }
  return false;
}

function literal(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number") return String(value);
  if (value === null || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}

const JSON_RUNTIME_SOURCE = String.raw`function ws(input, state) {
  let code;
  while ((code = input.charCodeAt(state.i)) === 32 || code === 10 || code === 13 || code === 9) state.i++;
}
function syntax(state, message) {
  throw new SyntaxError(message + " at position " + state.i);
}
function issue(issues, path, code, expected, message, received) {
  const value = { path, code, expected, message };
  if (received !== undefined) value.received = received;
  issues[issues.length] = value;
}
function invalidJson(issues, path) {
  for (let index = issues.length - 1; index >= 0; index--) {
    const current = issues[index];
    if (current.path === path && current.code === "invalid_json") return;
  }
  issue(issues, path, "invalid_json", "JSON value", "expected a JSON-encodable value");
}
function drop(issues, path) {
  const dot = path + ".";
  const bracket = path + "[";
  for (let index = issues.length - 1; index >= 0; index--) {
    const current = issues[index].path;
    if (current === path || current.startsWith(dot) || current.startsWith(bracket)) issues.splice(index, 1);
  }
}
function kind(input, state) {
  ws(input, state);
  const code = input.charCodeAt(state.i);
  if (code === 34) return "string";
  if (code === 123 || code === 91) return "object";
  if (code === 116 || code === 102) return "boolean";
  if (code === 110) return "object";
  if (code === 45 || (code >= 48 && code <= 57)) return "number";
  return "undefined";
}
function mismatch(input, state, issues, path, code, expected, message) {
  const received = kind(input, state);
  any(input, state);
  issue(issues, path, code, expected, message, received);
}
function string(input, state) {
  let index = state.i + 1;
  let start = index;
  let output = "";
  for (;;) {
    const code = input.charCodeAt(index);
    if (code === 34) {
      output += input.slice(start, index);
      state.i = index + 1;
      return output;
    }
    if (code === 92) {
      output += input.slice(start, index);
      const escape = input.charCodeAt(++index);
      if (escape === 34 || escape === 92 || escape === 47) output += String.fromCharCode(escape);
      else if (escape === 98) output += "\b";
      else if (escape === 102) output += "\f";
      else if (escape === 110) output += "\n";
      else if (escape === 114) output += "\r";
      else if (escape === 116) output += "\t";
      else if (escape === 117) {
        const hex = input.slice(index + 1, index + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) { state.i = index; syntax(state, "invalid unicode escape"); }
        output += String.fromCharCode(Number.parseInt(hex, 16));
        index += 4;
      } else { state.i = index; syntax(state, "invalid escape"); }
      index++;
      start = index;
      continue;
    }
    if (code < 32 || Number.isNaN(code)) { state.i = index; syntax(state, "unterminated string"); }
    index++;
  }
}
function number(input, state) {
  const start = state.i;
  let index = start;
  if (input.charCodeAt(index) === 45) index++;
  let code = input.charCodeAt(index);
  if (code === 48) {
    index++;
    code = input.charCodeAt(index);
    if (code >= 48 && code <= 57) { state.i = index; syntax(state, "invalid number"); }
  } else {
    if (code < 49 || code > 57) { state.i = index; syntax(state, "invalid number"); }
    do { code = input.charCodeAt(++index); } while (code >= 48 && code <= 57);
  }
  if (code === 46) {
    code = input.charCodeAt(++index);
    if (code < 48 || code > 57) { state.i = index; syntax(state, "invalid number"); }
    do { code = input.charCodeAt(++index); } while (code >= 48 && code <= 57);
  }
  if (code === 101 || code === 69) {
    code = input.charCodeAt(++index);
    if (code === 43 || code === 45) code = input.charCodeAt(++index);
    if (code < 48 || code > 57) { state.i = index; syntax(state, "invalid number"); }
    do { code = input.charCodeAt(++index); } while (code >= 48 && code <= 57);
  }
  state.i = index;
  return Number(input.slice(start, index));
}
function readNull(input, state) {
  if (!input.startsWith("null", state.i)) syntax(state, "invalid null");
  state.i += 4;
}
function set(target, key, value) {
  if (key === "__proto__") Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
  else target[key] = value;
}
function any(input, state, jsonIssues, jsonPath) {
  ws(input, state);
  const code = input.charCodeAt(state.i);
  if (code === 34) return string(input, state);
  if (code === 45 || (code >= 48 && code <= 57)) {
    const value = number(input, state);
    if (jsonIssues !== undefined && !Number.isFinite(value)) invalidJson(jsonIssues, jsonPath);
    return value;
  }
  if (code === 116) {
    if (!input.startsWith("true", state.i)) syntax(state, "invalid token");
    state.i += 4; return true;
  }
  if (code === 102) {
    if (!input.startsWith("false", state.i)) syntax(state, "invalid token");
    state.i += 5; return false;
  }
  if (code === 110) { readNull(input, state); return null; }
  if (code === 91) {
    state.i++;
    const value = [];
    ws(input, state);
    if (input.charCodeAt(state.i) === 93) { state.i++; return value; }
    for (;;) {
      value[value.length] = any(input, state, jsonIssues, jsonPath);
      ws(input, state);
      const separator = input.charCodeAt(state.i++);
      if (separator === 93) return value;
      if (separator !== 44) syntax(state, "expected comma or closing bracket");
    }
  }
  if (code === 123) {
    state.i++;
    const value = {};
    ws(input, state);
    if (input.charCodeAt(state.i) === 125) { state.i++; return value; }
    for (;;) {
      ws(input, state);
      if (input.charCodeAt(state.i) !== 34) syntax(state, "expected object key");
      const key = string(input, state);
      ws(input, state);
      if (input.charCodeAt(state.i++) !== 58) syntax(state, "expected colon");
      set(value, key, any(input, state, jsonIssues, jsonPath));
      ws(input, state);
      const separator = input.charCodeAt(state.i++);
      if (separator === 125) return value;
      if (separator !== 44) syntax(state, "expected comma or closing brace");
    }
  }
  syntax(state, "unexpected token");
}`;
