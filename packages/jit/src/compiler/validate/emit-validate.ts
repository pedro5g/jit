import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { CodeWriter } from "../emitter/code-writer.js";
import { sanitizeChainBindings } from "../sanitize.js";
import { emitPropertyAccess } from "../source/access.js";
import { emitSchemaGuard } from "../source/guard.js";
import { emitLiteral } from "../source/literal.js";

type AnySchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };

interface SchemaCheckRecord {
  readonly kind: string;
  readonly value?: unknown;
  readonly message?: string;
}

/** Wrapper pipeline resolved outside-in for one schema node. */
interface UnwrappedSchema {
  readonly base: AnySchema;
  readonly optional: boolean;
  readonly nullable: boolean;
  readonly defaultValue: { readonly binding: string; readonly isFactory: boolean } | undefined;
  readonly coerce: string | undefined;
  readonly refines: readonly { readonly binding: string; readonly message?: string }[];
  readonly pipes: readonly string[];
  readonly fieldTransforms: Readonly<Record<string, string>> | undefined;
}

/** Static-when-possible issue path; loops switch it to a dynamic expression. */
interface PathRef {
  readonly kind: "static" | "dynamic";
  readonly source: string;
}

export interface ValidatorBindings {
  readonly names: readonly string[];
  readonly values: readonly unknown[];
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

class ValidatorEmitter {
  writer = new CodeWriter();
  private readonly rootMode: "is" | "parse";
  private readonly bindingNames: string[] = [];
  private readonly bindingValues: unknown[] = [];
  private readonly bindingIds = new Map<unknown, string>();
  private readonly helperSources: string[] = [];
  private readonly predicateNames = new Map<ATS.AnyTypeSchema, string>();
  private helperCounter = 0;
  private varCounter = 0;

  constructor(private mode: "is" | "parse") {
    this.rootMode = mode;
  }

  bindings(): ValidatorBindings {
    return { names: this.bindingNames, values: this.bindingValues };
  }

  helpers(): readonly string[] {
    return this.helperSources;
  }

  bind(value: unknown): string {
    const existing = this.bindingIds.get(value);

    if (existing) return existing;

    const name = `__v${this.bindingNames.length}`;

    this.bindingNames.push(name);
    this.bindingValues.push(value);
    this.bindingIds.set(value, name);
    return name;
  }

  nextVar(prefix: string): string {
    return `${prefix}${++this.varCounter}`;
  }

  /**
   * Emits validation statements for `schema` against `valueExpr`.
   * Returns the output expression for parse mode (the validated/transformed
   * value); is-mode returns the holder variable.
   */
  emitNode(schema: ATS.AnyTypeSchema, valueExpr: string, path: PathRef): string {
    const unwrapped = unwrapValidation(schema, this);
    const writer = this.writer;
    const holder = this.nextVar("v");
    const output = this.nextVar("o");

    writer.line(`let ${holder} = ${valueExpr};`);
    if (this.mode === "parse") writer.line(`let ${output} = ${holder};`);

    const emitValidated = () => {
      if (unwrapped.coerce) {
        writer.line(`${holder} = ${unwrapped.coerce}(${holder});`);
        if (this.mode === "parse") writer.line(`${output} = ${holder};`);
      }

      const innerOut = this.emitBase(unwrapped, holder, path);

      // Refinements run after the base type is proven, innermost first.
      for (const refine of unwrapped.refines) {
        this.failIf(
          `!${refine.binding}(${holder})`,
          path,
          "custom",
          "refinement",
          refine.message ?? "refinement rejected the value"
        );
      }

      if (this.mode === "parse") {
        // Re-sync unconditionally: string checks may have mutated the holder
        // (trim/case) after the initial `output = holder` capture.
        writer.line(`${output} = ${innerOut};`);
        for (const pipe of unwrapped.pipes) {
          writer.line(`${output} = ${pipe}(${output});`);
        }
      }
    };

    if (unwrapped.defaultValue) {
      const { binding, isFactory } = unwrapped.defaultValue;
      const defaultExpr = isFactory ? `${binding}()` : binding;

      if (this.mode === "parse") {
        writer.line(`if (${holder} === undefined) {`);
        writer.indent(() => {
          writer.line(`${output} = ${defaultExpr};`);
        });
        writer.line("} else {");
        writer.indent(emitValidated);
        writer.line("}");
      } else {
        writer.line(`if (${holder} !== undefined) {`);
        writer.indent(emitValidated);
        writer.line("}");
      }
      return this.mode === "parse" ? output : holder;
    }

    const guards: string[] = [];

    if (unwrapped.optional) guards.push(`${holder} !== undefined`);
    if (unwrapped.nullable) guards.push(`${holder} !== null`);

    if (guards.length > 0) {
      writer.line(`if (${guards.join(" && ")}) {`);
      writer.indent(emitValidated);
      writer.line("}");
      return this.mode === "parse" ? output : holder;
    }

    emitValidated();
    return this.mode === "parse" ? output : holder;
  }

