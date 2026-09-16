import { JITError } from "../errors/index.js";
import { getAccessNeeds } from "./binary-layout.js";
import type { BinaryFieldLayout, BinaryRowLayout } from "./binary-rowset.js";
import type { CodeWriter } from "./emitter/code-writer.js";
import { emitLiteral } from "./source/literal.js";

/** @internal Emits the typed-array bindings required by a generated reader. */
export function emitRowViewBindings(writer: CodeWriter, fields: readonly BinaryFieldLayout[], source = "rowset"): void {
  const needs = getAccessNeeds(fields);
  const columnIndexes = new Set<number>();

  if (needs.bytes) writer.line(`const u8 = ${source}.bytes;`);
  if (needs.dataView) writer.line(`const dv = ${source}.view;`);
  if (needs.views.int32) writer.line(`const int32 = ${source}.int32;`);
  if (needs.views.uint32) writer.line(`const uint32 = ${source}.uint32;`);
  if (needs.views.float32) writer.line(`const float32 = ${source}.float32;`);
  if (needs.views.float64) writer.line(`const float64 = ${source}.float64;`);
  if (needs.views.bigint64) writer.line(`const bigint64 = ${source}.bigint64;`);

  for (const field of fields) {
    if (field.columnIndex !== undefined) columnIndexes.add(field.columnIndex);
  }
  if (columnIndexes.size > 0) {
    writer.line(`const offsets = ${source}.offsets;`);
    for (const columnIndex of columnIndexes) writer.line(`const b${columnIndex} = offsets[${columnIndex}];`);
  }
}

/** @internal Emits dictionary bindings for generated binary reads and filters. */
export function emitDictionaryBindings(
  writer: CodeWriter,
  fields: readonly BinaryFieldLayout[],
  includeAdaptiveMode = false
): void {
  for (const field of fields) {
    if (field.dictionaryIndex !== undefined) {
      writer.line(`const d${field.dictionaryIndex} = dictionaries[${field.dictionaryIndex}];`);
      if (includeAdaptiveMode && field.dictionaryMode === "adaptive") {
        writer.line(`const a${field.dictionaryIndex} = d${field.dictionaryIndex}.identity;`);
      }
    }
  }
}

/** @internal Reports whether generated code needs a dictionary binding. */
export function hasDictionary(fields: readonly BinaryFieldLayout[]): boolean {
  return fields.some((field) => field.dictionaryIndex !== undefined);
}

/** @internal Declares the cursors needed for a row-oriented generated loop. */
export function emitRowCursorDeclarations(
  writer: CodeWriter,
  layout: BinaryRowLayout,
  fields: readonly BinaryFieldLayout[]
): void {
  if (layout.memoryLayout === "columnar") return;
  const needs = getAccessNeeds(fields);

  if (needs.bytes || needs.dataView) writer.line("let o = 0;");
  if (needs.words) writer.line("let w = 0;");
  if (needs.doubles) writer.line("let d = 0;");
}

/** @internal Advances row-oriented cursors by one physical row. */
export function emitRowCursorAdvance(
  writer: CodeWriter,
  layout: BinaryRowLayout,
  fields: readonly BinaryFieldLayout[]
): void {
  if (layout.memoryLayout === "columnar") return;
  const needs = getAccessNeeds(fields);

  if (needs.bytes || needs.dataView) writer.line(`o += ${layout.rowSize};`);
  if (needs.words) writer.line(`w += ${layout.rowSize / 4};`);
  if (needs.doubles) writer.line(`d += ${layout.rowSize / 8};`);
}

/** @internal Emits a projection object expression from binary field reads. */
export function emitObjectExpression(fields: readonly BinaryFieldLayout[], selected?: readonly string[]): string {
  const wanted = selected ? new Set(selected) : undefined;
  const entries: string[] = [];

  for (const field of fields) {
    if (wanted && !wanted.has(field.key)) continue;
    entries[entries.length] = `${emitLiteral(field.key)}: ${emitFieldValue(field)}`;
  }
  return `{ ${entries.join(", ")} }`;
}

