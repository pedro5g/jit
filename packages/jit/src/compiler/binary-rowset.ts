import type { QueryNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { alignmentForSize, alignTo, createBinaryRowLayout, resolveBinaryElement } from "./binary-layout.js";
import {
  emitByteIndex,
  emitDictionaryBindings,
  emitHydratedObjectAssignment,
  emitMaskIndex,
  emitRowCursorAdvance,
  emitRowCursorDeclarations,
  emitRowViewBindings,
  emitTypedIndex,
  hasDictionary,
} from "./binary-query-codegen.js";
import { CodeWriter } from "./emitter/code-writer.js";

export { compileBinaryQuery, emitBinaryQuerySource } from "./binary-query.js";

import { emitPropertyAccess } from "./source/access.js";

type ObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };
type ArraySchema = ATS.AnyTypeSchema & { readonly def: ATS.ElementDef };
type ScalarDictionaryValue = string | number;

/** Describes the JIT binary row set strategy contract used by the public API. */
export type BinaryRowSetStrategy = "dynamic" | "static" | "exact";
/** Describes the JIT binary memory layout contract used by the public API. */
export type BinaryMemoryLayout = "auto" | "packed" | "aligned" | "columnar";

/** Describes the JIT binary row set options contract used by the public API. */
export interface BinaryRowSetOptions {
  /**
   * `dynamic` keeps and grows one scratch buffer, `static` uses a fixed
   * caller-sized pool, and `exact` allocates exactly the bytes needed for the
   * current batch.
   */
  readonly strategy?: BinaryRowSetStrategy;
  /**
   * `auto` keeps compact rows unless already aligned. `columnar` stores each
   * field contiguously for repeated scans and aggregates.
   */
  readonly memoryLayout?: BinaryMemoryLayout;
  /** Initial byte size for dynamic rowsets. Defaults to 8 MiB. */
  readonly initialBytes?: number;
  /** Fixed row capacity for static rowsets. */
  readonly capacity?: number;
  /** Caller-owned memory used by static/dynamic rowsets. */
  readonly buffer?: ArrayBuffer | Uint8Array;
}

/** Describes the JIT binary field kind contract used by the public API. */
export type BinaryFieldKind =
  | "float64"
  | "float32"
  | "int32"
  | "boolean"
  | "bigint"
  | "date"
  | "string"
  | "enum"
  | "literalUnion"
  | "literal"
  | "null"
  | "undefined";

/** Describes the JIT binary field guard contract used by the public API. */
export interface BinaryFieldGuard {
  readonly maskOffset: number;
  readonly shift: number;
  readonly maskStride: number;
}

/** Describes the JIT binary field layout contract used by the public API. */
export interface BinaryFieldLayout {
  readonly key: string;
  readonly kind: BinaryFieldKind;
  readonly offset: number;
  readonly size: number;
  readonly access: "none" | "byte" | "dataView" | "int32" | "uint32" | "float32" | "float64" | "bigint64";
  readonly columnIndex?: number;
  readonly guard?: BinaryFieldGuard;
  readonly dictionaryIndex?: number;
  readonly dictionaryMode?: "dynamic" | "adaptive" | "fixed";
  readonly values?: readonly ScalarDictionaryValue[];
  readonly literal?: unknown;
}

/** Describes the JIT binary row view usage contract used by the public API. */
export interface BinaryRowViewUsage {
  readonly int32: boolean;
  readonly uint32: boolean;
  readonly float32: boolean;
  readonly float64: boolean;
  readonly bigint64: boolean;
}

/** Describes the JIT binary row layout contract used by the public API. */
export interface BinaryRowLayout {
  readonly schema: ObjectSchema;
  readonly rowSize: number;
  readonly maskBytes: number;
  readonly alignment: 1 | 4 | 8;
  readonly paddingBytes: number;
  readonly memoryLayout: Exclude<BinaryMemoryLayout, "auto">;
  readonly views: BinaryRowViewUsage;
  readonly fields: readonly BinaryFieldLayout[];
  readonly columns: readonly BinaryFieldLayout[];
  /** Integer-tagged object variants, or undefined for a monomorphic row. */
  readonly union: BinaryUnionLayout | undefined;
}

