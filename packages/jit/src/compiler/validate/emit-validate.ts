import type * as ATS from "../../core/ats/index.js";
import { TypeName } from "../../core/ats/index.js";
import { emitOpChain, type OpChain } from "../../core/ops.js";
import { CodeWriter } from "../emitter/code-writer.js";
import { resolveLazySchema } from "../schema-recursion.js";
import { emitSchemaGuard } from "../source/guard.js";
import { emitLiteral, emitObjectKey } from "../source/literal.js";
import {
  emitArray as emitArrayImpl,
  emitDiscriminatedUnion as emitDiscriminatedUnionImpl,
  emitMap as emitMapImpl,
  emitObject as emitObjectImpl,
  emitOptionPredicate as emitOptionPredicateImpl,
  emitRecord as emitRecordImpl,
  emitSet as emitSetImpl,
  emitTuple as emitTupleImpl,
  emitUnion as emitUnionImpl,
  emitXor as emitXorImpl,
} from "./emit-validate-collections.js";
import { appendIssuePath, needsBuild, rootPath, unwrapValidation } from "./emit-validate-helpers.js";
import {
  emitCodec as emitCodecImpl,
  emitCustom as emitCustomImpl,
  emitJson as emitJsonImpl,
  emitJsonPredicate as emitJsonPredicateImpl,
  emitNot as emitNotImpl,
  emitTemplateLiteral as emitTemplateLiteralImpl,
  emitTypeofLeaf as emitTypeofLeafImpl,
  emitWhen as emitWhenImpl,
  requiredMessage as requiredMessageImpl,
  typeGate as typeGateImpl,
} from "./emit-validate-primitives.js";
import {
  dateLikeBound as dateLikeBoundImpl,
  dateLikeCompare as dateLikeCompareImpl,
  emitDate as emitDateImpl,
  emitDateLikeChecks as emitDateLikeChecksImpl,
  emitTemporal as emitTemporalImpl,
  truncateFailure as truncateFailureImpl,
} from "./emit-validate-temporal.js";
import { emitNumber as emitNumberImpl, emitString as emitStringImpl } from "./emit-validate-text.js";

/** @internal Schema shape used by the validator emitter. */
export type AnySchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };

/** @internal Normalized validation check metadata. */
export interface SchemaCheckRecord {
  readonly kind: string;
  readonly value?: unknown;
  readonly message?: string;
}

/** @internal Normalized refinement metadata. */
export interface RefineRecord {
  readonly binding: string;
  readonly message?: string;
  readonly path?: readonly ATS.IssuePathSegment[];
  readonly when?: string;
}

/** Wrapper pipeline resolved outside-in for one schema node. */
/**
 * A transform is either a bound callback (opaque to the emitter) or a
 * declarative chain the emitter can write out as source.
 */
/** @internal A transform represented as a binding or inline operation chain. */
export type PipeStep =
  | { readonly kind: "call"; readonly binding: string }
  | { readonly kind: "inline"; readonly chain: OpChain };

/** @internal Wrapper metadata consumed by the validator emitter. */
export interface UnwrappedSchema {
  readonly base: AnySchema;
  readonly optional: boolean;
  readonly nullable: boolean;
  readonly defaultValue: { readonly binding: string; readonly isFactory: boolean } | undefined;
  readonly emptyAsUndefined: boolean;
  readonly coerce: string | undefined;
  readonly refines: readonly RefineRecord[];
  readonly pipes: readonly PipeStep[];
  readonly fieldTransforms: Readonly<Record<string, string>> | undefined;
  readonly materialize: string | undefined;
  readonly trustedMaterialize: boolean;
  readonly assertion: string | undefined;
  readonly nestedValidation: boolean;
}

/**
 * Machine-readable detail a diagnostic carries beside its code.
 *
 * This is what a translator needs and a message cannot give: the bound itself,
 * not a sentence containing it. Only checks that have one declare it, so an
 * issue never allocates an object to say nothing.
 */
type CheckParams = Readonly<Record<string, string | number | boolean | readonly (string | number)[]>>;

function emitCheckParams(params: CheckParams): string {
  const entries = Object.entries(params).map(([key, value]) => `${emitObjectKey(key)}: ${JSON.stringify(value)}`);

  return `{ ${entries.join(", ")} }`;
}

/** Static-when-possible issue path; loops switch it to a dynamic expression. */
/** @internal Static or dynamic issue path source. */
export interface PathRef {
  readonly kind: "static" | "dynamic";
  /** JavaScript expression evaluating to `readonly PropertyKey[]`. */
  readonly source: string;
  /** Present while every segment is known to the compiler. */
  readonly segments?: readonly ATS.IssuePathSegment[];
  /** Segment expressions known in the current emitter; avoids nested spread arrays in loops. */
  readonly parts?: readonly string[];
}

