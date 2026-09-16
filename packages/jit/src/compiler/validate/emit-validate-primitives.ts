import type * as ATS from "../../core/ats/index.js";
import { emitPropertyAccess } from "../source/access.js";
import { emitLiteral } from "../source/literal.js";
import type { AnySchema, PathRef, ValidatorEmitter } from "./emit-validate.js";
import { buildTemplateLiteralRegex } from "./emit-validate-helpers.js";

export function emitWhen(
  emitter: ValidatorEmitter,
  schema: AnySchema,
  valueExpr: string,
  path: PathRef,
  contextExpr: string | undefined
): string {
  const sibling = contextExpr ? emitPropertyAccess(contextExpr, schema.def.key as string) : "undefined";
  const matcher = schema.def.is;
  const test =
    typeof matcher === "function"
      ? `${emitter.bind(matcher)}(${sibling})`
      : `${sibling} === ${emitLiteral(matcher as never)}`;

  if (emitter.mode === "is") {
    emitter.writer.line(`if (${test}) {`);
    emitter.writer.indent(() => {
      emitter.emitNode(schema.def.thenType as ATS.AnyTypeSchema, valueExpr, path, contextExpr);
    });
    emitter.writer.line("} else {");
    emitter.writer.indent(() => {
      emitter.emitNode(schema.def.otherwiseType as ATS.AnyTypeSchema, valueExpr, path, contextExpr);
    });
    emitter.writer.line("}");
    return valueExpr;
  }

  const out = emitter.nextVar("w");

  emitter.writer.line(`let ${out};`);
  emitter.writer.line(`if (${test}) {`);
  emitter.writer.indent(() => {
    const branchOut = emitter.emitNode(schema.def.thenType as ATS.AnyTypeSchema, valueExpr, path, contextExpr);

    emitter.writer.line(`${out} = ${branchOut};`);
  });
  emitter.writer.line("} else {");
  emitter.writer.indent(() => {
    const branchOut = emitter.emitNode(schema.def.otherwiseType as ATS.AnyTypeSchema, valueExpr, path, contextExpr);

    emitter.writer.line(`${out} = ${branchOut};`);
  });
  emitter.writer.line("}");
  return out;
}

/**
 * Emits a fail-or-descend gate: on type failure records the issue and
 * skips the nested block, so children never touch a wrong-typed value.
 */
export function typeGate(
  emitter: ValidatorEmitter,
  failCondition: string,
  path: PathRef,
  code: string,
  expected: string,
  message: string,
  body: () => void,
  received?: string
): void {
  const writer = emitter.writer;

  if (!emitter.validationEnabled) {
    body();
    return;
  }

  if (emitter.mode === "is") {
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
    emitter.emitFail(path, code, expected, message, received);
  });
  writer.line("} else {");
  writer.indent(body);
  writer.line("}");
}

export function emitTypeofLeaf(
  emitter: ValidatorEmitter,
  schema: AnySchema,
  value: string,
  path: PathRef,
  expected: string
): string {
  emitter.failIf(
    `typeof ${value} !== "${expected}"`,
    path,
    `expected_${expected}`,
    expected,
    emitter.requiredMessage(schema, `expected ${expected}`)
  );
  return value;
}

export function requiredMessage(_emitter: ValidatorEmitter, schema: AnySchema, fallback: string): string {
  return typeof schema.def.requiredMessage === "string" ? schema.def.requiredMessage : fallback;
}

export function emitJson(emitter: ValidatorEmitter, schema: AnySchema, value: string, path: PathRef): string {
  emitter.failIf(
    `!${emitter.emitJsonPredicate()}(${value})`,
    path,
    "invalid_json",
    "JSON value",
    emitter.requiredMessage(schema, "expected a JSON-encodable value")
  );
  return value;
}

export function emitCustom(emitter: ValidatorEmitter, schema: AnySchema, value: string, path: PathRef): string {
  const predicate = schema.def.predicate as ((value: unknown) => boolean) | undefined;

  if (predicate) {
    emitter.failIf(
      `!${emitter.bindValidation(predicate)}(${value})`,
      path,
      "custom",
      "custom",
      (schema.def.message as string | undefined) ?? "custom predicate rejected the value"
    );
  }
  return value;
}

export function emitNot(emitter: ValidatorEmitter, schema: AnySchema, value: string, path: PathRef): string {
  const inner = schema.def.innerType as ATS.AnyTypeSchema;

  emitter.failIf(
    `${emitter.emitOptionPredicate(inner)}(${value})`,
    path,
    "invalid_not",
    "not",
    emitter.requiredMessage(schema, "value matched a forbidden schema")
  );
  return value;
}

export function emitTemplateLiteral(
  emitter: ValidatorEmitter,
  schema: AnySchema,
  value: string,
  path: PathRef
): string {
  const regex = buildTemplateLiteralRegex(schema.def.parts as readonly (string | ATS.AnyTypeSchema)[]);

  emitter.typeGate(
    `typeof ${value} !== "string"`,
    path,
    "expected_string",
    "string",
    emitter.requiredMessage(schema, "expected string"),
    () => {
      emitter.failIf(
        `!${emitter.bindValidation(regex)}.test(${value})`,
        path,
        "invalid_template_literal",
        "template literal",
        emitter.requiredMessage(schema, "expected a matching template literal string")
      );
    },
    `typeof ${value}`
  );
  return value;
}

export function emitCodec(emitter: ValidatorEmitter, schema: AnySchema, value: string, path: PathRef): string {
  const input = schema.def.input as ATS.AnyTypeSchema;
  const inputOut = emitter.emitNode(input, value, path);

  if (emitter.mode === "is") return value;

  const decoded = emitter.nextVar("c");

  emitter.writer.line(`let ${decoded};`);
  emitter.writer.line("try {");
  emitter.writer.indent(() => {
    emitter.writer.line(`${decoded} = ${emitter.bind(schema.def.decode)}(${inputOut});`);
  });
  emitter.writer.line("} catch {");
  emitter.writer.indent(() => {
    emitter.emitFail(path, "invalid_codec", "codec decode", "codec decode failed");
  });
  emitter.writer.line("}");
  return emitter.emitNode(schema.def.output as ATS.AnyTypeSchema, decoded, path);
}

export function emitJsonPredicate(emitter: ValidatorEmitter): string {
  const name = `${emitter.rootMode === "is" ? "ij" : "pj"}${++emitter.helperCounter}`;

  emitter.helperSources.push(`function ${name}(value) {
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