/** Describes the JIT binary union variant layout contract used by the public API. */
export interface BinaryUnionVariantLayout {
  readonly tag: number;
  readonly value: string | number;
  readonly keys: readonly string[];
}

/** Describes the JIT binary union layout contract used by the public API. */
export interface BinaryUnionLayout {
  readonly discriminator: string;
  readonly variants: readonly BinaryUnionVariantLayout[];
}

/** Describes the JIT binary dictionary contract used by the public API. */
export interface BinaryDictionary {
  readonly ids: Map<ScalarDictionaryValue, number>;
  readonly values: ScalarDictionaryValue[];
  identity: boolean;
}

/** Describes the JIT binary row set contract used by the public API. */
export interface BinaryRowSet<TElement = unknown> {
  readonly __jitBinaryRowSet: true;
  readonly schema: ObjectSchema;
  readonly layout: BinaryRowLayout;
  buffer: ArrayBufferLike;
  bytes: Uint8Array;
  int32: Int32Array;
  uint32: Uint32Array;
  float32: Float32Array;
  float64: Float64Array;
  bigint64: BigInt64Array;
  /** Element bases for columnar fields; empty for row-oriented layouts. */
  offsets: Uint32Array;
  /** Compatibility view. Compiled rowset hot paths use the typed views above. */
  view: DataView;
  count: number;
  capacity: number;
  readonly strategy: BinaryRowSetStrategy;
  readonly dictionaries: readonly BinaryDictionary[];
  /** Materializes rows from the compact storage. */
  hydrate(): TElement[];
  /** Returns owned buffers to the rowset pool when pooling is enabled. */
  release(): void;
}

/** Describes the JIT binary array contract used by the public API. */
export interface BinaryArray<TElement = unknown> {
  readonly __jitBinaryArray: true;
  readonly schema: ArraySchema;
  readonly layout: BinaryRowLayout;
  readonly strategy: BinaryRowSetStrategy;
  /** Loads values into the compact rowset representation. */
  load(values: readonly TElement[], length?: number): BinaryRowSet<TElement>;
  /** Materializes values from a rowset produced by this loader. */
  hydrate(rowset: BinaryRowSet<TElement>): TElement[];
  /** Clears retained storage owned by this loader. */
  clear(): void;
}

/** Describes the JIT binary array element contract used by the public API. */
export type BinaryArrayElement<TSchema extends ATS.ArraySchema> =
  ATS.TypeofSchema<TSchema> extends (infer TElement)[] ? TElement : never;

interface BinaryArrayState {
  buffer: ArrayBufferLike | undefined;
  bufferOffset: number;
  byteLength: number;
}

interface BinaryCompileHints {
  readonly adaptiveStringFields?: ReadonlySet<string>;
}

interface BinaryRowTarget {
  readonly bytes: Uint8Array;
  readonly int32: Int32Array;
  readonly uint32: Uint32Array;
  readonly float32: Float32Array;
  readonly float64: Float64Array;
  readonly bigint64: BigInt64Array;
  readonly offsets: Uint32Array;
  readonly view: DataView;
  readonly capacity: number;
}

/** Describes the JIT binary query program contract used by the public API. */
export interface BinaryQueryProgram {
  readonly nodes: readonly QueryNode[];
  readonly bindings: readonly unknown[];
  readonly params?: readonly string[];
}

/** Describes the JIT binary query compiled contract used by the public API. */
export type BinaryQueryCompiled<
  TElement,
  TResult,
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
> = keyof TParams extends never
  ? (rowset: BinaryRowSet<TElement>) => TResult
  : (rowset: BinaryRowSet<TElement>, params: TParams) => TResult;

