import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { JITValidationError } from "../errors/validation-error.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./source/access.js";
import { compileValidator } from "./validate.js";

export type CsvChunk = string | Uint8Array;
export type CsvInput = CsvChunk | Iterable<CsvChunk>;
export type CsvParseSink = "result" | "iterator" | "visitor";
export type CsvStringifySink = "string" | "iterator";

export interface CsvOptions {
  readonly delimiter?: string;
  readonly header?: boolean;
  readonly columns?: Readonly<Record<string, string>>;
}

export interface CsvFieldDescriptor {
  readonly key: string;
  readonly column: string;
  readonly kind: "string" | "number" | "boolean" | "bigint" | "date" | "null";
  readonly optional: boolean;
  readonly nullable: boolean;
}

export interface CsvDescriptor {
  readonly schema: ATS.AnyTypeSchema;
  readonly fields: readonly CsvFieldDescriptor[];
  readonly delimiter: string;
  readonly header: boolean;
  readonly operation: "parse" | "stringify";
  readonly sink: CsvParseSink | CsvStringifySink;
}

type ObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };

export function resolveCsvDescriptor(
  schema: ATS.AnyTypeSchema,
  operation: CsvDescriptor["operation"],
  sink: CsvDescriptor["sink"],
  options: CsvOptions = {}
): CsvDescriptor {
  const base = resolveWrappers(schema).base;

  if (base.type !== TypeName.object) {
    throw new JITError("UNSUPPORTED_SCHEMA", "JIT.csv requires an object row schema");
  }

  const delimiter = options.delimiter ?? ",";

  if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\r" || delimiter === "\n") {
    throw new JITError("INVALID_OPERATION", "CSV delimiter must be one character other than quote or newline");
  }

  const object = base as ObjectSchema;
  const columns = options.columns ?? {};

  for (const key of Object.keys(columns)) {
    if (!(key in object.def.props)) {
      throw new JITError("INVALID_OPERATION", `CSV columns references unknown field ${JSON.stringify(key)}`);
    }
  }

  const fields = Object.keys(object.def.props).map((key) =>
    resolveCsvField(key, columns[key] ?? key, object.def.props[key])
  );

  return Object.freeze({
    schema,
    fields: Object.freeze(fields),
    delimiter,
    header: options.header ?? true,
    operation,
    sink,
  });
}

function resolveCsvField(key: string, column: string, schema: ATS.AnyTypeSchema): CsvFieldDescriptor {
  const resolved = resolveWrappers(schema);
  const base = resolved.base;
  let kind: CsvFieldDescriptor["kind"];

  switch (base.type) {
    case TypeName.string:
      kind = "string";
      break;
    case TypeName.number:
    case TypeName.int:
    case TypeName.nan:
      kind = "number";
      break;
    case TypeName.boolean:
      kind = "boolean";
      break;
    case TypeName.bigint:
      kind = "bigint";
      break;
    case TypeName.date:
      kind = "date";
      break;
    case TypeName.null:
      kind = "null";
      break;
    case TypeName.literal: {
      const value = (base.def as { readonly value: unknown }).value;
      kind = typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
      break;
    }
    case TypeName.enum: {
      const values = Object.values((base.def as ATS.EnumDef).values);
      kind = values.length > 0 && values.every((value) => typeof value === "number") ? "number" : "string";
      break;
    }
    default:
      throw new JITError(
        "UNSUPPORTED_SCHEMA",
        `CSV field ${JSON.stringify(key)} has unsupported ${String(base.type)} values; encode nested values explicitly before CSV`
      );
  }

  return Object.freeze({
    key,
    column,
    kind,
    optional: resolved.optional || hasDefault(schema),
    nullable: resolved.nullable,
  });
}

function hasDefault(schema: ATS.AnyTypeSchema): boolean {
  let current = schema;

  while (true) {
    if (current.type === TypeName.default) return true;
    if (
      current.type === TypeName.optional ||
      current.type === TypeName.nullable ||
      current.type === TypeName.nullish ||
      current.type === TypeName.readonly ||
      current.type === TypeName.brand ||
      current.type === TypeName.transform ||
      current.type === TypeName.pipe ||
      current.type === TypeName.refine ||
      current.type === TypeName.coerce ||
      current.type === TypeName.runtimeType
    ) {
      current = (current.def as ATS.InnerTypeDef<ATS.AnyTypeSchema>).innerType;
      continue;
    }
    return false;
  }
}

