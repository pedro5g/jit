import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@jit-compiler/jit/aot";
import { JIT } from "@jit-compiler/jit/runtime";
import {
  LAB_OPERATIONS,
  type LabCompileRequest,
  type LabCompileResult,
  type LabField,
  type LabFieldType,
  type LabOperation,
  type LabStringFormat,
} from "@/lib/lab/types";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const FIELD_TYPES = new Set<LabFieldType>(["string", "number", "integer", "boolean", "stringArray"]);
const STRING_FORMATS = new Set<LabStringFormat>(["none", "email", "uuid", "url"]);
const OPERATIONS = new Set<string>(LAB_OPERATIONS);
const MAX_FIELDS = 64;
type LabSchemaInput = Parameters<typeof JIT.object>[0][string];

interface DynamicStringBuilder {
  readonly schema: LabSchemaInput;
  min(value: number): DynamicStringBuilder;
  max(value: number): DynamicStringBuilder;
  email(): DynamicStringBuilder;
  uuid(): DynamicStringBuilder;
  url(): DynamicStringBuilder;
  optional(): DynamicStringBuilder;
}

interface DynamicNumberBuilder {
  readonly schema: LabSchemaInput;
  min(value: number): DynamicNumberBuilder;
  max(value: number): DynamicNumberBuilder;
  optional(): DynamicNumberBuilder;
}

interface DynamicArrayBuilder {
  readonly schema: LabSchemaInput;
  min(value: number): DynamicArrayBuilder;
  max(value: number): DynamicArrayBuilder;
  optional(): DynamicArrayBuilder;
}