const DEFAULT_DYNAMIC_BYTES = 8 * 1024 * 1024;
const EMPTY_BUFFER = new ArrayBuffer(0);
const EMPTY_BYTES = new Uint8Array(EMPTY_BUFFER);
const EMPTY_INT32 = new Int32Array(EMPTY_BUFFER);
const EMPTY_UINT32 = new Uint32Array(EMPTY_BUFFER);
const EMPTY_FLOAT32 = new Float32Array(EMPTY_BUFFER);
const EMPTY_FLOAT64 = new Float64Array(EMPTY_BUFFER);
const EMPTY_BIGINT64 = new BigInt64Array(EMPTY_BUFFER);
const EMPTY_OFFSETS = new Uint32Array(EMPTY_BUFFER);

/** Returns whether the JIT is binary row set condition holds. */
export function isBinaryRowSet(value: unknown): value is BinaryRowSet<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { readonly __jitBinaryRowSet?: unknown }).__jitBinaryRowSet === true
  );
}

/** Returns whether the JIT is binary array condition holds. */
export function isBinaryArray(value: unknown): value is BinaryArray<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { readonly __jitBinaryArray?: unknown }).__jitBinaryArray === true
  );
}

/** Creates the JIT compile binary array artifact from the supplied input. */
export function compileBinaryArray<TSchema extends ATS.ArraySchema>(
  schema: TSchema,
  options: BinaryRowSetOptions = {},
  hints: BinaryCompileHints = {}
): BinaryArray<BinaryArrayElement<TSchema>> {
  const arraySchema = schema as ArraySchema;
  const element = resolveBinaryElement(arraySchema.def.element, "binary rowset");
  const objectSchema = element.schema;
  const layout = createBinaryRowLayout(objectSchema, options.memoryLayout, hints.adaptiveStringFields, element.union);
  const strategy = options.strategy ?? "dynamic";
  const state = createBinaryArrayState(layout, strategy, options);
  const writer = compileRowWriter(layout);
  const hydrate = compileRowHydrator<BinaryArrayElement<TSchema>>(layout);

  const api: BinaryArray<BinaryArrayElement<TSchema>> = {
    __jitBinaryArray: true,
    schema: arraySchema,
    layout,
    strategy,
    load(values, length) {
      const count = normalizeLength(values.length, length);
      const target = allocateRowBuffer(state, layout, strategy, options, count);
      const dictionaries = createDictionaries(layout);

      resetDictionaries(dictionaries, layout);
      prepareAdaptiveDictionaries(values, count, layout, dictionaries);
      writer(values, count, target, dictionaries);

      return createRowSet<BinaryArrayElement<TSchema>>(
        objectSchema,
        layout,
        strategy,
        dictionaries,
        target,
        count,
        hydrate
      );
    },
    hydrate,
    clear() {
      state.buffer = undefined;
      state.bufferOffset = 0;
      state.byteLength = 0;
    },
  };

  return Object.freeze(api);
}

/** Emits deterministic source for the JIT emit binary row set writer source operation. */
export function emitBinaryRowSetWriterSource(layout: BinaryRowLayout): string {
  const writer = new CodeWriter();

  writer.line("function writeRows(input, len, target, dictionaries) {");
  writer.indent(() => {
    emitRowViewBindings(writer, layout.fields, "target");
    emitDictionaryBindings(writer, layout.fields, true);
    emitRowCursorDeclarations(writer, layout, layout.fields);
    writer.line("for (let i = 0; i < len; i++) {");
    writer.indent(() => {
      writer.line("const item = input[i];");
      for (let mask = 0; mask < layout.maskBytes; mask++) writer.line(`let m${mask} = 0;`);
      emitGuardMasks(writer, layout);
      for (let mask = 0; mask < layout.maskBytes; mask++) {
        writer.line(`u8[${emitMaskIndex(layout, mask)}] = m${mask};`);
      }
      for (const field of layout.fields) emitWriteField(writer, field);
      emitRowCursorAdvance(writer, layout, layout.fields);
    });
    writer.line("}");
  });
  writer.line("}");
  writer.line("return writeRows;");

  return writer.toString();
}