export function emitCsvSource(descriptor: CsvDescriptor, validator = "__csvValidator"): string {
  const source =
    descriptor.operation === "parse" ? emitCsvParseSource(descriptor, validator) : emitCsvStringifySource(descriptor);
  const main = descriptor.operation === "parse" ? "csvParse" : "csvStringify";

  return `(() => {\n${source
    .trimEnd()
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")}\n  return ${main};\n})()`;
}

function emitCsvParseSource(descriptor: CsvDescriptor, validator: string): string {
  const writer = new CodeWriter();
  const generator = descriptor.sink === "iterator" ? "function*" : "function";
  const parameters = descriptor.sink === "visitor" ? "input, consume" : "input";

  if (descriptor.header) emitHeaderResolver(writer, descriptor);
  emitCsvRowParser(writer, descriptor, validator);
  writer.line(`${generator} csvParse(${parameters}) {`);
  writer.indent(() => {
    if (descriptor.sink === "result") writer.line("const out = [];");
    writer.line(
      'const single = typeof input === "string" || input instanceof Uint8Array; const iterator = single ? undefined : input[Symbol.iterator]();'
    );
    writer.line("const decoder = new TextDecoder();");
    writer.line(
      'let field = "", record = [], quoted = false, afterQuote = false, skipLf = false, dirty = false, singleDone = false;'
    );
    emitPositionDeclarations(writer, descriptor);
    writer.line("let row = 0;");
    writer.line("while (true) {");
    writer.indent(() => {
      writer.line("let chunk, done;");
      writer.line(
        "if (single) { done = singleDone; chunk = singleDone ? undefined : input; singleDone = true; } else { const next = iterator.next(); done = next.done; chunk = next.value; }"
      );
      writer.line(
        'const text = done ? decoder.decode() : (typeof chunk === "string" ? decoder.decode() + chunk : decoder.decode(chunk, { stream: true }));'
      );
      writer.line("for (let i = 0; i < text.length; i++) {");
      writer.indent(() => emitCsvCharacter(writer, descriptor));
      writer.line("}");
      writer.line("if (!done) continue;");
      writer.line('if (quoted) throw new SyntaxError("unterminated quoted CSV field");');
      writer.line("if (dirty || field.length !== 0 || record.length !== 0) {");
      writer.indent(() => {
        writer.line("record[record.length] = field;");
        emitCsvRecord(writer, descriptor);
      });
      writer.line("}");
      if (descriptor.header) writer.line('if (headerPending) throw new SyntaxError("CSV header is missing");');
      if (descriptor.sink === "result") writer.line("return out;");
      else if (descriptor.sink === "visitor") writer.line("return row;");
      else writer.line("return;");
    });
    writer.line("}");
  });
  writer.line("}");
  return writer.toString();
}

function emitHeaderResolver(writer: CodeWriter, descriptor: CsvDescriptor): void {
  writer.line("function csvHeader(header) {");
  writer.indent(() => {
    descriptor.fields.forEach((_, index) => {
      writer.line(`let p${index} = -1;`);
    });
    writer.line("for (let h = 0; h < header.length; h++) {");
    writer.indent(() => {
      writer.line("switch (header[h]) {");
      writer.indent(() => {
        descriptor.fields.forEach((field, index) => {
          writer.line(`case ${JSON.stringify(field.column)}:`);
          writer.indent(() => {
            writer.line(
              `if (p${index} !== -1) throw new SyntaxError(${JSON.stringify(`duplicate CSV column ${field.column}`)});`
            );
            writer.line(`p${index} = h; break;`);
          });
        });
      });
      writer.line("}");
    });
    writer.line("}");
    descriptor.fields.forEach((field, index) => {
      writer.line(
        `if (p${index} === -1) throw new SyntaxError(${JSON.stringify(`missing CSV column ${field.column}`)});`
      );
    });
    writer.line(`return [${descriptor.fields.map((_, index) => `p${index}`).join(", ")}];`);
  });
  writer.line("}");
}