  /** Emits `if (<failCondition>) { fail }` — early return or issue push. */
  failIf(failCondition: string, path: PathRef, code: string, expected: string, message: string): void {
    const writer = this.writer;

    writer.line(`if (${failCondition}) {`);
    writer.indent(() => {
      this.emitFail(path, code, expected, message);
    });
    writer.line("}");
  }

  emitFail(path: PathRef, code: string, expected: string, message: string, received?: string): void {
    const writer = this.writer;

    if (this.mode === "is") {
      writer.line("return false;");
      return;
    }

    const pathSource = path.kind === "static" ? emitLiteral(path.source) : path.source;
    const receivedPart = received ? `, received: ${received}` : "";

    writer.line(
      `issues[issues.length] = { path: ${pathSource}, code: ${emitLiteral(code)}, expected: ${emitLiteral(expected)}, message: ${emitLiteral(message)}${receivedPart} };`
    );
  }

  /** Type guard + checks + children for the unwrapped base schema. */
  private emitBase(unwrapped: UnwrappedSchema, value: string, path: PathRef): string {
    const schema = unwrapped.base;

    switch (schema.type) {
      case TypeName.any:
      case TypeName.unknown:
        return value;
      case TypeName.never:
        this.emitFail(path, "invalid_type", "never", "no value is assignable to never");
        return value;
      case TypeName.void:
      case TypeName.undefined:
        this.failIf(`${value} !== undefined`, path, "invalid_type", "undefined", "expected undefined");
        return value;
      case TypeName.null:
        this.failIf(`${value} !== null`, path, "invalid_type", "null", "expected null");
        return value;
      case TypeName.nan:
        this.failIf(`${value} === ${value}`, path, "invalid_type", "nan", "expected NaN");
        return value;
      case TypeName.string:
        return this.emitString(schema, value, path);
      case TypeName.number:
        return this.emitNumber(schema, value, path, false);
      case TypeName.int:
        return this.emitNumber(schema, value, path, true);
      case TypeName.boolean:
        return this.emitTypeofLeaf(value, path, "boolean");
      case TypeName.bigint:
        return this.emitTypeofLeaf(value, path, "bigint");
      case TypeName.symbol:
        return this.emitTypeofLeaf(value, path, "symbol");
      case TypeName.date:
        this.failIf(
          `!(${value} instanceof Date) || ${value}.getTime() !== ${value}.getTime()`,
          path,
          "invalid_date",
          "Date",
          "expected a valid Date"
        );
        return value;
      case TypeName.regex:
        this.failIf(`!(${value} instanceof RegExp)`, path, "invalid_type", "RegExp", "expected a RegExp");
        return value;
      case TypeName.file:
        this.failIf(
          `!(typeof File !== "undefined" && ${value} instanceof File)`,
          path,
          "invalid_type",
          "File",
          "expected a File"
        );
        return value;
      case TypeName.literal: {
        const literalSource = emitLiteral(schema.def.value as never);
        const literalText = String(schema.def.value);
        const test =
          typeof schema.def.value === "number" && Number.isNaN(schema.def.value)
            ? `${value} === ${value}`
            : `${value} !== ${literalSource}`;

        this.failIf(test, path, "invalid_literal", literalText, `expected literal ${literalText}`);
        return value;
      }
      case TypeName.enum: {
        const values = Object.values(schema.def.values as Record<string, string | number>);
        const test = values.map((option) => `${value} !== ${emitLiteral(option)}`).join(" && ");

        this.failIf(
          values.length === 0 ? "true" : test,
          path,
          "invalid_enum",
          values.map((option) => String(option)).join(" | "),
          "expected one of the enum values"
        );
        return value;
      }
      case TypeName.array:
        return this.emitArray(schema, value, path);
      case TypeName.tuple:
        return this.emitTuple(schema, value, path);
      case TypeName.set:
        return this.emitSet(schema, value, path);
      case TypeName.map:
        return this.emitMap(schema, value, path);
      case TypeName.record:
        return this.emitRecord(schema, value, path);
      case TypeName.object:
        return this.emitObject(schema, value, path, unwrapped.fieldTransforms);
      case TypeName.union:
        return this.emitUnion(schema, value, path);
      case TypeName.discriminatedUnion:
        return this.emitDiscriminatedUnion(schema, value, path);
      case TypeName.intersection: {
        const options = schema.def.options as ATS.AnyTypeSchema[];
        const rebuild = this.mode === "parse" && options.some((option) => needsBuild(option));
        const outputs = options.map((option) => this.emitNode(option, value, path));

        if (!rebuild) return value;

        // Some option rebuilds (defaults/transforms/string mutations):
        // merge the per-option outputs, later options winning shared keys.
        const merged = this.nextVar("o");

        this.writer.line(`const ${merged} = Object.assign({}, ${outputs.join(", ")});`);
        return merged;
      }
      case TypeName.instanceof: {
        const guard = emitSchemaGuard(schema, value);

        this.failIf(`!(${guard})`, path, "invalid_type", "instance", "expected a class instance");
        return value;
      }
      case TypeName.promise:
        this.failIf(
          `!(${value} !== null && typeof ${value} === "object" && typeof ${value}.then === "function")`,
          path,
          "invalid_type",
          "Promise",
          "expected a thenable"
        );
        return value;
      default:
        return value;
    }
  }