/** Emits deterministic source for the JIT emit binary hydrate source operation. */
export function emitBinaryHydrateSource(layout: BinaryRowLayout): string {
  const writer = new CodeWriter();

  writer.line("function hydrate(rowset) {");
  writer.indent(() => {
    emitRowViewBindings(writer, layout.fields);
    if (hasDictionary(layout.fields)) writer.line("const dictionaries = rowset.dictionaries;");
    emitDictionaryBindings(writer, layout.fields);
    writer.line("const len = rowset.count;");
    writer.line("const out = new Array(len);");
    emitRowCursorDeclarations(writer, layout, layout.fields);
    writer.line("for (let i = 0; i < len; i++) {");
    writer.indent(() => {
      emitHydratedObjectAssignment(writer, layout, "out[i]");
      emitRowCursorAdvance(writer, layout, layout.fields);
    });
    writer.line("}");
    writer.line("return out;");
  });
  writer.line("}");
  writer.line("return hydrate;");

  return writer.toString();
}

function compileRowWriter(
  layout: BinaryRowLayout
): (
  input: readonly unknown[],
  len: number,
  target: BinaryRowTarget,
  dictionaries: readonly BinaryDictionary[]
) => void {
  return globalThis.Function(emitBinaryRowSetWriterSource(layout))() as (
    input: readonly unknown[],
    len: number,
    target: BinaryRowTarget,
    dictionaries: readonly BinaryDictionary[]
  ) => void;
}

function compileRowHydrator<TElement>(layout: BinaryRowLayout): (rowset: BinaryRowSet<TElement>) => TElement[] {
  return globalThis.Function(emitBinaryHydrateSource(layout))() as (rowset: BinaryRowSet<TElement>) => TElement[];
}

/** Returns the exact backing-buffer bytes required for a compiled layout. */
export function getBinaryRowSetByteLength(layout: BinaryRowLayout, count: number): number {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`jit binary rowset: count must be a non-negative integer, got ${count}`);
  }
  if (layout.memoryLayout !== "columnar") return count * layout.rowSize;

  let byteLength = layout.maskBytes * count;

  for (const field of layout.columns) {
    byteLength = alignTo(byteLength, alignmentForSize(field.size));
    byteLength += field.size * count;
  }
  return alignTo(byteLength, layout.alignment);
}

function createColumnOffsets(layout: BinaryRowLayout, count: number): Uint32Array {
  if (layout.memoryLayout !== "columnar") return EMPTY_OFFSETS;

  const offsets = new Uint32Array(layout.columns.length);
  let byteOffset = layout.maskBytes * count;

  for (const field of layout.columns) {
    if (field.columnIndex === undefined) {
      throw new JITError("INVALID_OPERATION", `binary column ${field.key} is missing its physical index`);
    }
    byteOffset = alignTo(byteOffset, alignmentForSize(field.size));
    offsets[field.columnIndex] = byteOffset / field.size;
    byteOffset += field.size * count;
  }
  return offsets;
}

function capacityForByteLength(layout: BinaryRowLayout, available: number): number {
  if (layout.memoryLayout !== "columnar") {
    return layout.rowSize === 0 ? Number.MAX_SAFE_INTEGER : Math.floor(available / layout.rowSize);
  }

  let low = 0;
  let high = Math.floor(available / Math.max(layout.rowSize, 1));

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);

    if (getBinaryRowSetByteLength(layout, middle) <= available) low = middle;
    else high = middle - 1;
  }
  return low;
}