function emitPositionDeclarations(writer: CodeWriter, descriptor: CsvDescriptor): void {
  descriptor.fields.forEach((_, index) => {
    writer.line(`${descriptor.header ? "let" : "const"} p${index} = ${descriptor.header ? -1 : index};`);
  });
  if (descriptor.header) writer.line("let headerPending = true;");
}

function emitCsvCharacter(writer: CodeWriter, descriptor: CsvDescriptor): void {
  writer.line("const ch = text[i];");
  writer.line('if (skipLf) { skipLf = false; if (ch === "\\n") continue; }');
  writer.line("if (quoted) {");
  writer.indent(() => {
    writer.line("if (ch === '\"') { quoted = false; afterQuote = true; } else { field += ch; dirty = true; }");
    writer.line("continue;");
  });
  writer.line("}");
  writer.line("if (afterQuote) {");
  writer.indent(() => {
    writer.line("if (ch === '\"') { field += '\"'; quoted = true; afterQuote = false; dirty = true; continue; }");
    writer.line(
      `if (ch === ${JSON.stringify(descriptor.delimiter)}) { record[record.length] = field; field = ""; afterQuote = false; dirty = true; continue; }`
    );
    writer.line('if (ch === "\\r" || ch === "\\n") {');
    writer.indent(() => {
      writer.line("record[record.length] = field;");
      emitCsvRecord(writer, descriptor);
      writer.line('record = []; field = ""; afterQuote = false; dirty = false; skipLf = ch === "\\r"; continue;');
    });
    writer.line("}");
    writer.line('throw new SyntaxError("unexpected character after closing CSV quote");');
  });
  writer.line("}");
  writer.line(
    `if (ch === ${JSON.stringify(descriptor.delimiter)}) { record[record.length] = field; field = ""; dirty = true; continue; }`
  );
  writer.line(
    'if (ch === \'"\') { if (field.length !== 0) throw new SyntaxError("quote inside unquoted CSV field"); quoted = true; dirty = true; continue; }'
  );
  writer.line('if (ch === "\\r" || ch === "\\n") {');
  writer.indent(() => {
    writer.line("record[record.length] = field;");
    emitCsvRecord(writer, descriptor);
    writer.line('record = []; field = ""; dirty = false; skipLf = ch === "\\r"; continue;');
  });
  writer.line("}");
  writer.line("field += ch; dirty = true;");
}

function emitCsvRecord(writer: CodeWriter, descriptor: CsvDescriptor): void {
  if (descriptor.header) {
    writer.line("if (headerPending) {");
    writer.indent(() => {
      writer.line("const positions = csvHeader(record);");
      descriptor.fields.forEach((_, index) => {
        writer.line(`p${index} = positions[${index}];`);
      });
      writer.line("headerPending = false;");
    });
    writer.line("} else {");
    writer.indent(() => emitCsvDataRecord(writer, descriptor));
    writer.line("}");
    return;
  }
  emitCsvDataRecord(writer, descriptor);
}

function emitCsvDataRecord(writer: CodeWriter, descriptor: CsvDescriptor): void {
  const args = descriptor.fields.map((_, index) => `p${index}`).join(", ");
  writer.line(`const value = csvRow(record, row${args ? `, ${args}` : ""});`);
  if (descriptor.sink === "result") writer.line("out[row] = value;");
  else if (descriptor.sink === "iterator") writer.line("yield value;");
  else writer.line("consume(value, row);");
  writer.line("row += 1;");
}

function emitCsvRowParser(writer: CodeWriter, descriptor: CsvDescriptor, validator: string): void {
  const positions = descriptor.fields.map((_, index) => `p${index}`).join(", ");

  writer.line(`function csvRow(record, row${positions ? `, ${positions}` : ""}) {`);
  writer.indent(() => {
    descriptor.fields.forEach((_, index) => {
      writer.line(`const c${index} = record[p${index}];`);
    });
    writer.line("const result = " + validator + ".safeParse({");
    writer.indent(() => {
      descriptor.fields.forEach((field, index) => {
        writer.line(`${JSON.stringify(field.key)}: ${csvParseExpression(field, `c${index}`)},`);
      });
    });
    writer.line("});");
    writer.line("if (result.success) return result.data;");
    writer.line(
      "throw new JITValidationError(result.issues.map((issue) => ({ ...issue, path: [row, ...issue.path] })));"
    );
  });
  writer.line("}");
}