  /**
   * Emits a fail-or-descend gate: on type failure records the issue and
   * skips the nested block, so children never touch a wrong-typed value.
   */
  private typeGate(
    failCondition: string,
    path: PathRef,
    code: string,
    expected: string,
    message: string,
    body: () => void,
    received?: string
  ): void {
    const writer = this.writer;

    if (this.mode === "is") {
      writer.line(`if (${failCondition}) {`);
      writer.indent(() => {
        writer.line("return false;");
      });
      writer.line("}");
      body();
      return;
    }

    writer.line(`if (${failCondition}) {`);
    writer.indent(() => {
      this.emitFail(path, code, expected, message, received);
    });
    writer.line("} else {");
    writer.indent(body);
    writer.line("}");
  }

  private emitTypeofLeaf(value: string, path: PathRef, expected: string): string {
    this.failIf(`typeof ${value} !== "${expected}"`, path, `expected_${expected}`, expected, `expected ${expected}`);
    return value;
  }

  private emitString(schema: AnySchema, value: string, path: PathRef): string {
    const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];

    this.typeGate(
      `typeof ${value} !== "string"`,
      path,
      "expected_string",
      "string",
      "expected string",
      () => {
        // Mutating checks first, cheap length window next, format regexes last.
        for (const check of checks) {
          if (check.kind === "trim") this.writer.line(`${value} = ${value}.trim();`);
          if (check.kind === "lowercase") this.writer.line(`${value} = ${value}.toLowerCase();`);
          if (check.kind === "uppercase") this.writer.line(`${value} = ${value}.toUpperCase();`);
          if (check.kind === "sanitize") {
            const [scriptBlocks, htmlTags, lt, gt] = sanitizeChainBindings.values.map((regex) => this.bind(regex));

            this.writer.line(
              `${value} = ${value}.replace(${scriptBlocks}, "").replace(${htmlTags}, "").replace(${lt}, "&lt;").replace(${gt}, "&gt;");`
            );
          }
        }

        for (const check of checks) {
          switch (check.kind) {
            case "min":
              this.failIf(
                `${value}.length < ${emitLiteral(check.value as number)}`,
                path,
                "too_small",
                `length >= ${check.value}`,
                check.message ?? `expected at least ${check.value} characters`
              );
              break;
            case "max":
              this.failIf(
                `${value}.length > ${emitLiteral(check.value as number)}`,
                path,
                "too_big",
                `length <= ${check.value}`,
                check.message ?? `expected at most ${check.value} characters`
              );
              break;
            case "length":
              this.failIf(
                `${value}.length !== ${emitLiteral(check.value as number)}`,
                path,
                "invalid_length",
                `length === ${check.value}`,
                check.message ?? `expected exactly ${check.value} characters`
              );
              break;
            default:
              break;
          }
        }

        for (const check of checks) {
          switch (check.kind) {
            case "regex":
              this.failIf(
                `!${this.bind(check.value)}.test(${value})`,
                path,
                "invalid_format",
                "regex",
                check.message ?? "expected the value to match the pattern"
              );
              break;
            case "email":
              this.failIf(
                `!${this.bind(EMAIL_REGEX)}.test(${value})`,
                path,
                "invalid_format",
                "email",
                check.message ?? "expected a valid email"
              );
              break;
            case "uuid":
              this.failIf(
                `!${this.bind(UUID_REGEX)}.test(${value})`,
                path,
                "invalid_format",
                "uuid",
                check.message ?? "expected a valid uuid"
              );
              break;
            case "url": {
              const holder = this.nextVar("u");

              this.writer.line(`let ${holder} = true;`);
              this.writer.line(`try { new URL(${value}); } catch { ${holder} = false; }`);
              this.failIf(`!${holder}`, path, "invalid_format", "url", check.message ?? "expected a valid URL");
              break;
            }
            default:
              break;
          }
        }
      },
      `typeof ${value}`
    );

    return value;
  }

  private emitNumber(schema: AnySchema, value: string, path: PathRef, forceInteger: boolean): string {
    const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];