function createBinaryArrayState(
  layout: BinaryRowLayout,
  strategy: BinaryRowSetStrategy,
  options: BinaryRowSetOptions
): BinaryArrayState {
  const source = options.buffer;
  const buffer = source instanceof Uint8Array ? source.buffer : source;
  const bufferOffset = source instanceof Uint8Array ? source.byteOffset : 0;
  const byteLength = source instanceof Uint8Array ? source.byteLength : (buffer?.byteLength ?? 0);

  if (source instanceof Uint8Array && bufferOffset % layout.alignment !== 0) {
    throw new JITError(
      "INVALID_OPERATION",
      `binary caller buffer byteOffset must be aligned to ${layout.alignment} bytes`
    );
  }

  if (strategy === "static" && options.capacity === undefined && source === undefined) {
    throw new JITError("INVALID_OPERATION", "binary static strategy requires a row capacity or caller buffer");
  }

  if (strategy === "static" && options.capacity !== undefined && options.capacity < 0) {
    throw new JITError("INVALID_OPERATION", "binary static capacity must be non-negative");
  }

  return {
    buffer:
      buffer ??
      (strategy === "static" && options.capacity !== undefined
        ? new ArrayBuffer(getBinaryRowSetByteLength(layout, options.capacity))
        : undefined),
    bufferOffset,
    byteLength:
      buffer !== undefined
        ? byteLength
        : strategy === "static" && options.capacity !== undefined
          ? getBinaryRowSetByteLength(layout, options.capacity)
          : 0,
  };
}

function allocateRowBuffer(
  state: BinaryArrayState,
  layout: BinaryRowLayout,
  strategy: BinaryRowSetStrategy,
  options: BinaryRowSetOptions,
  count: number
): BinaryRowTarget {
  const needed = getBinaryRowSetByteLength(layout, count);

  if (strategy === "exact") {
    const buffer = new ArrayBuffer(needed);
    const bytes = new Uint8Array(buffer);

    return createRowTarget(layout, bytes, count, count);
  }

  if (strategy === "static") {
    const available = state.byteLength;

    if (needed > available) {
      throw new RangeError(`jit binary rowset: static capacity exceeded (${needed} bytes > ${available} bytes)`);
    }

    const buffer = state.buffer ?? EMPTY_BUFFER;
    const bytes = new Uint8Array(buffer, state.bufferOffset, needed);

    return createRowTarget(layout, bytes, capacityForByteLength(layout, available), count);
  }

  const minBytes = Math.max(options.initialBytes ?? DEFAULT_DYNAMIC_BYTES, needed);

  if (state.buffer === undefined || state.byteLength < needed) {
    let nextSize = Math.max(state.byteLength, 1);

    while (nextSize < minBytes) nextSize *= 2;
    state.buffer = new ArrayBuffer(nextSize);
    state.bufferOffset = 0;
    state.byteLength = nextSize;
  }

  const bytes = new Uint8Array(state.buffer, state.bufferOffset, needed);

  return createRowTarget(layout, bytes, capacityForByteLength(layout, state.byteLength), count);
}

function createRowTarget(layout: BinaryRowLayout, bytes: Uint8Array, capacity: number, count: number): BinaryRowTarget {
  const elements4 = bytes.byteLength / 4;
  const elements8 = bytes.byteLength / 8;

  return {
    bytes,
    int32: layout.views.int32 ? new Int32Array(bytes.buffer, bytes.byteOffset, elements4) : EMPTY_INT32,
    uint32: layout.views.uint32 ? new Uint32Array(bytes.buffer, bytes.byteOffset, elements4) : EMPTY_UINT32,
    float32: layout.views.float32 ? new Float32Array(bytes.buffer, bytes.byteOffset, elements4) : EMPTY_FLOAT32,
    float64: layout.views.float64 ? new Float64Array(bytes.buffer, bytes.byteOffset, elements8) : EMPTY_FLOAT64,
    bigint64: layout.views.bigint64 ? new BigInt64Array(bytes.buffer, bytes.byteOffset, elements8) : EMPTY_BIGINT64,
    offsets: createColumnOffsets(layout, count),
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    capacity,
  };
}

