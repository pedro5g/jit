import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { Regexes } from "../../shared/index.js";
import { CodeWriter } from "../emitter/code-writer.js";
import { sanitizeChainBindings } from "../sanitize.js";
import { emitPropertyAccess } from "../source/access.js";
import { countFormatPlaceholders, emitFormatMaskExpression, emitStrictFormatCondition } from "../source/format-mask.js";
import { emitSchemaGuard } from "../source/guard.js";
import { emitLiteral } from "../source/literal.js";

type AnySchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };

interface SchemaCheckRecord {
  readonly kind: string;
  readonly value?: unknown;
  readonly message?: string;
}

interface RefineRecord {
  readonly binding: string;
  readonly message?: string;
  readonly path?: readonly ATS.IssuePathSegment[];
  readonly when?: string;
}

/** Wrapper pipeline resolved outside-in for one schema node. */
interface UnwrappedSchema {
  readonly base: AnySchema;
  readonly optional: boolean;
  readonly nullable: boolean;
  readonly defaultValue: { readonly binding: string; readonly isFactory: boolean } | undefined;
  readonly emptyAsUndefined: boolean;
  readonly coerce: string | undefined;
  readonly refines: readonly RefineRecord[];
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

const EMAIL_REGEX = Regexes.email;
const UUID_REGEX = /*@__PURE__*/ Regexes.uuid();

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