    this.typeGate(
      `typeof ${value} !== "number"`,
      path,
      "expected_number",
      "number",
      "expected number",
      () => {
        if (forceInteger || checks.some((check) => check.kind === "integer")) {
          const integerMessage = checks.find((check) => check.kind === "integer")?.message;

          this.failIf(
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
              this.failIf(
                `${value} < ${emitLiteral(check.value as number)}`,
                path,
                "too_small",
                `>= ${check.value}`,
                check.message ?? `expected a number >= ${check.value}`
              );
              break;
            case "max":
              this.failIf(
                `${value} > ${emitLiteral(check.value as number)}`,
                path,
                "too_big",
                `<= ${check.value}`,
                check.message ?? `expected a number <= ${check.value}`
              );
              break;
            case "positive":
              this.failIf(`${value} <= 0`, path, "not_positive", "> 0", check.message ?? "expected a positive number");
              break;
            case "negative":
              this.failIf(`${value} >= 0`, path, "not_negative", "< 0", check.message ?? "expected a negative number");
              break;
            case "finite":
              this.failIf(
                `!Number.isFinite(${value})`,
                path,
                "not_finite",
                "finite",
                check.message ?? "expected a finite number"
              );
              break;
            case "safe":
              this.failIf(
                `!Number.isSafeInteger(${value})`,
                path,
                "not_safe",
                "safe integer",
                check.message ?? "expected a safe integer"
              );
              break;
            case "multipleOf":
              this.failIf(
                `${value} % ${emitLiteral(check.value as number)} !== 0`,
                path,
                "not_multiple_of",
                `multiple of ${check.value}`,
                check.message ?? `expected a multiple of ${check.value}`
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

  private emitArray(schema: AnySchema, value: string, path: PathRef): string {
    const element = schema.def.element as ATS.AnyTypeSchema;
    const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];
    const build = this.mode === "parse" && needsBuild(element);
    const out = build ? this.nextVar("b") : value;

    if (build) this.writer.line(`let ${out};`);

    this.typeGate(
      `!Array.isArray(${value})`,
      path,
      "expected_array",
      "array",
      "expected array",
      () => {
        for (const check of checks) {
          switch (check.kind) {
            case "min":
              this.failIf(
                `${value}.length < ${emitLiteral(check.value as number)}`,
                path,
                "too_small",
                `length >= ${check.value}`,
                check.message ?? `expected at least ${check.value} items`
              );
              break;
            case "max":
              this.failIf(
                `${value}.length > ${emitLiteral(check.value as number)}`,
                path,
                "too_big",
                `length <= ${check.value}`,
                check.message ?? `expected at most ${check.value} items`
              );
              break;
            case "length":
              this.failIf(
                `${value}.length !== ${emitLiteral(check.value as number)}`,
                path,
                "invalid_length",
                `length === ${check.value}`,
                check.message ?? `expected exactly ${check.value} items`
              );
              break;
            case "nonEmpty":
              this.failIf(
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

        const index = this.nextVar("i");

        if (build) this.writer.line(`${out} = new Array(${value}.length);`);
        this.writer.line(`for (let ${index} = 0; ${index} < ${value}.length; ${index}++) {`);
        this.writer.indent(() => {
          const elementOut = this.emitNode(element, `${value}[${index}]`, dynamicChild(path, index));

          if (build) this.writer.line(`${out}[${index}] = ${elementOut};`);
        });
        this.writer.line("}");
      },
      `typeof ${value}`
    );

    if (build) this.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
    return out;
  }

  private emitTuple(schema: AnySchema, value: string, path: PathRef): string {
    const items = (schema.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];
    const rest = schema.def.rest as ATS.AnyTypeSchema | undefined;
    const build =
      this.mode === "parse" && (items.some((item) => needsBuild(item)) || (rest !== undefined && needsBuild(rest)));
    const out = build ? this.nextVar("b") : value;

    if (build) this.writer.line(`let ${out};`);

    this.typeGate(
      `!Array.isArray(${value})`,
      path,
      "expected_array",
      "tuple",
      "expected tuple",
      () => {
        const lengthTest = rest ? `${value}.length < ${items.length}` : `${value}.length !== ${items.length}`;

        this.failIf(
          lengthTest,
          path,
          "invalid_length",
          rest ? `length >= ${items.length}` : `length === ${items.length}`,
          rest ? `expected at least ${items.length} items` : `expected exactly ${items.length} items`
        );

        if (build) this.writer.line(`${out} = new Array(${value}.length);`);

        items.forEach((item, position) => {
          const itemOut = this.emitNode(item, `${value}[${position}]`, staticChild(path, `[${position}]`));

          if (build) this.writer.line(`${out}[${position}] = ${itemOut};`);
        });

        if (rest) {
          const index = this.nextVar("i");

          this.writer.line(`for (let ${index} = ${items.length}; ${index} < ${value}.length; ${index}++) {`);
          this.writer.indent(() => {
            const restOut = this.emitNode(rest, `${value}[${index}]`, dynamicChild(path, index));

            if (build) this.writer.line(`${out}[${index}] = ${restOut};`);
          });
          this.writer.line("}");
        }
      },
      `typeof ${value}`
    );

    if (build) this.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
    return out;
  }

  private emitSet(schema: AnySchema, value: string, path: PathRef): string {
    const element = schema.def.element as ATS.AnyTypeSchema;
    const build = this.mode === "parse" && needsBuild(element);
    const out = build ? this.nextVar("b") : value;

    if (build) this.writer.line(`let ${out};`);

    this.typeGate(
      `!(${value} instanceof Set)`,
      path,
      "expected_set",
      "Set",
      "expected a Set",
      () => {
        const item = this.nextVar("e");

        if (build) this.writer.line(`${out} = new Set();`);
        this.writer.line(`for (const ${item} of ${value}) {`);
        this.writer.indent(() => {
          const elementOut = this.emitNode(element, item, staticChild(path, "[element]"));

          if (build) this.writer.line(`${out}.add(${elementOut});`);
        });
        this.writer.line("}");
      },
      `typeof ${value}`
    );

    if (build) this.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
    return out;
  }

  private emitMap(schema: AnySchema, value: string, path: PathRef): string {
    const keySchema = schema.def.key as ATS.AnyTypeSchema;
    const valueSchema = schema.def.value as ATS.AnyTypeSchema;
    const build = this.mode === "parse" && (needsBuild(keySchema) || needsBuild(valueSchema));
    const out = build ? this.nextVar("b") : value;

    if (build) this.writer.line(`let ${out};`);

    this.typeGate(
      `!(${value} instanceof Map)`,
      path,
      "expected_map",
      "Map",
      "expected a Map",
      () => {
        const entry = this.nextVar("e");

        if (build) this.writer.line(`${out} = new Map();`);
        this.writer.line(`for (const ${entry} of ${value}) {`);
        this.writer.indent(() => {
          const keyOut = this.emitNode(keySchema, `${entry}[0]`, staticChild(path, "[key]"));
          const valueOut = this.emitNode(valueSchema, `${entry}[1]`, staticChild(path, "[value]"));

          if (build) this.writer.line(`${out}.set(${keyOut}, ${valueOut});`);
        });
        this.writer.line("}");
      },
      `typeof ${value}`
    );

    if (build) this.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
    return out;
  }

  private emitRecord(schema: AnySchema, value: string, path: PathRef): string {
    const valueSchema = schema.def.value as ATS.AnyTypeSchema;
    const build = this.mode === "parse" && needsBuild(valueSchema);
    const out = build ? this.nextVar("b") : value;

    if (build) this.writer.line(`let ${out};`);

    this.typeGate(
      `${value} === null || typeof ${value} !== "object" || Array.isArray(${value})`,
      path,
      "expected_object",
      "record",
      "expected a plain object",
      () => {
        const keys = this.nextVar("k");
        const index = this.nextVar("i");

        if (build) this.writer.line(`${out} = {};`);
        this.writer.line(`const ${keys} = Object.keys(${value});`);
        this.writer.line(`for (let ${index} = 0; ${index} < ${keys}.length; ${index}++) {`);
        this.writer.indent(() => {
          const valueOut = this.emitNode(
            valueSchema,
            `${value}[${keys}[${index}]]`,
            dynamicKeyChild(path, `${keys}[${index}]`)
          );

          if (build) this.writer.line(`${out}[${keys}[${index}]] = ${valueOut};`);
        });
        this.writer.line("}");
      },
      `typeof ${value}`
    );

    if (build) this.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
    return out;
  }

  private emitObject(
    schema: AnySchema,
    value: string,
    path: PathRef,
    fieldTransforms: Readonly<Record<string, string>> | undefined
  ): string {
    const props = schema.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;
    const unknownKeys = schema.def.unknownKeys as "strip" | "passthrough" | "strict" | undefined;
    const keys = Object.keys(props);
    const build =
      this.mode === "parse" &&
      (fieldTransforms !== undefined || unknownKeys === "strip" || keys.some((key) => needsBuild(props[key])));
    const out = build ? this.nextVar("b") : value;

    if (build) this.writer.line(`let ${out};`);

    this.typeGate(
      `${value} === null || typeof ${value} !== "object" || Array.isArray(${value})`,
      path,
      "expected_object",
      "object",
      "expected object",
      () => {
        const outputs: { key: string; expr: string }[] = [];

        for (const key of keys) {
          const propOut = this.emitNode(props[key], emitPropertyAccess(value, key), staticChild(path, key));
          const transform = fieldTransforms?.[key];

          outputs.push({ key, expr: transform ? `${transform}(${propOut}, ${value})` : propOut });
        }

        if (unknownKeys === "strict") {
          const known = this.nextVar("k");
          const index = this.nextVar("i");
          const keyTest = keys.map((key) => `${known}[${index}] !== ${emitLiteral(key)}`).join(" && ");

          this.writer.line(`const ${known} = Object.keys(${value});`);
          this.writer.line(`for (let ${index} = 0; ${index} < ${known}.length; ${index}++) {`);
          this.writer.indent(() => {
            this.failIf(
              keys.length === 0 ? "true" : keyTest,
              path,
              "unknown_key",
              "known keys only",
              "object contains unknown keys"
            );
          });
          this.writer.line("}");
        }

        if (build) {
          const entries = outputs.map((entry) => `${emitLiteral(entry.key)}: ${entry.expr}`).join(", ");

          this.writer.line(`${out} = { ${entries} };`);
        }
      },
      `typeof ${value}`
    );

    if (build) this.writer.line(`if (${out} === undefined) { ${out} = ${value}; }`);
    return out;
  }

  /**
   * Deep union validation: every option becomes a hoisted boolean predicate
   * (same Function scope, so `__v*` bindings stay reachable) running the full
   * is-mode pipeline — inner checks and refines included. Parse mode selects
   * the branch with the predicate and re-runs parse only for options that
   * rebuild their output (defaults/transforms/string mutations); coercions
   * inside union options do not participate in branch selection.
   */
  private emitUnion(schema: AnySchema, value: string, path: PathRef): string {
    const options = schema.def.options as ATS.AnyTypeSchema[];
    // Shallow options (literal/enum/primitive without checks) stay inline —
    // their guard already is the complete validation, no call overhead.
    const tests = options.map((option) =>
      isShallowOption(option) ? `(${emitSchemaGuard(option, value)})` : `${this.emitOptionPredicate(option)}(${value})`
    );
    const matchTest = tests.join(" || ");

    if (this.mode === "is" || options.every((option) => !needsBuild(option))) {
      this.failIf(
        options.length === 0 ? "true" : `!(${matchTest})`,
        path,
        "invalid_union",
        "union",
        "value matched no union option"
      );
      return value;
    }

    const out = this.nextVar("o");

    this.writer.line(`let ${out} = ${value};`);
    options.forEach((option, position) => {
      this.writer.line(`${position === 0 ? "if" : "} else if"} (${tests[position]}) {`);
      this.writer.indent(() => {
        if (needsBuild(option)) {
          const branchOut = this.emitNode(option, value, path);

          this.writer.line(`${out} = ${branchOut};`);
        }
      });
    });
    this.writer.line("} else {");
    this.writer.indent(() => {
      this.emitFail(path, "invalid_union", "union", "value matched no union option");
    });
    this.writer.line("}");
    return out;
  }

  /** Emits (once per option schema) a hoisted `function iuN(value)` deep check. */
  private emitOptionPredicate(option: ATS.AnyTypeSchema): string {
    const existing = this.predicateNames.get(option);

    if (existing) return existing;

    const name = `${this.rootMode === "is" ? "iu" : "pu"}${++this.helperCounter}`;
    const savedWriter = this.writer;
    const savedMode = this.mode;

    this.predicateNames.set(option, name);
    this.writer = new CodeWriter();
    this.mode = "is";
    this.writer.line(`function ${name}(value) {`);
    this.writer.indent(() => {
      this.emitNode(option, "value", { kind: "static", source: "" });
      this.writer.line("return true;");
    });
    this.writer.line("}");
    this.helperSources.push(this.writer.toString());
    this.writer = savedWriter;
    this.mode = savedMode;
    return name;
  }

  private emitDiscriminatedUnion(schema: AnySchema, value: string, path: PathRef): string {
    const discriminator = schema.def.discriminator as string;
    const options = schema.def.options as ATS.AnyTypeSchema[];
    const tagged = options
      .map((option) => ({ option, tag: literalTag(option, discriminator) }))
      .filter((entry): entry is { option: ATS.AnyTypeSchema; tag: string | number } => entry.tag !== undefined);
    const build = this.mode === "parse" && tagged.some((entry) => needsBuild(entry.option));
    const out = build ? this.nextVar("o") : value;

    if (build) this.writer.line(`let ${out} = ${value};`);

    this.typeGate(
      `${value} === null || typeof ${value} !== "object"`,
      path,
      "expected_object",
      "object",
      "expected object",
      () => {
        if (tagged.length === 0) {
          this.emitFail(path, "invalid_union", "discriminated union", "unknown discriminator value");
          return;
        }

        const tag = this.nextVar("t");

        this.writer.line(`const ${tag} = ${emitPropertyAccess(value, discriminator)};`);

        tagged.forEach((entry, position) => {
          this.writer.line(`${position === 0 ? "if" : "} else if"} (${tag} === ${emitLiteral(entry.tag)}) {`);
          this.writer.indent(() => {
            const branchOut = this.emitNode(entry.option, value, path);

            if (build) this.writer.line(`${out} = ${branchOut};`);
          });
        });
        this.writer.line("} else {");
        this.writer.indent(() => {
          this.emitFail(path, "invalid_union", "discriminated union", "unknown discriminator value");
        });
        this.writer.line("}");
      },
      `typeof ${value}`
    );

    return out;
  }
}

/**
 * True when the shallow schema guard is already the complete validation for
 * a union option — no checks, refines, defaults, coercions, or transforms.
 */
function isShallowOption(schema: ATS.AnyTypeSchema): boolean {
  let current = schema as AnySchema;

  while (
    current.type === TypeName.optional ||
    current.type === TypeName.nullable ||
    current.type === TypeName.nullish ||
    current.type === TypeName.brand ||
    current.type === TypeName.readonly ||
    current.type === TypeName.lazy
  ) {
    current =
      current.type === TypeName.lazy ? (current.def.getter as () => AnySchema)() : (current.def.innerType as AnySchema);
  }

  switch (current.type) {
    case TypeName.any:
    case TypeName.unknown:
    case TypeName.void:
    case TypeName.undefined:
    case TypeName.null:
    case TypeName.boolean:
    case TypeName.bigint:
    case TypeName.symbol:
    case TypeName.literal:
    case TypeName.enum:
      return true;
    case TypeName.string:
    case TypeName.number:
      return (((current.def as Record<string, unknown>).checks as readonly unknown[] | undefined) ?? []).length === 0;
    default:
      return false;
  }
}

function staticChild(path: PathRef, segment: string): PathRef {
  const joiner = segment.startsWith("[") ? "" : path.source === "" ? "" : ".";

  if (path.kind === "static") {
    return { kind: "static", source: `${path.source}${joiner}${segment}` };
  }

  return { kind: "dynamic", source: `${path.source} + ${emitLiteral(`${joiner}${segment}`)}` };
}

function dynamicChild(path: PathRef, indexVar: string): PathRef {
  const prefix = path.kind === "static" ? emitLiteral(`${path.source}[`) : `${path.source} + "["`;

  return { kind: "dynamic", source: `${prefix} + ${indexVar} + "]"` };
}

function dynamicKeyChild(path: PathRef, keyExpr: string): PathRef {
  const prefix =
    path.kind === "static" ? emitLiteral(path.source === "" ? "" : `${path.source}.`) : `${path.source} + "."`;

  return { kind: "dynamic", source: `${prefix} + ${keyExpr}` };
}

function literalTag(option: ATS.AnyTypeSchema, discriminator: string): string | number | undefined {
  const base = unwrapPassthrough(option);

  if (base.type !== TypeName.object) return undefined;

  const prop = (base.def as { props: Record<string, ATS.AnyTypeSchema> }).props[discriminator];

  if (!prop) return undefined;

  const propBase = unwrapPassthrough(prop);

  if (propBase.type !== TypeName.literal) return undefined;

  const literalValue = (propBase.def as { value: unknown }).value;

  return typeof literalValue === "string" || typeof literalValue === "number" ? literalValue : undefined;
}

function unwrapPassthrough(schema: ATS.AnyTypeSchema): AnySchema {
  let current = schema as AnySchema;

  while (true) {
    switch (current.type) {
      case TypeName.optional:
      case TypeName.nullable:
      case TypeName.nullish:
      case TypeName.default:
      case TypeName.brand:
      case TypeName.readonly:
      case TypeName.refine:
      case TypeName.coerce:
      case TypeName.pipe:
      case TypeName.transform:
        current = current.def.innerType as AnySchema;
        continue;
      case TypeName.lazy:
        current = (current.def.getter as () => AnySchema)();
        continue;
      default:
        return current;
    }
  }
}

function unwrapValidation(schema: ATS.AnyTypeSchema, emitter: ValidatorEmitter): UnwrappedSchema {
  let current = schema as AnySchema;
  let optional = false;
  let nullable = false;
  let defaultValue: UnwrappedSchema["defaultValue"];
  let coerce: string | undefined;
  const refines: { readonly binding: string; readonly message?: string }[] = [];
  const pipes: string[] = [];
  let fieldTransforms: Record<string, string> | undefined;

  while (true) {
    if (current.type === TypeName.optional) {
      optional = true;
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.nullable) {
      nullable = true;
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.nullish) {
      optional = true;
      nullable = true;
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.default) {
      if (!defaultValue) {
        const raw = current.def.defaultValue;

        defaultValue = { binding: emitter.bind(raw), isFactory: typeof raw === "function" };
      }
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.coerce) {
      coerce = coerce ?? emitter.bind(current.def.coercer);
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.refine) {
      // Outer refines run last: collected outside-in, executed inner-first.
      refines.unshift({
        binding: emitter.bind(current.def.predicate),
        ...(typeof current.def.message === "string" ? { message: current.def.message } : {}),
      });
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.pipe) {
      pipes.unshift(emitter.bind(current.def.transform));
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.transform) {
      fieldTransforms = fieldTransforms ?? bindFieldTransforms(current.def.transforms, emitter);
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.brand || current.type === TypeName.readonly) {
      current = current.def.innerType as AnySchema;
      continue;
    }

    if (current.type === TypeName.lazy) {
      current = (current.def.getter as () => AnySchema)();
      continue;
    }

    break;
  }

  return { base: current, optional, nullable, defaultValue, coerce, refines, pipes, fieldTransforms };
}

function bindFieldTransforms(spec: unknown, emitter: ValidatorEmitter): Record<string, string> {
  const bindings: Record<string, string> = {};

  for (const [key, fn] of Object.entries(spec as Record<string, unknown>)) {
    if (typeof fn === "function") bindings[key] = emitter.bind(fn);
  }

  return bindings;
}

/** True when parse output can differ from the input for this subtree. */
export function needsBuild(schema: ATS.AnyTypeSchema): boolean {
  const current = schema as AnySchema;

  switch (current.type) {
    case TypeName.default:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
      return true;
    case TypeName.optional:
    case TypeName.nullable:
    case TypeName.nullish:
    case TypeName.brand:
    case TypeName.readonly:
    case TypeName.refine:
      return needsBuild((current.def as { innerType: ATS.AnyTypeSchema }).innerType);
    case TypeName.string: {
      const checks = (current.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];

      return checks.some(
        (check) =>
          check.kind === "trim" || check.kind === "lowercase" || check.kind === "uppercase" || check.kind === "sanitize"
      );
    }
    case TypeName.array:
    case TypeName.set:
      return needsBuild(current.def.element as ATS.AnyTypeSchema);
    case TypeName.map:
      return needsBuild(current.def.key as ATS.AnyTypeSchema) || needsBuild(current.def.value as ATS.AnyTypeSchema);
    case TypeName.union:
    case TypeName.discriminatedUnion:
    case TypeName.intersection:
      return (current.def.options as readonly ATS.AnyTypeSchema[]).some(needsBuild);
    case TypeName.tuple: {
      const items = (current.def.items as readonly ATS.AnyTypeSchema[] | undefined) ?? [];
      const rest = current.def.rest as ATS.AnyTypeSchema | undefined;

      return items.some(needsBuild) || (rest !== undefined && needsBuild(rest));
    }
    case TypeName.record:
      return needsBuild(current.def.value as ATS.AnyTypeSchema);
    case TypeName.object: {
      const props = current.def.props as Readonly<Record<string, ATS.AnyTypeSchema>>;

      if ((current.def.unknownKeys as string | undefined) === "strip") return true;
      return Object.keys(props).some((key) => needsBuild(props[key]));
    }
    default:
      return false;
  }
}

export interface EmittedValidator {
  readonly source: string;
  readonly bindings: ValidatorBindings;
}

/**
 * Emits `{ is, safeParse }` source for a schema. `is` is a pure boolean
 * type check with early returns; `safeParse` collects every issue with its
 * static path and returns `{ success, data | issues }`, rebuilding the
 * output only when defaults/coercions/transforms require it.
 */
export function emitValidator(schema: ATS.AnyTypeSchema): EmittedValidator {
  const parseEmitter = new ValidatorEmitter("parse");

  parseEmitter.writer.line("function safeParse(value) {");
  parseEmitter.writer.indent(() => {
    parseEmitter.writer.line("const issues = [];");
    const output = parseEmitter.emitNode(schema, "value", { kind: "static", source: "" });

    parseEmitter.writer.line("if (issues.length !== 0) {");
    parseEmitter.writer.indent(() => {
      parseEmitter.writer.line("return { success: false, issues: issues };");
    });
    parseEmitter.writer.line("}");
    parseEmitter.writer.line(`return { success: true, data: ${output} };`);
  });
  parseEmitter.writer.line("}");

  const isEmitter = new ValidatorEmitter("is");

  // Bind the same values in the same order so both functions can share one
  // Function parameter list; extras from either emitter are appended after.
  for (const value of parseEmitter.bindings().values) isEmitter.bind(value);

  isEmitter.writer.line("function is(value) {");
  isEmitter.writer.indent(() => {
    isEmitter.emitNode(schema, "value", { kind: "static", source: "" });
    isEmitter.writer.line("return true;");
  });
  isEmitter.writer.line("}");

  const helperBlocks = [...isEmitter.helpers(), ...parseEmitter.helpers()];
  const helperSource = helperBlocks.length > 0 ? `${helperBlocks.join("\n")}\n` : "";
  const source = `${helperSource}${isEmitter.writer.toString()}\n${parseEmitter.writer.toString()}\nreturn { is: is, safeParse: safeParse };`;

  return { source, bindings: isEmitter.bindings() };
}
