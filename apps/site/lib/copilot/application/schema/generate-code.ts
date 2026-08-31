/**
 * SchemaIntent in, TypeScript out — §45.
 *
 * Every character of the result is decided here, and that is the guarantee the
 * feature rests on: the model chose `uuid` from a list, and this file chose
 * `JIT.string().uuid()`. There is no path by which a name the model wrote
 * reaches the page unexamined, because names are not what the model sends.
 *
 * The emitter is intentionally boring. Fixed order for the chain, one field
 * per line, arguments serialized as JSON literals. Boring is what makes the
 * output diffable between two runs of the same request, which is what makes a
 * generation benchmark (§74) mean anything at all.
 */
import type { SchemaDefault, SchemaField, SchemaIntent, SchemaValidator } from "../../core/entities/schema-intent";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export interface GenerateOptions {
  /** The import line. Runtime by default; AOT files import from `/define`. */
  entrypoint?: "runtime" | "define";
  /** Emitted above the constant, when the request is worth recording. */
  header?: string;
}

/**
 * The whole file, ready to paste.
 *
 * The import is included because a snippet without it is not something a
 * reader can run, and the workspace restores that exact line anyway — a
 * generated file that disagrees with it would be corrected on first edit.
 */
export function generateSchemaFile(intent: SchemaIntent, options: GenerateOptions = {}): string {
  const entrypoint = options.entrypoint ?? "runtime";
  const lines = [`import { JIT } from "@jit-compiler/jit/${entrypoint}";`, ""];

  if (options.header) lines.push(`// ${options.header}`);
  lines.push(generateSchemaCode(intent));

  return `${lines.join("\n")}\n`;
}

/** Just the declaration, for embedding in an answer that has its own imports. */
export function generateSchemaCode(intent: SchemaIntent): string {
  const name = intent.name && IDENTIFIER.test(intent.name) ? intent.name : "Schema";
  return `export const ${name} = ${objectExpression(intent.fields, 0)};`;
}

function objectExpression(fields: readonly SchemaField[], depth: number): string {
  const pad = "  ".repeat(depth + 1);
  const closing = "  ".repeat(depth);

  const rows = fields.map((field) => {
    const comment = field.description ? `${pad}// ${field.description.replace(/\s+/g, " ").trim()}\n` : "";
    return `${comment}${pad}${key(field.name)}: ${fieldExpression(field, depth + 1)},`;
  });

  return `JIT.object({\n${rows.join("\n")}\n${closing}})`;
}

/** A bare key where it is legal, a quoted one where it is not. */
function key(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

/**
 * One field, as an expression.
 *
 * The chain order is fixed: the factory, the validators the model chose in the
 * order it chose them, then nullable, then optional, then the default. The
 * default goes last because that is how every example in the documentation
 * writes it, and generated code that reads like the documentation is code a
 * reader can check against it.
 */
function fieldExpression(field: SchemaField, depth: number): string {
  let expression: string;

  switch (field.type) {
    case "object":
      expression = objectExpression(field.fields ?? [], depth);
      break;
    case "array":
      expression = `JIT.array(${field.items ? fieldExpression(field.items, depth) : "JIT.any()"})`;
      break;
    case "enum":
      expression = `JIT.enum([${(field.values ?? []).map((value) => JSON.stringify(value)).join(", ")}])`;
      break;
    default:
      expression = `JIT.${field.type}()`;
  }

  for (const validator of field.validators ?? []) {
    expression += `.${validator.type}(${argument(field, validator)})`;
  }

  if (field.nullable) expression += ".nullable()";
  if (field.optional) expression += ".optional()";
  if (field.default) expression += `.default(${defaultExpression(field.default)})`;

  return expression;
}

function argument(field: SchemaField, validator: SchemaValidator): string {
  if (validator.value === undefined) return "";

  // A date bound is written as a date, not as the string the protocol carries.
  // `verifyIntent` has already refused anything `Date.parse` cannot read.
  if (field.type === "date" && typeof validator.value === "string") {
    return `new Date(${JSON.stringify(validator.value)})`;
  }

  if (field.type === "bigint" && typeof validator.value === "number") {
    return `${Math.trunc(validator.value)}n`;
  }

  return JSON.stringify(validator.value);
}

function defaultExpression(value: SchemaDefault): string {
  switch (value.type) {
    // Both are functions rather than values on purpose: a literal `new Date()`
    // in a schema is one timestamp shared by every parse forever after.
    case "crypto.randomUUID":
      return "() => crypto.randomUUID()";
    case "now":
      return "() => new Date()";
    default:
      return JSON.stringify(value.value);
  }
}