function createRowSet<TElement>(
  schema: ObjectSchema,
  layout: BinaryRowLayout,
  strategy: BinaryRowSetStrategy,
  dictionaries: readonly BinaryDictionary[],
  target: BinaryRowTarget,
  count: number,
  hydrate: (rowset: BinaryRowSet<TElement>) => TElement[]
): BinaryRowSet<TElement> {
  const rowset: BinaryRowSet<TElement> = {
    __jitBinaryRowSet: true,
    schema,
    layout,
    buffer: target.bytes.buffer,
    bytes: target.bytes,
    int32: target.int32,
    uint32: target.uint32,
    float32: target.float32,
    float64: target.float64,
    bigint64: target.bigint64,
    offsets: target.offsets,
    view: target.view,
    count,
    capacity: target.capacity,
    strategy,
    dictionaries,
    hydrate() {
      return hydrate(rowset);
    },
    release() {
      rowset.buffer = EMPTY_BUFFER;
      rowset.bytes = EMPTY_BYTES;
      rowset.int32 = EMPTY_INT32;
      rowset.uint32 = EMPTY_UINT32;
      rowset.float32 = EMPTY_FLOAT32;
      rowset.float64 = EMPTY_FLOAT64;
      rowset.bigint64 = EMPTY_BIGINT64;
      rowset.offsets = EMPTY_OFFSETS;
      rowset.view = new DataView(EMPTY_BUFFER);
      rowset.count = 0;
      rowset.capacity = 0;
    },
  };

  return rowset;
}

function normalizeLength(actual: number, length: number | undefined): number {
  if (length === undefined) return actual;
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(`jit binary rowset: length must be a non-negative integer, got ${length}`);
  }
  if (length > actual) {
    throw new RangeError(`jit binary rowset: length ${length} exceeds input length ${actual}`);
  }
  return length;
}

function resetDictionaries(dictionaries: readonly BinaryDictionary[], layout: BinaryRowLayout): void {
  for (const dictionary of dictionaries) {
    dictionary.ids.clear();
    dictionary.values.length = 0;
    dictionary.identity = false;
  }

  for (const field of layout.fields) {
    if (field.dictionaryIndex === undefined || field.values === undefined) continue;
    const dictionary = dictionaries[field.dictionaryIndex];

    for (const value of field.values) {
      dictionary.ids.set(value, dictionary.values.length);
      dictionary.values[dictionary.values.length] = value;
    }
  }
}

function createDictionaries(layout: BinaryRowLayout): BinaryDictionary[] {
  return layout.fields.filter((field) => field.dictionaryIndex !== undefined).map(() => createDictionary());
}

function createDictionary(): BinaryDictionary {
  return { ids: new Map(), values: [], identity: false };
}

function prepareAdaptiveDictionaries(
  input: readonly unknown[],
  count: number,
  layout: BinaryRowLayout,
  dictionaries: readonly BinaryDictionary[]
): void {
  const sampleSize = Math.min(count, 1024);

  if (sampleSize === 0) return;

  for (const field of layout.fields) {
    if (field.dictionaryMode !== "adaptive" || field.dictionaryIndex === undefined) continue;
    const values = new Set<ScalarDictionaryValue>();
    let present = 0;

    for (let index = 0; index < sampleSize; index++) {
      const value = (input[index] as Readonly<Record<string, unknown>>)[field.key];

      if (typeof value !== "string" && typeof value !== "number") continue;
      present++;
      values.add(value);
    }
    dictionaries[field.dictionaryIndex].identity = present > 0 && values.size * 2 >= present;
  }
}

function emitGuardMasks(writer: CodeWriter, layout: BinaryRowLayout): void {
  for (const field of layout.fields) {
    if (!field.guard) continue;
    const prop = emitPropertyAccess("item", field.key);
    const mask = `m${field.guard.maskOffset}`;

    writer.line(
      `if (${prop} === null) ${mask} |= ${1 << field.guard.shift}; else if (${prop} !== undefined) ${mask} |= ${2 << field.guard.shift};`
    );
  }
}