/** @internal Emits a full row assignment, including discriminated-union dispatch. */
export function emitHydratedObjectAssignment(writer: CodeWriter, layout: BinaryRowLayout, target: string): void {
  const union = layout.union;

  if (!union) {
    writer.line(`${target} = ${emitObjectExpression(layout.fields)};`);
    return;
  }
  const discriminator = layout.fields.find((field) => field.key === union.discriminator);

  if (!discriminator) {
    throw new JITError("INVALID_OPERATION", `binary union discriminator ${union.discriminator} is missing`);
  }
  writer.line(`switch (${emitFieldComparable(discriminator)}) {`);
  writer.indent(() => {
    for (const variant of union.variants) {
      writer.line(`case ${variant.tag}:`);
      writer.indent(() => {
        writer.line(`${target} = ${emitObjectExpression(layout.fields, variant.keys)};`);
        writer.line("break;");
      });
    }
    writer.line("default:");
    writer.indent(() => writer.line('throw new RangeError("jit binary rowset: invalid union tag");'));
  });
  writer.line("}");
}

function emitFieldValue(field: BinaryFieldLayout): string {
  const read = emitScalarRead(field);

  if (!field.guard) return read;

  const state = emitGuardState(field);

  return `(${state} === 1 ? null : ${state} === 2 ? ${read} : undefined)`;
}

function emitScalarRead(field: BinaryFieldLayout): string {
  const offset = emitByteIndex(field);

  switch (field.kind) {
    case "float64":
      return field.access === "dataView" ? `dv.getFloat64(${offset}, true)` : `float64[${emitTypedIndex(field)}]`;
    case "float32":
      return field.access === "dataView" ? `dv.getFloat32(${offset}, true)` : `float32[${emitTypedIndex(field)}]`;
    case "int32":
      return field.access === "dataView" ? `dv.getInt32(${offset}, true)` : `int32[${emitTypedIndex(field)}]`;
    case "boolean":
      return `u8[${offset}] !== 0`;
    case "bigint":
      return field.access === "dataView" ? `dv.getBigInt64(${offset}, true)` : `bigint64[${emitTypedIndex(field)}]`;
    case "date":
      return field.access === "dataView"
        ? `new Date(dv.getFloat64(${offset}, true))`
        : `new Date(float64[${emitTypedIndex(field)}])`;
    case "string":
    case "enum":
    case "literalUnion":
      return `d${field.dictionaryIndex}.values[${
        field.size === 1
          ? `u8[${offset}]`
          : field.access === "dataView"
            ? `dv.getUint32(${offset}, true)`
            : `uint32[${emitTypedIndex(field)}]`
      }]`;
    case "literal":
      return emitLiteral(field.literal as never);
    case "null":
      return "null";
    case "undefined":
      return "undefined";
  }
}

/** @internal Emits the scalar expression used for binary comparisons and aggregates. */
export function emitFieldComparable(field: BinaryFieldLayout): string {
  const offset = emitByteIndex(field);

  switch (field.kind) {
    case "boolean":
      return `u8[${offset}]`;
    case "date":
      return field.access === "dataView" ? `dv.getFloat64(${offset}, true)` : `float64[${emitTypedIndex(field)}]`;
    case "string":
    case "enum":
    case "literalUnion":
      return field.size === 1
        ? `u8[${offset}]`
        : field.access === "dataView"
          ? `dv.getUint32(${offset}, true)`
          : `uint32[${emitTypedIndex(field)}]`;
    default:
      return emitScalarRead(field);
  }
}

/** @internal Emits the typed-array index for a binary field. */
export function emitTypedIndex(field: BinaryFieldLayout): string {
  if (field.columnIndex !== undefined) return `b${field.columnIndex} + i`;
  if (field.size === 8) return `d + ${field.offset / 8}`;
  if (field.size === 4) return `w + ${field.offset / 4}`;
  throw new JITError("INVALID_OPERATION", `binary field ${field.key} does not use a typed index`);
}

/** @internal Emits the byte or column index for a binary field. */
export function emitByteIndex(field: BinaryFieldLayout): string {
  return field.columnIndex === undefined ? `o + ${field.offset}` : `b${field.columnIndex} + i`;
}

/** @internal Emits the byte index for an optional/null field mask. */
export function emitMaskIndex(layout: BinaryRowLayout, maskOffset: number): string {
  if (layout.memoryLayout !== "columnar") return `o + ${maskOffset}`;
  if (layout.maskBytes === 1) return "i";
  return `i * ${layout.maskBytes} + ${maskOffset}`;
}

/** @internal Emits the optional/null field-state expression for the current row. */
export function emitGuardState(field: BinaryFieldLayout): string {
  if (!field.guard) return "2";
  const maskIndex =
    field.guard.maskStride === 0
      ? `o + ${field.guard.maskOffset}`
      : field.guard.maskStride === 1
        ? "i"
        : `i * ${field.guard.maskStride} + ${field.guard.maskOffset}`;

  return `((u8[${maskIndex}] >> ${field.guard.shift}) & 3)`;
}
