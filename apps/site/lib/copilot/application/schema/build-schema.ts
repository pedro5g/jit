/**
 * The intent, built as a live jit schema.
 *
 * §56 asks generated code to pass symbol validation and syntax validation, and
 * says compilation belongs to a later phase. This is the part of compilation
 * that costs nothing and needs no Lab: the same intent that produced the
 * printed code also constructs a real schema and parses one value with it, so
 * a factory that does not exist, a call that throws, or a default that cannot
 * run is found here rather than by the reader.
 *
 * What it deliberately does **not** prove is that a method belongs on that
 * kind. Every builder shares one prototype, so `JIT.boolean().email()`
 * constructs happily and parses `true` without complaint — the constraint is
 * erased at runtime and enforced only by the conditional type. `verifyIntent`
 * is the gate for that, and this function is not a second opinion on it. Two
 * checks with different reach, and neither one covering for the other, is the
 * honest arrangement; a build check that appeared to validate kinds would be
 * worse than none, because it would be trusted.
 *
 * It is a second consumer of the intent rather than an evaluation of the
 * emitted string. Executing generated text would be the one place the model
 * could reach arbitrary JavaScript (§81); building from the structure cannot,
 * because the structure holds no code.
 */
import { JIT } from "@jit-compiler/jit/runtime";
import type { SchemaDefault, SchemaField, SchemaIntent } from "../../core/entities/schema-intent";

/** Loose on purpose: the chain is dynamic, and the surface is checked already. */
type AnySchema = { [method: string]: (...args: unknown[]) => AnySchema } & { safeParse(value: unknown): unknown };

const FACTORIES = JIT as unknown as Record<string, (...args: unknown[]) => AnySchema>;

export type BuildResult = { ok: true; schema: AnySchema } | { ok: false; error: string; path: string };

export function buildSchema(intent: SchemaIntent): BuildResult {
  try {
    const schema = objectSchema(intent.fields, "fields");

    // Compilation is lazy: a builder accepts every call and emits nothing
    // until something is parsed. Parsing one empty object is what turns a
    // schema the emitter cannot handle into an error here instead of on the
    // first request the reader makes with the generated file.
    schema.safeParse({});

    return { ok: true, schema };
  } catch (error) {
    const failure = error as Error & { path?: string };
    return { ok: false, error: failure.message, path: failure.path ?? "fields" };
  }
}

function fail(path: string, message: string): never {
  const error = new Error(message) as Error & { path: string };
  error.path = path;
  throw error;
}

function objectSchema(fields: readonly SchemaField[], path: string): AnySchema {
  const shape: Record<string, AnySchema> = {};
  for (const field of fields) shape[field.name] = fieldSchema(field, `${path}.${field.name}`);
  return FACTORIES.object(shape);
}

function fieldSchema(field: SchemaField, path: string): AnySchema {
  let schema: AnySchema;

  switch (field.type) {
    case "object":
      schema = objectSchema(field.fields ?? [], path);
      break;
    case "array":
      schema = FACTORIES.array(field.items ? fieldSchema(field.items, `${path}[]`) : FACTORIES.any());
      break;
    case "enum":
      schema = FACTORIES.enum([...(field.values ?? [])]);
      break;
    default: {
      const factory = FACTORIES[field.type];
      if (typeof factory !== "function") fail(path, `JIT.${field.type} is not a factory`);
      schema = factory();
    }
  }

  for (const validator of field.validators ?? []) {
    const method = schema[validator.type];
    if (typeof method !== "function") fail(path, `.${validator.type}() is not available on ${field.type}`);

    const argument =
      validator.value === undefined
        ? []
        : field.type === "date" && typeof validator.value === "string"
          ? [new Date(validator.value)]
          : field.type === "bigint" && typeof validator.value === "number"
            ? [BigInt(Math.trunc(validator.value))]
            : [validator.value];

    schema = method.call(schema, ...argument);
  }

  if (field.nullable) schema = schema.nullable();
  if (field.optional) schema = schema.optional();
  if (field.default) schema = schema.default(defaultValue(field.default));

  return schema;
}

function defaultValue(value: SchemaDefault): unknown {
  switch (value.type) {
    case "crypto.randomUUID":
      return () => crypto.randomUUID();
    case "now":
      return () => new Date();
    default:
      return value.value;
  }
}