function emitWriteField(writer: CodeWriter, field: BinaryFieldLayout): void {
  const prop = emitPropertyAccess("item", field.key);
  const write = () => emitWriteScalar(writer, field, prop);

  if (!field.guard) {
    write();
    return;
  }

  writer.line(`if (${prop} != null) {`);
  writer.indent(write);
  writer.line("}");
}

function emitWriteScalar(writer: CodeWriter, field: BinaryFieldLayout, valueExpr: string): void {
  const offset = emitByteIndex(field);

  switch (field.kind) {
    case "float64":
      writer.line(
        field.access === "dataView"
          ? `dv.setFloat64(${offset}, ${valueExpr}, true);`
          : `float64[${emitTypedIndex(field)}] = ${valueExpr};`
      );
      return;
    case "float32":
      writer.line(
        field.access === "dataView"
          ? `dv.setFloat32(${offset}, ${valueExpr}, true);`
          : `float32[${emitTypedIndex(field)}] = ${valueExpr};`
      );
      return;
    case "int32":
      writer.line(
        field.access === "dataView"
          ? `dv.setInt32(${offset}, ${valueExpr}, true);`
          : `int32[${emitTypedIndex(field)}] = ${valueExpr};`
      );
      return;
    case "boolean":
      writer.line(`u8[${offset}] = ${valueExpr} ? 1 : 0;`);
      return;
    case "bigint":
      writer.line(
        field.access === "dataView"
          ? `dv.setBigInt64(${offset}, ${valueExpr}, true);`
          : `bigint64[${emitTypedIndex(field)}] = ${valueExpr};`
      );
      return;
    case "date":
      writer.line(
        field.access === "dataView"
          ? `dv.setFloat64(${offset}, ${valueExpr}.getTime(), true);`
          : `float64[${emitTypedIndex(field)}] = ${valueExpr}.getTime();`
      );
      return;
    case "string":
    case "enum":
    case "literalUnion":
      emitDictionaryWrite(writer, field, valueExpr, offset);
      return;
    case "literal":
    case "null":
    case "undefined":
      return;
  }
}

function emitDictionaryWrite(writer: CodeWriter, field: BinaryFieldLayout, valueExpr: string, offset: string): void {
  const dictionary = `d${field.dictionaryIndex}`;
  const code = `c${field.dictionaryIndex}_${field.offset}`;
  const emitIndexedWrite = (declaration: "let" | "assign") => {
    writer.line(`${declaration === "let" ? "let " : ""}${code} = ${dictionary}.ids.get(${valueExpr});`);
    writer.line(`if (${code} === undefined) {`);
    writer.indent(() => {
      if (field.dictionaryMode === "fixed") {
        writer.line(
          `throw new RangeError("jit binary rowset: value not in fixed dictionary for ${field.key}: " + ${valueExpr});`
        );
      } else {
        writer.line(`${code} = ${dictionary}.values.length;`);
        writer.line(`${dictionary}.ids.set(${valueExpr}, ${code});`);
        writer.line(`${dictionary}.values[${code}] = ${valueExpr};`);
      }
    });
    writer.line("}");
  };

  if (field.dictionaryMode === "adaptive") {
    writer.line(`let ${code};`);
    writer.line(`if (a${field.dictionaryIndex}) {`);
    writer.indent(() => {
      writer.line(`${code} = ${dictionary}.values.length;`);
      writer.line(`${dictionary}.values[${code}] = ${valueExpr};`);
    });
    writer.line("} else {");
    writer.indent(() => emitIndexedWrite("assign"));
    writer.line("}");
  } else {
    emitIndexedWrite("let");
  }
  if (field.size === 1) writer.line(`u8[${offset}] = ${code};`);
  else if (field.access === "dataView") writer.line(`dv.setUint32(${offset}, ${code}, true);`);
  else writer.line(`uint32[${emitTypedIndex(field)}] = ${code};`);
}