export function compileLabArtifact(input: unknown): LabCompileResult {
  const request = parseRequest(input);
  const shape: Record<string, LabSchemaInput> = {};

  for (const field of request.fields) {
    shape[field.name] = createFieldSchema(field);
  }

  const schema = JIT.object(shape);
  const selected = JIT.model(
    schema,
    Object.fromEntries(request.operations.map((operation) => [operation, true])) as never
  );
  const outDir = mkdtempSync(join(tmpdir(), "jit-lab-"));

  try {
    const result = generate({
      schemas: { [request.name]: selected },
      outDir,
      format: "typescript",
      clean: true,
    });
    const source = readFileSync(join(outDir, "index.ts"), "utf8");

    return {
      files: [{ path: "index.ts", source }],
      schemaSource: emitSchemaSource(request),
      skipped: result.skipped.map(({ operation, reason }) => ({ operation, reason })),
    };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

function createFieldSchema(field: LabField): LabSchemaInput {
  switch (field.type) {
    case "string": {
      let builder = JIT.string() as unknown as DynamicStringBuilder;

      if (field.min !== undefined) builder = builder.min(field.min);
      if (field.max !== undefined) builder = builder.max(field.max);
      if (field.format === "email") builder = builder.email();
      if (field.format === "uuid") builder = builder.uuid();
      if (field.format === "url") builder = builder.url();
      return field.required ? builder.schema : builder.optional().schema;
    }
    case "number": {
      let builder = JIT.number() as unknown as DynamicNumberBuilder;

      if (field.min !== undefined) builder = builder.min(field.min);
      if (field.max !== undefined) builder = builder.max(field.max);
      return field.required ? builder.schema : builder.optional().schema;
    }
    case "integer": {
      let builder = JIT.number().int32() as unknown as DynamicNumberBuilder;

      if (field.min !== undefined) builder = builder.min(field.min);
      if (field.max !== undefined) builder = builder.max(field.max);
      return field.required ? builder.schema : builder.optional().schema;
    }
    case "boolean": {
      const builder = JIT.boolean();
      return (field.required ? builder : builder.optional()) as LabSchemaInput;
    }
    case "stringArray": {
      let builder = JIT.array(JIT.string()) as unknown as DynamicArrayBuilder;

      if (field.min !== undefined) builder = builder.min(field.min);
      if (field.max !== undefined) builder = builder.max(field.max);
      return field.required ? builder.schema : builder.optional().schema;
    }
  }
}

function parseRequest(input: unknown): LabCompileRequest {
  if (input === null || typeof input !== "object") throw new Error("request must be an object");
  const candidate = input as Record<string, unknown>;
  const name = readString(candidate.name, "name");
  const outputRoot = readString(candidate.outputRoot, "outputRoot");

  if (!IDENTIFIER.test(name)) throw new Error("name must be a valid TypeScript identifier");
  validateOutputRoot(outputRoot);
  if (!Array.isArray(candidate.fields) || candidate.fields.length === 0 || candidate.fields.length > MAX_FIELDS) {
    throw new Error(`fields must contain 1-${MAX_FIELDS} entries`);
  }
  if (!Array.isArray(candidate.operations) || candidate.operations.length === 0) {
    throw new Error("select at least one operation");
  }

  const names = new Set<string>();
  const fields = candidate.fields.map((value, index) => {
    if (value === null || typeof value !== "object") throw new Error(`fields[${index}] must be an object`);
    const field = value as Record<string, unknown>;
    const fieldName = readString(field.name, `fields[${index}].name`);
    const type = readString(field.type, `fields[${index}].type`);

    if (!IDENTIFIER.test(fieldName)) throw new Error(`${fieldName} is not a valid field identifier`);
    if (names.has(fieldName)) throw new Error(`duplicate field ${fieldName}`);
    if (!FIELD_TYPES.has(type as LabFieldType)) throw new Error(`unsupported field type ${type}`);
    names.add(fieldName);

    const format = field.format === undefined ? undefined : readString(field.format, `fields[${index}].format`);
    const min = readBound(field.min, `fields[${index}].min`);
    const max = readBound(field.max, `fields[${index}].max`);
    if (format !== undefined && !STRING_FORMATS.has(format as LabStringFormat)) {
      throw new Error(`unsupported string format ${format}`);
    }
    if (type !== "string" && format !== undefined && format !== "none") {
      throw new Error(`format is only supported by string fields`);
    }
    if (type === "boolean" && (min !== undefined || max !== undefined)) {
      throw new Error(`bounds are not supported by boolean fields`);
    }
    if (min !== undefined && max !== undefined && min > max) {
      throw new Error(`fields[${index}].min cannot exceed max`);
    }

    return {
      name: fieldName,
      type: type as LabFieldType,
      required: field.required !== false,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(type === "string" && format !== undefined ? { format: format as LabStringFormat } : {}),
    };
  });
  const operations = candidate.operations.map((value, index) => {
    const operation = readString(value, `operations[${index}]`);
    if (!OPERATIONS.has(operation)) throw new Error(`unsupported operation ${operation}`);
    return operation as LabOperation;
  });

  return { name, outputRoot, fields, operations: [...new Set(operations)] };
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 160) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function readBound(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function validateOutputRoot(path: string): void {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("outputRoot must be a normalized relative path");
  }
}

function emitSchemaSource(request: LabCompileRequest): string {
  const fields = request.fields.map((field) => `  ${field.name}: ${emitFieldSource(field)},`).join("\n");
  const operations = request.operations.map((operation) => `  ${operation}: true,`).join("\n");

  return [
    'import { JIT } from "@jit-compiler/jit/define";',
    "",
    `const ${request.name}Schema = JIT.object({`,
    fields,
    "});",
    "",
    `export const ${request.name} = JIT.model(${request.name}Schema, {`,
    operations,
    "});",
    "",
    `export type ${request.name}Value = JIT.Typeof<typeof ${request.name}Schema>;`,
    "",
  ].join("\n");
}

function emitFieldSource(field: LabField): string {
  let source =
    field.type === "string"
      ? "JIT.string()"
      : field.type === "number"
        ? "JIT.number()"
        : field.type === "integer"
          ? "JIT.number().int32()"
          : field.type === "boolean"
            ? "JIT.boolean()"
            : "JIT.array(JIT.string())";

  if (field.min !== undefined) source += `.min(${field.min})`;
  if (field.max !== undefined) source += `.max(${field.max})`;
  if (field.type === "string" && field.format && field.format !== "none") source += `.${field.format}()`;
  if (!field.required) source += ".optional()";
  return source;
}