export interface ValidatorBindings {
  readonly names: readonly string[];
  readonly values: readonly unknown[];
}

/** @internal Stateful source emitter shared by boolean and diagnostic validators. */
export class ValidatorEmitter {
  writer = new CodeWriter();
  readonly rootMode: "is" | "parse" | "fast";
  readonly bindingNames: string[] = [];
  readonly bindingValues: unknown[] = [];
  readonly bindingIds = new Map<unknown, string>();
  readonly helperSources: string[] = [];
  readonly predicateNames = new Map<ATS.AnyTypeSchema, string>();
  /** Schemas that close a cycle; each becomes one named recursive helper. */
  recursive: ReadonlySet<ATS.AnyTypeSchema> = new Set();
  readonly recursiveNames = new Map<ATS.AnyTypeSchema, string>();
  helperCounter = 0;
  varCounter = 0;
  mode: "is" | "parse" | "fast";
  awaited: boolean;
  validationEnabled: boolean;

  constructor(
    mode: "is" | "parse" | "fast",
    awaited = false,
    readonly resolveDefaults = true,
    readonly materializeRuntimeTypes = true,
    readonly maxIssues: number | undefined = undefined,
    validationEnabled = true
  ) {
    this.mode = mode;
    this.awaited = awaited;
    this.rootMode = mode;
    this.validationEnabled = validationEnabled;
  }

  bindings(): ValidatorBindings {
    return { names: this.bindingNames, values: this.bindingValues };
  }

  helpers(): readonly string[] {
    return this.helperSources;
  }