function csvParseExpression(field: CsvFieldDescriptor, cell: string): string {
  const missing = field.nullable ? "null" : field.optional ? "undefined" : undefined;
  let value: string;

  switch (field.kind) {
    case "string":
      value = cell;
      break;
    case "number":
      value = `Number(${cell})`;
      break;
    case "boolean":
      value = `${cell} === "true" ? true : ${cell} === "false" ? false : ${cell}`;
      break;
    case "bigint":
      value = `BigInt(${cell})`;
      break;
    case "date":
      value = `new Date(${cell})`;
      break;
    case "null":
      value = "null";
      break;
  }
  if (missing !== undefined) return `${cell} === "" || ${cell} === undefined ? ${missing} : ${value}`;
  if (field.kind === "number") return `${cell} === "" || ${cell} === undefined ? NaN : ${value}`;
  return value;
}

function emitCsvStringifySource(descriptor: CsvDescriptor): string {
  const writer = new CodeWriter();

  writer.line("function csvEscape(value) {");
  writer.indent(() => {
    writer.line(
      `return value.indexOf('"') === -1 && value.indexOf(${JSON.stringify(descriptor.delimiter)}) === -1 && value.indexOf("\\r") === -1 && value.indexOf("\\n") === -1 ? value : '"' + value.replace(/"/g, '""') + '"';`
    );
  });
  writer.line("}");
  const iterator = descriptor.sink === "iterator";
  writer.line(`${iterator ? "function*" : "function"} csvStringify(value) {`);
  writer.indent(() => {
    const header = descriptor.fields
      .map((field) => csvStaticEscape(field.column, descriptor.delimiter))
      .join(descriptor.delimiter);
    if (iterator) {
      if (descriptor.header) writer.line(`yield ${JSON.stringify(header + "\r\n")};`);
      writer.line("for (let i = 0; i < value.length; i++) {");
      writer.indent(() => writer.line(`yield ${csvRowStringExpression(descriptor, "value[i]")} + "\\r\\n";`));
      writer.line("}");
    } else {
      writer.line(`let out = ${JSON.stringify(descriptor.header ? header : "")};`);
      writer.line("for (let i = 0; i < value.length; i++) {");
      writer.indent(() => {
        writer.line(`if (out.length !== 0) out += "\\r\\n";`);
        writer.line(`out += ${csvRowStringExpression(descriptor, "value[i]")};`);
      });
      writer.line("}");
      writer.line("return out;");
    }
  });
  writer.line("}");
  return writer.toString();
}

function csvRowStringExpression(descriptor: CsvDescriptor, value: string): string {
  return descriptor.fields
    .map((field) => {
      const access = emitPropertyAccess(value, field.key);
      const encoded = field.kind === "date" ? `${access}.toISOString()` : `String(${access})`;
      const scalar = field.optional || field.nullable ? `${access} == null ? "" : ${encoded}` : encoded;
      return `csvEscape(${scalar})`;
    })
    .join(` + ${JSON.stringify(descriptor.delimiter)} + `);
}

function csvStaticEscape(value: string, delimiter: string): string {
  return value.includes('"') || value.includes(delimiter) || value.includes("\r") || value.includes("\n")
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

export function compileCsvParse<TRow>(
  descriptor: CsvDescriptor
): (input: CsvInput, consume?: (row: TRow, index: number) => void) => unknown {
  const validator = compileValidator(descriptor.schema);
  const source = emitCsvSource(descriptor);
  const compiled = globalThis.Function(
    "__csvValidator",
    "JITValidationError",
    `return ${source};`
  )(validator, JITValidationError) as (input: CsvInput, consume?: (row: TRow, index: number) => void) => unknown;

  registerArtifact(compiled as object, { kind: "csv-plan", descriptor });
  return compiled;
}

export function compileCsvStringify<TRow>(descriptor: CsvDescriptor): (value: readonly TRow[]) => unknown {
  const source = emitCsvSource(descriptor);
  const compiled = globalThis.Function(`return ${source};`)() as (value: readonly TRow[]) => unknown;

  registerArtifact(compiled as object, { kind: "csv-plan", descriptor });
  return compiled;
}