  constructor(
    private mode: "is" | "parse",
    private awaited = false
  ) {
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
  emitNode(schema: ATS.AnyTypeSchema, valueExpr: string, path: PathRef, contextExpr?: string): string {
    const current = schema as AnySchema;

    if (current.type === TypeName.when) {
      return this.emitWhen(current, valueExpr, path, contextExpr);
    }

    const unwrapped = unwrapValidation(schema, this);
    const writer = this.writer;
    const holder = this.nextVar("v");
    const output = this.nextVar("o");

    writer.line(`let ${holder} = ${valueExpr};`);
    if (this.mode === "parse") writer.line(`let ${output} = ${holder};`);

    const finish = () => (this.mode === "parse" ? output : holder);

    if (unwrapped.emptyAsUndefined) {
      writer.line(`if (${holder} === "") {`);
      writer.indent(() => {
        writer.line(`${holder} = undefined;`);
        if (this.mode === "parse") writer.line(`${output} = ${holder};`);
      });
      writer.line("}");
    }

    const emitValidated = () => {
      if (unwrapped.coerce) {
        writer.line(`${holder} = ${unwrapped.coerce}(${holder});`);
        if (this.mode === "parse") writer.line(`${output} = ${holder};`);
      }

      const innerOut = this.emitBase(unwrapped, holder, path);

      // Refinements run after the base type is proven, innermost first.
      for (const refine of unwrapped.refines) {
        const refinePath = appendIssuePath(path, refine.path);
        const emitRefine = () => {
          this.failIf(
            `!${refine.binding}(${holder})`,
            refinePath,
            "custom",
            "refinement",
            refine.message ?? "refinement rejected the value"
          );
        };

        if (refine.when) {
          writer.line(`if (${refine.when}({ value: ${holder} })) {`);
          writer.indent(emitRefine);
          writer.line("}");
        } else {
          emitRefine();
        }
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
      return finish();
    }

    const guards: string[] = [];

    if (unwrapped.optional) guards.push(`${holder} !== undefined`);
    if (unwrapped.nullable) guards.push(`${holder} !== null`);

    if (guards.length > 0) {
      writer.line(`if (${guards.join(" && ")}) {`);
      writer.indent(emitValidated);
      writer.line("}");
      return finish();
    }

    emitValidated();
    return finish();
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

    // zod-style JIT.coerce.* flag: convert with the native constructor
    // before the type gate. Inline — no binding, AOT-safe.
    if ((schema.def as { coerce?: boolean }).coerce === true) {
      switch (schema.type) {
        case TypeName.string:
          this.writer.line(`${value} = String(${value});`);
          break;
        case TypeName.number:
        case TypeName.int:
          this.writer.line(`${value} = Number(${value});`);
          break;
        case TypeName.boolean:
          this.writer.line(`${value} = Boolean(${value});`);
          break;
        case TypeName.bigint:
          // A bad BigInt input degrades to a type failure instead of
          // throwing out of safeParse (kinder than zod here).
          this.writer.line(`try { ${value} = BigInt(${value}); } catch {}`);
          break;
        case TypeName.date:
          this.writer.line(`${value} = new Date(${value});`);
          break;
        default:
          break;
      }
    }

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
        return this.emitDate(schema, value, path);
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
      case TypeName.json:
        return this.emitJson(value, path);
      case TypeName.custom:
        return this.emitCustom(schema, value, path);
      case TypeName.not:
        return this.emitNot(schema, value, path);
      case TypeName.templateLiteral:
        return this.emitTemplateLiteral(schema, value, path);
      case TypeName.function:
        this.failIf(`typeof ${value} !== "function"`, path, "expected_function", "function", "expected function");
        return value;
      case TypeName.temporal:
        return this.emitTemporal(schema, value, path);
      case TypeName.codec:
        return this.emitCodec(schema, value, path);
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
      case TypeName.xor:
        return this.emitXor(schema, value, path);
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
      case TypeName.promise: {
        if (this.awaited) {
          // Async mode: settle the value, then validate the resolved inner
          // type in place (zod parseAsync semantics; plain values pass).
          this.writer.line(`${value} = await ${value};`);
          return this.emitNode(schema.def.innerType as ATS.AnyTypeSchema, value, path);
        }

        this.failIf(
          `!(${value} !== null && typeof ${value} === "object" && typeof ${value}.then === "function")`,
          path,
          "invalid_type",
          "Promise",
          "expected a thenable"
        );
        return value;
      }
      default:
        return value;
    }
  }

  private emitWhen(schema: AnySchema, valueExpr: string, path: PathRef, contextExpr: string | undefined): string {
    const sibling = contextExpr ? emitPropertyAccess(contextExpr, schema.def.key as string) : "undefined";
    const matcher = schema.def.is;
    const test =
      typeof matcher === "function"
        ? `${this.bind(matcher)}(${sibling})`
        : `${sibling} === ${emitLiteral(matcher as never)}`;

    if (this.mode === "is") {
      this.writer.line(`if (${test}) {`);
      this.writer.indent(() => {
        this.emitNode(schema.def.thenType as ATS.AnyTypeSchema, valueExpr, path, contextExpr);
      });
      this.writer.line("} else {");
      this.writer.indent(() => {
        this.emitNode(schema.def.otherwiseType as ATS.AnyTypeSchema, valueExpr, path, contextExpr);
      });
      this.writer.line("}");
      return valueExpr;
    }

    const out = this.nextVar("w");

    this.writer.line(`let ${out};`);
    this.writer.line(`if (${test}) {`);
    this.writer.indent(() => {
      const branchOut = this.emitNode(schema.def.thenType as ATS.AnyTypeSchema, valueExpr, path, contextExpr);

      this.writer.line(`${out} = ${branchOut};`);
    });
    this.writer.line("} else {");
    this.writer.indent(() => {
      const branchOut = this.emitNode(schema.def.otherwiseType as ATS.AnyTypeSchema, valueExpr, path, contextExpr);

      this.writer.line(`${out} = ${branchOut};`);
    });
    this.writer.line("}");
    return out;
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

  private requiredMessage(schema: AnySchema, fallback: string): string {
    return typeof schema.def.requiredMessage === "string" ? schema.def.requiredMessage : fallback;
  }

  private emitJson(value: string, path: PathRef): string {
    this.failIf(
      `!${this.emitJsonPredicate()}(${value})`,
      path,
      "invalid_json",
      "JSON value",
      "expected a JSON-encodable value"
    );
    return value;
  }

  private emitCustom(schema: AnySchema, value: string, path: PathRef): string {
    const predicate = schema.def.predicate as ((value: unknown) => boolean) | undefined;

    if (predicate) {
      this.failIf(
        `!${this.bind(predicate)}(${value})`,
        path,
        "custom",
        "custom",
        (schema.def.message as string | undefined) ?? "custom predicate rejected the value"
      );
    }
    return value;
  }

  private emitNot(schema: AnySchema, value: string, path: PathRef): string {
    const inner = schema.def.innerType as ATS.AnyTypeSchema;

    this.failIf(
      `${this.emitOptionPredicate(inner)}(${value})`,
      path,
      "invalid_not",
      "not",
      "value matched a forbidden schema"
    );
    return value;
  }

  private emitTemplateLiteral(schema: AnySchema, value: string, path: PathRef): string {
    const regex = buildTemplateLiteralRegex(schema.def.parts as readonly (string | ATS.AnyTypeSchema)[]);

    this.typeGate(
      `typeof ${value} !== "string"`,
      path,
      "expected_string",
      "string",
      "expected string",
      () => {
        this.failIf(
          `!${this.bind(regex)}.test(${value})`,
          path,
          "invalid_template_literal",
          "template literal",
          "expected a matching template literal string"
        );
      },
      `typeof ${value}`
    );
    return value;
  }

  private emitDate(schema: AnySchema, value: string, path: PathRef): string {
    const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];

    this.typeGate(
      `!(${value} instanceof Date) || ${value}.getTime() !== ${value}.getTime()`,
      path,
      "invalid_date",
      "Date",
      this.requiredMessage(schema, "expected a valid Date"),
      () => {
        this.emitDateLikeChecks(checks, value, path, "date");
      }
    );
    return value;
  }

  private emitTemporal(schema: AnySchema, value: string, path: PathRef): string {
    const kind = schema.def.kind as ATS.TemporalKind;
    const ctor = temporalConstructorName(kind);
    const expected = `Temporal.${ctor}`;

    this.typeGate(
      `!(globalThis.Temporal !== undefined && ${value} instanceof globalThis.Temporal.${ctor})`,
      path,
      "invalid_temporal",
      expected,
      this.requiredMessage(schema, `expected ${expected}`),
      () => {
        this.emitDateLikeChecks(
          (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [],
          value,
          path,
          kind
        );
      }
    );
    return value;
  }

  private emitDateLikeChecks(
    checks: readonly SchemaCheckRecord[],
    value: string,
    path: PathRef,
    target: "date" | ATS.TemporalKind
  ): void {
    for (const check of checks) {
      switch (check.kind) {
        case "min": {
          const bound = this.dateLikeBound(check.value, target);

          this.failIf(
            this.dateLikeCompare(value, bound, target, "<"),
            path,
            "too_small",
            `>= ${String(check.value)}`,
            check.message ?? `expected a value >= ${String(check.value)}`
          );
          break;
        }
        case "max": {
          const bound = this.dateLikeBound(check.value, target);

          this.failIf(
            this.dateLikeCompare(value, bound, target, ">"),
            path,
            "too_big",
            `<= ${String(check.value)}`,
            check.message ?? `expected a value <= ${String(check.value)}`
          );
          break;
        }
        case "between": {
          const range = check.value as { readonly min: Date | string; readonly max: Date | string };
          const min = this.dateLikeBound(range.min, target);
          const max = this.dateLikeBound(range.max, target);

          this.failIf(
            `${this.dateLikeCompare(value, min, target, "<")} || ${this.dateLikeCompare(value, max, target, ">")}`,
            path,
            "out_of_range",
            `${String(range.min)}..${String(range.max)}`,
            check.message ?? `expected a value between ${String(range.min)} and ${String(range.max)}`
          );
          break;
        }
        case "daysOfWeek": {
          const days = (check.value as readonly number[] | undefined) ?? [];
          const dayExpr = target === "date" ? `(((${value}.getDay() + 6) % 7) + 1)` : `${value}.dayOfWeek`;
          const test = days.map((day) => `${dayExpr} !== ${emitLiteral(day)}`).join(" && ");

          this.failIf(
            days.length === 0 ? "true" : `typeof ${dayExpr} !== "number" || (${test})`,
            path,
            "invalid_day_of_week",
            days.join(" | "),
            check.message ?? "expected an allowed day of week"
          );
          break;
        }
        case "monthsOfYear": {
          const months = (check.value as readonly number[] | undefined) ?? [];
          const monthExpr = target === "date" ? `(${value}.getMonth() + 1)` : `${value}.month`;
          const test = months.map((month) => `${monthExpr} !== ${emitLiteral(month)}`).join(" && ");

          this.failIf(
            months.length === 0 ? "true" : `typeof ${monthExpr} !== "number" || (${test})`,
            path,
            "invalid_month_of_year",
            months.join(" | "),
            check.message ?? "expected an allowed month"
          );
          break;
        }
        case "truncateTo":
          this.failIf(
            this.truncateFailure(value, check.value as ATS.TemporalUnit, target),
            path,
            "invalid_precision",
            String(check.value),
            check.message ?? `expected value truncated to ${String(check.value)}`
          );
          break;
        default:
          break;
      }
    }
  }

  private dateLikeBound(value: unknown, target: "date" | ATS.TemporalKind): string {
    if (target === "date") {
      const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();

      return emitLiteral(time);
    }
    return emitLiteral(value instanceof Date ? value.toISOString() : String(value));
  }

  private dateLikeCompare(
    value: string,
    bound: string,
    target: "date" | ATS.TemporalKind,
    operator: "<" | ">"
  ): string {
    return target === "date" ? `${value}.getTime() ${operator} ${bound}` : `${value}.toString() ${operator} ${bound}`;
  }

  private truncateFailure(value: string, unit: ATS.TemporalUnit, target: "date" | ATS.TemporalKind): string {
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

  private emitCodec(schema: AnySchema, value: string, path: PathRef): string {
    const input = schema.def.input as ATS.AnyTypeSchema;
    const inputOut = this.emitNode(input, value, path);

    if (this.mode === "is") return value;

    const decoded = this.nextVar("c");

    this.writer.line(`let ${decoded};`);
    this.writer.line("try {");
    this.writer.indent(() => {
      this.writer.line(`${decoded} = ${this.bind(schema.def.decode)}(${inputOut});`);
    });
    this.writer.line("} catch {");
    this.writer.indent(() => {
      this.emitFail(path, "invalid_codec", "codec decode", "codec decode failed");
    });
    this.writer.line("}");
    return this.emitNode(schema.def.output as ATS.AnyTypeSchema, decoded, path);
  }

  private emitJsonPredicate(): string {
    const name = `${this.rootMode === "is" ? "ij" : "pj"}${++this.helperCounter}`;

    this.helperSources.push(`function ${name}(value) {
  if (value === null) return true;
  const type = typeof value;
  if (type === "string" || type === "boolean") return true;
  if (type === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!${name}(value[i])) return false;
    }
    return true;
  }
  if (type !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i++) {
    if (!${name}(value[keys[i]])) return false;
  }
  return true;
}`);
    return name;
  }

  private emitString(schema: AnySchema, value: string, path: PathRef): string {
    const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];

    this.typeGate(
      `typeof ${value} !== "string"`,
      path,
      "expected_string",
      "string",
      this.requiredMessage(schema, "expected string"),
      () => {
        // Mutating checks first, cheap length window next, format regexes last.
        for (const check of checks) {
          if (check.kind === "trim") this.writer.line(`${value} = ${value}.trim();`);
          if (check.kind === "normalize") {
            const form = typeof check.value === "string" ? emitLiteral(check.value) : "";

            this.writer.line(`${value} = ${value}.normalize(${form});`);
          }
          if (check.kind === "lowercase") this.writer.line(`${value} = ${value}.toLowerCase();`);
          if (check.kind === "uppercase") this.writer.line(`${value} = ${value}.toUpperCase();`);
          if (check.kind === "sanitize") {
            const [scriptBlocks, htmlTags, lt, gt] = sanitizeChainBindings.values.map((regex) => this.bind(regex));

            this.writer.line(
              `${value} = ${value}.replace(${scriptBlocks}, "").replace(${htmlTags}, "").replace(${lt}, "&lt;").replace(${gt}, "&gt;");`
            );
          }
          if (check.kind === "format") {
            const spec = check.value as ATS.StringMaskSpec;
            const length = countFormatPlaceholders(spec.pattern);

            if (spec.mode === "strict") {
              this.failIf(
                emitStrictFormatCondition(value, spec.pattern),
                path,
                "invalid_format",
                spec.pattern,
                check.message ?? `expected the ${spec.pattern} format`
              );
            } else {
              if (spec.stripNonDigits) this.writer.line(`${value} = ${value}.replace(/\\D+/g, "");`);
              this.failIf(
                `${value}.length !== ${emitLiteral(length)}`,
                path,
                "invalid_format",
                `length === ${length}`,
                check.message ?? `expected ${length} characters before formatting`
              );
            }
          }
          if (check.kind === "phoneBR") {
            this.writer.line(`${value} = ${value}.replace(/\\D+/g, "");`);
            this.failIf(
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
            case "oneOf": {
              const values = (check.value as readonly string[] | undefined) ?? [];
              const test = values.map((option) => `${value} !== ${emitLiteral(option)}`).join(" && ");

              this.failIf(
                values.length === 0 ? "true" : test,
                path,
                "invalid_enum",
                values.join(" | "),
                check.message ?? "expected one of the allowed values"
              );
              break;
            }
            case "startsWith":
              this.failIf(
                `!${value}.startsWith(${emitLiteral(check.value as string)})`,
                path,
                "invalid_string",
                `startsWith ${check.value}`,
                check.message ?? `expected string to start with ${check.value}`
              );
              break;
            case "endsWith":
              this.failIf(
                `!${value}.endsWith(${emitLiteral(check.value as string)})`,
                path,
                "invalid_string",
                `endsWith ${check.value}`,
                check.message ?? `expected string to end with ${check.value}`
              );
              break;
            case "includes":
              this.failIf(
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

              this.failIf(
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
                `!${this.bind(check.value instanceof RegExp ? check.value : EMAIL_REGEX)}.test(${value})`,
                path,
                "invalid_format",
                "email",
                check.message ?? "expected a valid email"
              );
              break;
            case "uuid":
              this.failIf(
                `!${this.bind(check.value instanceof RegExp ? check.value : UUID_REGEX)}.test(${value})`,
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
            case "httpUrl": {
              const holder = this.nextVar("u");
              const parsed = this.nextVar("url");

              this.writer.line(`let ${holder} = true;`);
              this.writer.line(
                `try { const ${parsed} = new URL(${value}); ${holder} = ${parsed}.protocol === "http:" || ${parsed}.protocol === "https:"; } catch { ${holder} = false; }`
              );
              this.failIf(
                `!${holder}`,
                path,
                "invalid_format",
                "httpUrl",
                check.message ?? "expected a valid HTTP(S) URL"
              );
              break;
            }
            case "stringFormat": {
              const spec = check.value as { readonly name: string; readonly pattern: RegExp };

              this.failIf(
                `!${this.bind(spec.pattern)}.test(${value})`,
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
                this.failIf(
                  `!${this.bind(check.value)}.test(${value})`,
                  path,
                  "invalid_format",
                  check.kind,
                  check.message ?? `expected a valid ${check.kind}`
                );
              }
              break;
          }
        }

        if (this.rootMode === "parse") {
          for (const check of checks) {
            if (check.kind === "format") {
              const spec = check.value as ATS.StringMaskSpec;

              if (spec.mode === "transform") {
                const length = countFormatPlaceholders(spec.pattern);

                this.writer.line(`if (${value}.length === ${length}) {`);
                this.writer.indent(() => {
                  this.writer.line(`${value} = ${emitFormatMaskExpression(value, spec.pattern)};`);
                });
                this.writer.line("}");
              }
            }
            if (check.kind === "phoneBR") {
              this.writer.line(`if (${value}.length === 10) {`);
              this.writer.indent(() => {
                this.writer.line(`${value} = ${emitFormatMaskExpression(value, "(##) ####-####")};`);
              });
              this.writer.line(`} else if (${value}.length === 11) {`);
              this.writer.indent(() => {
                this.writer.line(`${value} = ${emitFormatMaskExpression(value, "(##) #####-####")};`);
              });
              this.writer.line("}");
            }
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
      this.requiredMessage(schema, "expected number"),
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
            case "moreThan":
              this.failIf(
                `${value} <= ${emitLiteral(check.value as number)}`,
                path,
                "too_small",
                `> ${check.value}`,
                check.message ?? `expected a number > ${check.value}`
              );
              break;
            case "lessThan":
              this.failIf(
                `${value} >= ${emitLiteral(check.value as number)}`,
                path,
                "too_big",
                `< ${check.value}`,
                check.message ?? `expected a number < ${check.value}`
              );
              break;
            case "oneOf": {
              const values = (check.value as readonly number[] | undefined) ?? [];
              const test = values.map((option) => `${value} !== ${emitLiteral(option)}`).join(" && ");

              this.failIf(
                values.length === 0 ? "true" : test,
                path,
                "invalid_enum",
                values.map((option) => String(option)).join(" | "),
                check.message ?? "expected one of the allowed values"
              );
              break;
            }
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
            case "int32":
              this.failIf(
                `!Number.isInteger(${value}) || ${value} < -2147483648 || ${value} > 2147483647`,
                path,
                "not_int32",
                "int32",
                check.message ?? "expected a 32-bit signed integer"
              );
              break;
            case "float32":
              this.failIf(
                `!Number.isFinite(${value}) || Math.fround(${value}) !== ${value}`,
                path,
                "not_float32",
                "float32",
                check.message ?? "expected a float32-representable number"
              );
              break;
            case "float64":
              this.failIf(
                `!Number.isFinite(${value})`,
                path,
                "not_float64",
                "float64",
                check.message ?? "expected a finite float64 number"
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
    const catchall = schema.def.catchall as ATS.AnyTypeSchema | undefined;
    const keys = Object.keys(props);
    const catchallBuild = catchall !== undefined && needsBuild(catchall);
    const preserveUnknownKeys = unknownKeys === "passthrough" || catchall !== undefined;
    const build =
      this.mode === "parse" &&
      (fieldTransforms !== undefined ||
        unknownKeys === "strip" ||
        catchallBuild ||
        keys.some((key) => needsBuild(props[key])));
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
          const propOut = this.emitNode(props[key], emitPropertyAccess(value, key), staticChild(path, key), value);
          const transform = fieldTransforms?.[key];

          outputs.push({ key, expr: transform ? `${transform}(${propOut}, ${value})` : propOut });
        }

        if (build && preserveUnknownKeys) {
          this.writer.line(`${out} = Object.assign({}, ${value});`);
        }

        if (unknownKeys === "strict" || catchall !== undefined) {
          const known = this.nextVar("k");
          const index = this.nextVar("i");
          const keyTest = keys.map((key) => `${known}[${index}] !== ${emitLiteral(key)}`).join(" && ");
          const unknownTest = keys.length === 0 ? "true" : keyTest;

          this.writer.line(`const ${known} = Object.keys(${value});`);
          this.writer.line(`for (let ${index} = 0; ${index} < ${known}.length; ${index}++) {`);
          this.writer.indent(() => {
            if (unknownKeys === "strict") {
              this.failIf(
                unknownTest,
                dynamicKeyChild(path, `${known}[${index}]`),
                "unknown_key",
                "known keys only",
                "object contains unknown keys"
              );
              return;
            }

            if (catchall !== undefined) {
              this.writer.line(`if (${unknownTest}) {`);
              this.writer.indent(() => {
                const catchallOut = this.emitNode(
                  catchall,
                  `${value}[${known}[${index}]]`,
                  dynamicKeyChild(path, `${known}[${index}]`)
                );

                if (build && catchallBuild) this.writer.line(`${out}[${known}[${index}]] = ${catchallOut};`);
              });
              this.writer.line("}");
            }
          });
          this.writer.line("}");
        }

        if (build) {
          if (!preserveUnknownKeys) {
            const entries = outputs.map((entry) => `${emitLiteral(entry.key)}: ${entry.expr}`).join(", ");

            this.writer.line(`${out} = { ${entries} };`);
          } else {
            for (const entry of outputs) {
              this.writer.line(`${emitPropertyAccess(out, entry.key)} = ${entry.expr};`);
            }
          }
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

  private emitXor(schema: AnySchema, value: string, path: PathRef): string {
    const options = schema.def.options as ATS.AnyTypeSchema[];
    const tests = options.map((option) => `${this.emitOptionPredicate(option)}(${value})`);
    const count = tests.length === 0 ? "0" : tests.map((test) => `(${test} ? 1 : 0)`).join(" + ");
    const build = this.mode === "parse" && options.some(needsBuild);

    if (this.mode === "is" || !build) {
      this.failIf(`${count} !== 1`, path, "invalid_xor", "exactly one schema", "value must match exactly one schema");
      return value;
    }

    const out = this.nextVar("o");

    this.writer.line(`let ${out} = ${value};`);
    this.writer.line(`if (${count} !== 1) {`);
    this.writer.indent(() => {
      this.emitFail(path, "invalid_xor", "exactly one schema", "value must match exactly one schema");
    });
    this.writer.line("} else {");
    this.writer.indent(() => {
      options.forEach((option, position) => {
        this.writer.line(`${position === 0 ? "if" : "} else if"} (${tests[position]}) {`);
        this.writer.indent(() => {
          if (needsBuild(option)) {
            const branchOut = this.emitNode(option, value, path);

            this.writer.line(`${out} = ${branchOut};`);
          }
        });
      });
      if (options.length > 0) this.writer.line("}");
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
    const savedAwaited = this.awaited;

    this.predicateNames.set(option, name);
    this.writer = new CodeWriter();
    this.mode = "is";
    // Predicates are plain sync functions — `await` may not appear inside.
    this.awaited = false;
    this.writer.line(`function ${name}(value) {`);
    this.writer.indent(() => {
      this.emitNode(option, "value", { kind: "static", source: "" });
      this.writer.line("return true;");
    });
    this.writer.line("}");
    this.helperSources.push(this.writer.toString());
    this.writer = savedWriter;
    this.mode = savedMode;
    this.awaited = savedAwaited;
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

function buildTemplateLiteralRegex(parts: readonly (string | ATS.AnyTypeSchema)[]): RegExp {
  return new RegExp(`^${parts.map(templateLiteralPartSource).join("")}$`, "u");
}

function temporalConstructorName(kind: ATS.TemporalKind): string {
  switch (kind) {
    case "instant":
      return "Instant";
    case "plainDate":
      return "PlainDate";
    case "plainTime":
      return "PlainTime";
    case "plainDateTime":
      return "PlainDateTime";
    case "zonedDateTime":
      return "ZonedDateTime";
    case "plainYearMonth":
      return "PlainYearMonth";
    case "plainMonthDay":
      return "PlainMonthDay";
    case "duration":
      return "Duration";
  }
}

function templateLiteralPartSource(part: string | ATS.AnyTypeSchema): string {
  return typeof part === "string" ? escapeRegExp(part) : templateLiteralSchemaSource(part);
}

function templateLiteralSchemaSource(schema: ATS.AnyTypeSchema): string {
  const current = schema as AnySchema;

  switch (current.type) {
    case TypeName.string:
      return "[\\s\\S]*";
    case TypeName.number:
      return "-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?";
    case TypeName.int:
      return "-?(?:0|[1-9]\\d*)";
    case TypeName.boolean:
      return "(?:true|false)";
    case TypeName.bigint:
      return "-?(?:0|[1-9]\\d*)";
    case TypeName.null:
      return "null";
    case TypeName.undefined:
      return "undefined";
    case TypeName.literal:
      return escapeRegExp(String(current.def.value));
    case TypeName.enum: {
      const values = Object.values(current.def.values as Record<string, string | number>);

      return values.length === 0 ? "(?!)" : `(?:${values.map((value) => escapeRegExp(String(value))).join("|")})`;
    }
    case TypeName.union:
    case TypeName.xor:
      return `(?:${(current.def.options as readonly ATS.AnyTypeSchema[])
        .map((option) => templateLiteralSchemaSource(option))
        .join("|")})`;
    case TypeName.optional:
      return `(?:${templateLiteralSchemaSource(current.def.innerType as ATS.AnyTypeSchema)}|undefined)`;
    case TypeName.nullable:
      return `(?:${templateLiteralSchemaSource(current.def.innerType as ATS.AnyTypeSchema)}|null)`;
    case TypeName.nullish:
      return `(?:${templateLiteralSchemaSource(current.def.innerType as ATS.AnyTypeSchema)}|null|undefined)`;
    case TypeName.default:
    case TypeName.brand:
    case TypeName.readonly:
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
      return templateLiteralSchemaSource(current.def.innerType as ATS.AnyTypeSchema);
    case TypeName.when:
      return `(?:${templateLiteralSchemaSource(current.def.thenType as ATS.AnyTypeSchema)}|${templateLiteralSchemaSource(current.def.otherwiseType as ATS.AnyTypeSchema)})`;
    case TypeName.lazy:
      return templateLiteralSchemaSource((current.def.getter as () => ATS.AnyTypeSchema)());
    default:
      throw new Error(`templateLiteral cannot compile ${current.type} parts`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
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

function appendIssuePath(path: PathRef, segments: readonly ATS.IssuePathSegment[] | undefined): PathRef {
  if (!segments || segments.length === 0) return path;

  const suffix = issuePathSuffix(segments, path.source !== "");

  if (path.kind === "static") {
    return { kind: "static", source: `${path.source}${suffix}` };
  }

  return { kind: "dynamic", source: `${path.source} + ${emitLiteral(suffix)}` };
}

function issuePathSuffix(segments: readonly ATS.IssuePathSegment[], hasBase: boolean): string {
  let suffix = "";
  let base = hasBase;

  for (const segment of segments) {
    if (typeof segment === "number") {
      suffix += `[${segment}]`;
      base = true;
      continue;
    }

    suffix += `${base ? "." : ""}${segment}`;
    base = true;
  }
  return suffix;
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
  const refines: RefineRecord[] = [];
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
        ...(Array.isArray(current.def.path) ? { path: current.def.path as readonly ATS.IssuePathSegment[] } : {}),
        ...(typeof current.def.when === "function" ? { when: emitter.bind(current.def.when) } : {}),
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

  return {
    base: current,
    optional,
    nullable,
    defaultValue,
    emptyAsUndefined: hasNoEmptyCheck(current),
    coerce,
    refines,
    pipes,
    fieldTransforms,
  };
}

function bindFieldTransforms(spec: unknown, emitter: ValidatorEmitter): Record<string, string> {
  const bindings: Record<string, string> = {};

  for (const [key, fn] of Object.entries(spec as Record<string, unknown>)) {
    if (typeof fn === "function") bindings[key] = emitter.bind(fn);
  }

  return bindings;
}

function hasNoEmptyCheck(schema: AnySchema): boolean {
  if (schema.type !== TypeName.string) return false;

  const checks = (schema.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];

  return checks.some((check) => check.kind === "noEmpty");
}

/** True when parse output can differ from the input for this subtree. */
export function needsBuild(schema: ATS.AnyTypeSchema): boolean {
  const current = schema as AnySchema;

  switch (current.type) {
    case TypeName.default:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
    // parseAsync settles promise wrappers, so the output always differs.
    case TypeName.promise:
    case TypeName.codec:
      return true;
    case TypeName.when:
      return (
        needsBuild(current.def.thenType as ATS.AnyTypeSchema) ||
        needsBuild(current.def.otherwiseType as ATS.AnyTypeSchema)
      );
    case TypeName.not:
      return false;
    case TypeName.optional:
    case TypeName.nullable:
    case TypeName.nullish:
    case TypeName.brand:
    case TypeName.readonly:
    case TypeName.refine:
      return needsBuild((current.def as { innerType: ATS.AnyTypeSchema }).innerType);
    case TypeName.string: {
      const checks = (current.def.checks as readonly SchemaCheckRecord[] | undefined) ?? [];

      if ((current.def as { coerce?: boolean }).coerce === true) return true;
      return checks.some(
        (check) =>
          check.kind === "trim" ||
          check.kind === "lowercase" ||
          check.kind === "uppercase" ||
          check.kind === "sanitize" ||
          check.kind === "noEmpty" ||
          check.kind === "format" ||
          check.kind === "phoneBR"
      );
    }
    case TypeName.number:
    case TypeName.int:
    case TypeName.boolean:
    case TypeName.bigint:
    case TypeName.date:
      return (current.def as { coerce?: boolean }).coerce === true;
    case TypeName.array:
    case TypeName.set:
      return needsBuild(current.def.element as ATS.AnyTypeSchema);
    case TypeName.map:
      return needsBuild(current.def.key as ATS.AnyTypeSchema) || needsBuild(current.def.value as ATS.AnyTypeSchema);
    case TypeName.union:
    case TypeName.xor:
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
      const catchall = current.def.catchall as ATS.AnyTypeSchema | undefined;

      if ((current.def.unknownKeys as string | undefined) === "strip") return true;
      if (catchall !== undefined && needsBuild(catchall)) return true;
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

export interface EmitValidatorOptions {
  readonly is?: boolean;
  readonly safeParse?: boolean;
  readonly safeParseAsync?: boolean;
}

/**
 * Emits `{ is, safeParse }` source for a schema. `is` is a pure boolean
 * type check with early returns; `safeParse` collects every issue with its
 * static path and returns `{ success, data | issues }`, rebuilding the
 * output only when defaults/coercions/transforms require it.
 */
/** True when the subtree contains a promise wrapper (drives safeParseAsync). */
function containsPromise(schema: ATS.AnyTypeSchema, seen = new Set<ATS.AnyTypeSchema>()): boolean {
  if (seen.has(schema)) return false;
  seen.add(schema);

  const current = schema as AnySchema & { readonly schema?: ATS.AnyTypeSchema };

  // Builder inputs ({ schema }) may appear on unvisited edges.
  if (current.def === undefined) {
    return current.schema !== undefined && containsPromise(current.schema, seen);
  }

  if (current.type === TypeName.promise) return true;

  const def = current.def as {
    innerType?: ATS.AnyTypeSchema;
    element?: ATS.AnyTypeSchema;
    key?: ATS.AnyTypeSchema;
    value?: ATS.AnyTypeSchema;
    input?: ATS.AnyTypeSchema;
    output?: ATS.AnyTypeSchema;
    thenType?: ATS.AnyTypeSchema;
    otherwiseType?: ATS.AnyTypeSchema;
    items?: readonly ATS.AnyTypeSchema[];
    rest?: ATS.AnyTypeSchema;
    options?: readonly ATS.AnyTypeSchema[];
    props?: Readonly<Record<string, ATS.AnyTypeSchema>>;
  };

  if (def.innerType && containsPromise(def.innerType, seen)) return true;
  if (def.element && containsPromise(def.element, seen)) return true;
  if (def.key && containsPromise(def.key, seen)) return true;
  if (def.value && containsPromise(def.value, seen)) return true;
  if (def.input && containsPromise(def.input, seen)) return true;
  if (def.output && containsPromise(def.output, seen)) return true;
  if (def.thenType && containsPromise(def.thenType, seen)) return true;
  if (def.otherwiseType && containsPromise(def.otherwiseType, seen)) return true;
  if (def.rest && containsPromise(def.rest, seen)) return true;
  if (def.items?.some((item) => containsPromise(item, seen))) return true;
  if (def.options?.some((option) => containsPromise(option, seen))) return true;
  if (def.props) {
    const props = def.props;

    if (Object.keys(props).some((key) => containsPromise(props[key], seen))) return true;
  }
  return false;
}

function rootHasReadonly(schema: ATS.AnyTypeSchema, seen = new Set<ATS.AnyTypeSchema>()): boolean {
  if (seen.has(schema)) return false;
  seen.add(schema);

  const current = schema as AnySchema;

  if (current.type === TypeName.readonly) return true;
  if (current.type === TypeName.lazy) return rootHasReadonly((current.def.getter as () => ATS.AnyTypeSchema)(), seen);

  switch (current.type) {
    case TypeName.optional:
    case TypeName.nullable:
    case TypeName.nullish:
    case TypeName.default:
    case TypeName.brand:
    case TypeName.refine:
    case TypeName.coerce:
    case TypeName.pipe:
    case TypeName.transform:
      return rootHasReadonly(current.def.innerType as ATS.AnyTypeSchema, seen);
    case TypeName.when:
      return (
        rootHasReadonly(current.def.thenType as ATS.AnyTypeSchema, seen) ||
        rootHasReadonly(current.def.otherwiseType as ATS.AnyTypeSchema, seen)
      );
    case TypeName.not:
      return rootHasReadonly(current.def.innerType as ATS.AnyTypeSchema, seen);
    default:
      return false;
  }
}

function emitFreezeOutput(writer: CodeWriter, output: string): void {
  writer.line(
    `if (${output} !== null && (typeof ${output} === "object" || typeof ${output} === "function")) { ${output} = Object.freeze(${output}); }`
  );
}

export function emitValidator(schema: ATS.AnyTypeSchema, options: EmitValidatorOptions = {}): EmittedValidator {
  const emitIs = options.is ?? true;
  const emitSafeParse = options.safeParse ?? true;
  const emitSafeParseAsync = options.safeParseAsync ?? true;
  const freezesOutput = rootHasReadonly(schema);
  let parseEmitter: ValidatorEmitter | undefined;

  if (emitSafeParse) {
    const emitter = new ValidatorEmitter("parse");

    parseEmitter = emitter;
    emitter.writer.line("function safeParse(value) {");
    emitter.writer.indent(() => {
      emitter.writer.line("const issues = [];");
      const output = emitter.emitNode(schema, "value", { kind: "static", source: "" });

      emitter.writer.line("if (issues.length !== 0) {");
      emitter.writer.indent(() => {
        emitter.writer.line("return { success: false, issues: issues };");
      });
      emitter.writer.line("}");
      if (freezesOutput) emitFreezeOutput(emitter.writer, output);
      emitter.writer.line(`return { success: true, data: ${output} };`);
    });
    emitter.writer.line("}");
  }

  // Promise-bearing schemas also get an awaited variant: same pipeline,
  // but promise wrappers settle (`await`) and validate the resolved value.
  let asyncEmitter: ValidatorEmitter | undefined;

  if (emitSafeParseAsync && containsPromise(schema)) {
    const emitter = new ValidatorEmitter("parse", true);

    asyncEmitter = emitter;
    for (const value of parseEmitter?.bindings().values ?? []) emitter.bind(value);

    emitter.writer.line("async function safeParseAsync(value) {");
    emitter.writer.indent(() => {
      emitter.writer.line("const issues = [];");
      const output = emitter.emitNode(schema, "value", { kind: "static", source: "" });

      emitter.writer.line("if (issues.length !== 0) {");
      emitter.writer.indent(() => {
        emitter.writer.line("return { success: false, issues: issues };");
      });
      emitter.writer.line("}");
      if (freezesOutput) emitFreezeOutput(emitter.writer, output);
      emitter.writer.line(`return { success: true, data: ${output} };`);
    });
    emitter.writer.line("}");
  }

  let isEmitter: ValidatorEmitter | undefined;

  // Bind the same values in the same order so every function can share one
  // Function parameter list; extras from either emitter are appended after.
  if (emitIs) {
    const emitter = new ValidatorEmitter("is");

    isEmitter = emitter;
    for (const value of (asyncEmitter ?? parseEmitter)?.bindings().values ?? []) emitter.bind(value);

    emitter.writer.line("function is(value) {");
    emitter.writer.indent(() => {
      emitter.emitNode(schema, "value", { kind: "static", source: "" });
      emitter.writer.line("return true;");
    });
    emitter.writer.line("}");
  }

  const emitters = [isEmitter, parseEmitter, asyncEmitter].filter((emitter): emitter is ValidatorEmitter =>
    Boolean(emitter)
  );
  const bindings = (isEmitter ?? asyncEmitter ?? parseEmitter)?.bindings() ?? { names: [], values: [] };
  const helperBlocks = emitters.flatMap((emitter) => emitter.helpers());
  const helperSource = helperBlocks.length > 0 ? `${helperBlocks.join("\n")}\n` : "";
  const functionSource = emitters.map((emitter) => emitter.writer.toString()).join("\n");
  const returnedEntries = [
    ...(isEmitter ? ["is: is"] : []),
    ...(parseEmitter ? ["safeParse: safeParse"] : []),
    ...(asyncEmitter ? ["safeParseAsync: safeParseAsync"] : []),
  ];
  const returned = `return { ${returnedEntries.join(", ")} };`;
  const source = `${helperSource}${functionSource}${functionSource.length > 0 ? "\n" : ""}${returned}`;

  return { source, bindings };
}