  /**
   * Declares which schemas take part in a cycle. Those are expanded once into
   * a named function that calls itself, instead of being inlined forever.
   */
  markRecursive(schemas: ReadonlySet<ATS.AnyTypeSchema>): void {
    this.recursive = schemas;
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

  bindValidation(value: unknown): string {
    return this.validationEnabled ? this.bind(value) : "undefined";
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
    if (this.recursive.size > 0) {
      const target = resolveLazySchema(schema);

      // A cycle participant is reached through its own function, so the
      // generated source stays finite and the call is a real recursive call.
      if (this.recursive.has(target)) return this.emitRecursiveCall(target, valueExpr, path);
    }

    return this.emitInline(schema, valueExpr, path, contextExpr);
  }

  /** Expands a schema in place, bypassing the recursion guard for this node. */
  emitInline(schema: ATS.AnyTypeSchema, valueExpr: string, path: PathRef, contextExpr?: string): string {
    const current = schema as AnySchema;

    if (current.type === TypeName.when) {
      return this.emitWhen(current, valueExpr, path, contextExpr);
    }

    const unwrapped = unwrapValidation(schema, this);
    const previousValidation = this.validationEnabled;
    this.validationEnabled = previousValidation || unwrapped.nestedValidation;
    const writer = this.writer;
    const holder = this.nextVar("v");
    const output = this.nextVar("o");
    // The output variable is only real when parse can produce a value that
    // differs from the input. Otherwise every write to it is a dead store and
    // the holder already is the answer, so the subtree emits neither.
    const builds = this.mode !== "is" && needsBuild(schema);

    writer.line(`let ${holder} = ${valueExpr};`);
    if (builds) writer.line(`let ${output} = ${holder};`);

    const finish = () => {
      this.validationEnabled = previousValidation;
      return builds ? output : holder;
    };

    if (unwrapped.emptyAsUndefined) {
      writer.line(`if (${holder} === "") {`);
      writer.indent(() => {
        writer.line(`${holder} = undefined;`);
        if (builds) writer.line(`${output} = ${holder};`);
      });
      writer.line("}");
    }

    const emitValidated = () => {
      if (unwrapped.coerce) {
        writer.line(`${holder} = ${unwrapped.coerce}(${holder});`);
        if (builds) writer.line(`${output} = ${holder};`);
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

      if (builds) {
        // Re-sync unconditionally: string checks may have mutated the holder
        // (trim/case) after the initial `output = holder` capture.
        writer.line(`${output} = ${innerOut};`);
        for (const pipe of unwrapped.pipes) {
          // A declarative chain becomes real source; a callback stays a call.
          writer.line(
            pipe.kind === "inline"
              ? `${output} = ${emitOpChain(pipe.chain, output, (value) => this.bind(value))};`
              : `${output} = ${pipe.binding}(${output});`
          );
        }
        if (unwrapped.materialize)
          writer.line(
            `${output} = ${unwrapped.trustedMaterialize ? `${unwrapped.materialize}.__jitMaterialize` : `new ${unwrapped.materialize}`}(${output}${unwrapped.trustedMaterialize ? "" : ", true"});`
          );
        if (unwrapped.assertion) this.emitNestedAssertion(unwrapped.assertion, output, path);
      }
    };

    if (unwrapped.defaultValue) {
      const { binding, isFactory } = unwrapped.defaultValue;
      const defaultExpr = isFactory ? `${binding}()` : binding;

      if (this.mode !== "is") {
        writer.line(`if (${holder} === undefined) {`);
        writer.indent(() => {
          writer.line(`${output} = ${defaultExpr};`);
          if (unwrapped.materialize)
            writer.line(
              `${output} = ${unwrapped.trustedMaterialize ? `${unwrapped.materialize}.__jitMaterialize` : `new ${unwrapped.materialize}`}(${output}${unwrapped.trustedMaterialize ? "" : ", true"});`
            );
          if (unwrapped.assertion) this.emitNestedAssertion(unwrapped.assertion, output, path);
        });
        if (unwrapped.nullable) {
          writer.line(`} else if (${holder} === null) {`);
          writer.indent(() => {
            writer.line(`${output} = ${holder};`);
          });
        }
        writer.line("} else {");
        writer.indent(emitValidated);
        writer.line("}");
      } else {
        writer.line(`if (${holder} !== undefined && ${unwrapped.nullable ? `${holder} !== null` : "true"}) {`);
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

  /**
   * Calls the named function for a recursive schema. In `is` mode the helper
   * answers a boolean; in parse mode it takes the issue list and the current
   * path so failures keep reporting the position in the real value.
   */
  emitRecursiveCall(schema: ATS.AnyTypeSchema, valueExpr: string, path: PathRef): string {
    const name = this.recursiveHelper(schema);
    const writer = this.writer;

    if (this.mode === "is") {
      const holder = this.nextVar("v");

      writer.line(`const ${holder} = ${valueExpr};`);
      writer.line(`if (!${name}(${holder})) return false;`);
      return holder;
    }

    const output = this.nextVar("o");
    writer.line(`const ${output} = ${this.awaited ? "await " : ""}${name}(${valueExpr}, issues, ${path.source});`);
    return output;
  }

  recursiveHelper(schema: ATS.AnyTypeSchema): string {
    const existing = this.recursiveNames.get(schema);

    if (existing) return existing;

    const name = `${this.rootMode === "is" ? "ir" : "pr"}${++this.helperCounter}`;

    // Registered before the body is emitted, so the back-edge inside it
    // resolves to this same name instead of recursing at emit time.
    this.recursiveNames.set(schema, name);

    const savedWriter = this.writer;

    this.writer = new CodeWriter();
    if (this.mode === "is") {
      this.writer.line(`function ${name}(value) {`);
      this.writer.indent(() => {
        this.emitInline(schema, "value", rootPath());
        this.writer.line("return true;");
      });
      this.writer.line("}");
    } else {
      this.writer.line(`${this.awaited ? "async " : ""}function ${name}(value, issues, path) {`);
      this.writer.indent(() => {
        const output = this.emitInline(schema, "value", {
          kind: "dynamic",
          source: "path",
        });

        this.writer.line(`return ${output};`);
      });
      this.writer.line("}");
    }
    this.helperSources.push(this.writer.toString());
    this.writer = savedWriter;

    return name;
  }

  /** Emits `if (<failCondition>) { fail }` — early return or issue push. */
  failIf(
    failCondition: string,
    path: PathRef,
    code: string,
    expected: string,
    message: string,
    params?: CheckParams
  ): void {
    if (!this.validationEnabled) return;
    const writer = this.writer;

    writer.line(`if (${failCondition}) {`);
    writer.indent(() => {
      this.emitFail(path, code, expected, message, undefined, params);
    });
    writer.line("}");
  }

  emitFail(
    path: PathRef,
    code: string,
    expected: string,
    message: string,
    received?: string,
    params?: CheckParams
  ): void {
    if (!this.validationEnabled) return;
    const writer = this.writer;

    if (this.mode === "is") {
      writer.line("return false;");
      return;
    }

    const receivedPart = received ? `, received: ${received}` : "";
    // A bound only reaches an issue when the check actually declares one, so
    // no issue carries an empty object nobody asked for.
    const paramsPart = params === undefined ? "" : `, params: ${emitCheckParams(params)}`;

    if (this.mode === "fast") {
      writer.line(
        `throw { __jitFastValidation: true, issues: [{ path: ${path.source}, code: ${emitLiteral(code)}, expected: ${emitLiteral(expected)}, message: ${emitLiteral(message)}${receivedPart}${paramsPart} }] };`
      );
      return;
    }

    writer.line(
      `(issues ||= [])[issues.length] = { path: ${path.source}, code: ${emitLiteral(code)}, expected: ${emitLiteral(expected)}, message: ${emitLiteral(message)}${receivedPart}${paramsPart} };`
    );
    if (this.maxIssues !== undefined) writer.line(`if (issues.length === ${this.maxIssues}) throw __issueLimit;`);
  }

  emitNestedAssertion(binding: string, value: string, path: PathRef): void {
    if (!this.validationEnabled) return;
    if (this.mode === "is") {
      this.writer.line(`if (${binding}(${value}) !== undefined) return false;`);
      return;
    }
    const outcome = this.nextVar("assertion");
    this.writer.line(`const ${outcome} = ${binding}(${value});`);
    this.writer.line(`if (${outcome} !== undefined) {`);
    this.writer.indent(() => {
      this.writer.line(`for (const issue of ${outcome}.issues) {`);
      this.writer.indent(() => {
        const issuePath = path.source === "[]" ? "issue.path" : `[...${path.source}, ...issue.path]`;
        this.writer.line(
          `(issues ||= [])[issues.length] = { path: ${issuePath}, code: issue.code, expected: issue.expected, message: issue.message };`
        );
        if (this.maxIssues !== undefined)
          this.writer.line(`if (issues.length === ${this.maxIssues}) throw __issueLimit;`);
      });
      this.writer.line("}");
    });
    this.writer.line("}");
  }

  /** Type guard + checks + children for the unwrapped base schema. */
  emitBase(unwrapped: UnwrappedSchema, value: string, path: PathRef): string {
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
        this.emitFail(path, "invalid_type", "never", this.requiredMessage(schema, "no value is assignable to never"));
        return value;
      case TypeName.void:
      case TypeName.undefined:
        this.failIf(
          `${value} !== undefined`,
          path,
          "invalid_type",
          "undefined",
          this.requiredMessage(schema, "expected undefined")
        );
        return value;
      case TypeName.null:
        this.failIf(`${value} !== null`, path, "invalid_type", "null", this.requiredMessage(schema, "expected null"));
        return value;
      case TypeName.nan:
        this.failIf(`${value} === ${value}`, path, "invalid_type", "nan", this.requiredMessage(schema, "expected NaN"));
        return value;
      case TypeName.string:
        return this.emitString(schema, value, path);
      case TypeName.number:
        return this.emitNumber(schema, value, path, false);
      case TypeName.int:
        return this.emitNumber(schema, value, path, true);
      case TypeName.boolean:
        return this.emitTypeofLeaf(schema, value, path, "boolean");
      case TypeName.bigint:
        return this.emitTypeofLeaf(schema, value, path, "bigint");
      case TypeName.symbol:
        return this.emitTypeofLeaf(schema, value, path, "symbol");
      case TypeName.date:
        return this.emitDate(schema, value, path);
      case TypeName.regex:
        this.failIf(
          `!(${value} instanceof RegExp)`,
          path,
          "invalid_type",
          "RegExp",
          this.requiredMessage(schema, "expected a RegExp")
        );
        return value;
      case TypeName.file:
        this.failIf(
          `!(typeof File !== "undefined" && ${value} instanceof File)`,
          path,
          "invalid_type",
          "File",
          this.requiredMessage(schema, "expected a File")
        );
        return value;
      case TypeName.json:
        return this.emitJson(schema, value, path);
      case TypeName.custom:
        return this.emitCustom(schema, value, path);
      case TypeName.not:
        return this.emitNot(schema, value, path);
      case TypeName.templateLiteral:
        return this.emitTemplateLiteral(schema, value, path);
      case TypeName.function:
        this.failIf(
          `typeof ${value} !== "function"`,
          path,
          "expected_function",
          "function",
          this.requiredMessage(schema, "expected function")
        );
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

        this.failIf(
          test,
          path,
          "invalid_literal",
          literalText,
          this.requiredMessage(schema, `expected literal ${literalText}`)
        );
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
          this.requiredMessage(schema, "expected one of the enum values")
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
        const rebuild = this.mode !== "is" && options.some((option) => needsBuild(option));
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

        this.failIf(
          `!(${guard})`,
          path,
          "invalid_type",
          "instance",
          this.requiredMessage(schema, "expected a class instance")
        );
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
          this.requiredMessage(schema, "expected a thenable")
        );
        return value;
      }
      default:
        return value;
    }
  }

  emitWhen(schema: AnySchema, valueExpr: string, path: PathRef, contextExpr: string | undefined): string {
    return emitWhenImpl(this, schema, valueExpr, path, contextExpr);
  }
  typeGate(
    failCondition: string,
    path: PathRef,
    code: string,
    expected: string,
    message: string,
    body: () => void,
    received?: string
  ): void {
    typeGateImpl(this, failCondition, path, code, expected, message, body, received);
  }
  emitTypeofLeaf(schema: AnySchema, value: string, path: PathRef, expected: string): string {
    return emitTypeofLeafImpl(this, schema, value, path, expected);
  }
  requiredMessage(schema: AnySchema, fallback: string): string {
    return requiredMessageImpl(this, schema, fallback);
  }
  emitJson(schema: AnySchema, value: string, path: PathRef): string {
    return emitJsonImpl(this, schema, value, path);
  }
  emitCustom(schema: AnySchema, value: string, path: PathRef): string {
    return emitCustomImpl(this, schema, value, path);
  }
  emitNot(schema: AnySchema, value: string, path: PathRef): string {
    return emitNotImpl(this, schema, value, path);
  }
  emitTemplateLiteral(schema: AnySchema, value: string, path: PathRef): string {
    return emitTemplateLiteralImpl(this, schema, value, path);
  }
  emitDate(schema: AnySchema, value: string, path: PathRef): string {
    return emitDateImpl(this, schema, value, path);
  }
  emitTemporal(schema: AnySchema, value: string, path: PathRef): string {
    return emitTemporalImpl(this, schema, value, path);
  }
  emitDateLikeChecks(
    checks: readonly SchemaCheckRecord[],
    value: string,
    path: PathRef,
    target: "date" | ATS.TemporalKind
  ): void {
    emitDateLikeChecksImpl(this, checks, value, path, target);
  }
  dateLikeBound(value: unknown, target: "date" | ATS.TemporalKind): string {
    return dateLikeBoundImpl(this, value, target);
  }
  dateLikeCompare(value: string, bound: string, target: "date" | ATS.TemporalKind, operator: "<" | ">"): string {
    return dateLikeCompareImpl(this, value, bound, target, operator);
  }
  truncateFailure(value: string, unit: ATS.TemporalUnit, target: "date" | ATS.TemporalKind): string {
    return truncateFailureImpl(this, value, unit, target);
  }
  emitCodec(schema: AnySchema, value: string, path: PathRef): string {
    return emitCodecImpl(this, schema, value, path);
  }
  emitJsonPredicate(): string {
    return emitJsonPredicateImpl(this);
  }
  emitString(schema: AnySchema, value: string, path: PathRef): string {
    return emitStringImpl(this, schema, value, path);
  }
  emitNumber(schema: AnySchema, value: string, path: PathRef, forceInteger: boolean): string {
    return emitNumberImpl(this, schema, value, path, forceInteger);
  }

  emitArray(schema: AnySchema, value: string, path: PathRef): string {
    return emitArrayImpl(this, schema, value, path);
  }
  emitTuple(schema: AnySchema, value: string, path: PathRef): string {
    return emitTupleImpl(this, schema, value, path);
  }
  emitSet(schema: AnySchema, value: string, path: PathRef): string {
    return emitSetImpl(this, schema, value, path);
  }
  emitMap(schema: AnySchema, value: string, path: PathRef): string {
    return emitMapImpl(this, schema, value, path);
  }
  emitRecord(schema: AnySchema, value: string, path: PathRef): string {
    return emitRecordImpl(this, schema, value, path);
  }
  emitObject(
    schema: AnySchema,
    value: string,
    path: PathRef,
    fieldTransforms: Readonly<Record<string, string>> | undefined
  ): string {
    return emitObjectImpl(this, schema, value, path, fieldTransforms);
  }
  emitUnion(schema: AnySchema, value: string, path: PathRef): string {
    return emitUnionImpl(this, schema, value, path);
  }
  emitXor(schema: AnySchema, value: string, path: PathRef): string {
    return emitXorImpl(this, schema, value, path);
  }
  emitOptionPredicate(option: ATS.AnyTypeSchema): string {
    return emitOptionPredicateImpl(this, option);
  }
  emitDiscriminatedUnion(schema: AnySchema, value: string, path: PathRef): string {
    return emitDiscriminatedUnionImpl(this, schema, value, path);
  }
}
