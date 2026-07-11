import type {
  QueryAggregateNode,
  QueryConditionNode,
  QueryFilterNode,
  QueryNode,
  QuerySelectFieldsNode,
  QueryValueNode,
} from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";
import { type CompileCacheOptions, getCompileCached } from "../runtime/cache/compile-cache.js";
import { CodeWriter } from "./emitter/code-writer.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { emitPropertyAccess } from "./source/access.js";
import { emitLiteral } from "./source/literal.js";

type ObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };
type ArraySchema = ATS.AnyTypeSchema & { readonly def: ATS.ElementDef };
type ScalarDictionaryValue = string | number;

export type BinaryRowSetStrategy = "dynamic" | "static" | "exact";

export interface BinaryRowSetOptions {
  /**
   * `dynamic` keeps and grows one scratch buffer, `static` uses a fixed
   * caller-sized pool, and `exact` allocates exactly the bytes needed for the
   * current batch.
   */
  readonly strategy?: BinaryRowSetStrategy;
  /** Initial byte size for dynamic rowsets. Defaults to 8 MiB. */
  readonly initialBytes?: number;
  /** Fixed row capacity for static rowsets. */
  readonly capacity?: number;
  /** Caller-owned memory used by static/dynamic rowsets. */
  readonly buffer?: ArrayBuffer | Uint8Array;
}

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

export interface BinaryFieldGuard {
  readonly maskOffset: number;
  readonly shift: number;
}

export interface BinaryFieldLayout {
  readonly key: string;
  readonly kind: BinaryFieldKind;
  readonly offset: number;
  readonly size: number;
  readonly guard?: BinaryFieldGuard;
  readonly dictionaryIndex?: number;
  readonly dictionaryMode?: "dynamic" | "fixed";
  readonly values?: readonly ScalarDictionaryValue[];
  readonly literal?: unknown;
}

export interface BinaryRowLayout {
  readonly schema: ObjectSchema;
  readonly rowSize: number;
  readonly maskBytes: number;
  readonly fields: readonly BinaryFieldLayout[];
}

export interface BinaryDictionary {
  readonly ids: Map<ScalarDictionaryValue, number>;
  readonly values: ScalarDictionaryValue[];
}

export interface BinaryRowSet<TElement = unknown> {
  readonly __jitBinaryRowSet: true;
  readonly schema: ObjectSchema;
  readonly layout: BinaryRowLayout;
  buffer: ArrayBufferLike;
  bytes: Uint8Array;
  view: DataView;
  count: number;
  capacity: number;
  readonly strategy: BinaryRowSetStrategy;
  readonly dictionaries: readonly BinaryDictionary[];
  hydrate(): TElement[];
  release(): void;
}

export interface BinaryArray<TElement = unknown> {
  readonly __jitBinaryArray: true;
  readonly schema: ArraySchema;
  readonly layout: BinaryRowLayout;
  readonly strategy: BinaryRowSetStrategy;
  load(values: readonly TElement[], length?: number): BinaryRowSet<TElement>;
  hydrate(rowset: BinaryRowSet<TElement>): TElement[];
  clear(): void;
}

export type BinaryArrayElement<TSchema extends ATS.ArraySchema> =
  ATS.InferSchema<TSchema> extends (infer TElement)[] ? TElement : never;

interface BinaryArrayState {
  buffer: ArrayBufferLike | undefined;
  bufferOffset: number;
  byteLength: number;
}

export interface BinaryQueryProgram {
  readonly nodes: readonly QueryNode[];
  readonly bindings: readonly unknown[];
  readonly params?: readonly string[];
}

export type BinaryQueryCompiled<
  TElement,
  TResult,
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
> = keyof TParams extends never
  ? (rowset: BinaryRowSet<TElement>) => TResult
  : (rowset: BinaryRowSet<TElement>, params: TParams) => TResult;

interface BinaryQueryPlan {
  readonly filters: readonly QueryFilterNode[];
  readonly select: QuerySelectFieldsNode | undefined;
  readonly aggregate: QueryAggregateNode | undefined;
}

interface FieldLookup {
  readonly fields: ReadonlyMap<string, BinaryFieldLayout>;
}

const DEFAULT_DYNAMIC_BYTES = 8 * 1024 * 1024;
const EMPTY_BUFFER = new ArrayBuffer(0);
const EMPTY_BYTES = new Uint8Array(EMPTY_BUFFER);

export function isBinaryRowSet(value: unknown): value is BinaryRowSet<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { readonly __jitBinaryRowSet?: unknown }).__jitBinaryRowSet === true
  );
}

export function isBinaryArray(value: unknown): value is BinaryArray<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { readonly __jitBinaryArray?: unknown }).__jitBinaryArray === true
  );
}

export function compileBinaryArray<TSchema extends ATS.ArraySchema>(
  schema: TSchema,
  options: BinaryRowSetOptions = {}
): BinaryArray<BinaryArrayElement<TSchema>> {
  const arraySchema = schema as ArraySchema;
  const objectSchema = expectArrayObjectSchema(arraySchema, "binary rowset");
  const layout = createBinaryRowLayout(objectSchema);
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
      writer(values, count, target.bytes, target.view, dictionaries);

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

export function emitBinaryRowSetWriterSource(layout: BinaryRowLayout): string {
  const writer = new CodeWriter();

  writer.line("function writeRows(input, len, u8, dv, dictionaries) {");
  writer.indent(() => {
    for (const field of layout.fields) {
      if (field.dictionaryIndex !== undefined) {
        writer.line(`const d${field.dictionaryIndex} = dictionaries[${field.dictionaryIndex}];`);
      }
    }
    writer.line("let o = 0;");
    writer.line("for (let i = 0; i < len; i++) {");
    writer.indent(() => {
      writer.line("const item = input[i];");
      for (let mask = 0; mask < layout.maskBytes; mask++) writer.line(`let m${mask} = 0;`);
      emitGuardMasks(writer, layout);
      for (let mask = 0; mask < layout.maskBytes; mask++) writer.line(`u8[o + ${mask}] = m${mask};`);
      for (const field of layout.fields) emitWriteField(writer, field);
      writer.line(`o += ${layout.rowSize};`);
    });
    writer.line("}");
  });
  writer.line("}");
  writer.line("return writeRows;");

  return writer.toString();
}

export function emitBinaryHydrateSource(layout: BinaryRowLayout): string {
  const writer = new CodeWriter();

  writer.line("function hydrate(rowset) {");
  writer.indent(() => {
    writer.line("const u8 = rowset.bytes;");
    writer.line("const dv = rowset.view;");
    writer.line("const dictionaries = rowset.dictionaries;");
    for (const field of layout.fields) {
      if (field.dictionaryIndex !== undefined) {
        writer.line(`const d${field.dictionaryIndex} = dictionaries[${field.dictionaryIndex}];`);
      }
    }
    writer.line("const len = rowset.count;");
    writer.line("const out = new Array(len);");
    writer.line("let o = 0;");
    writer.line("for (let i = 0; i < len; i++) {");
    writer.indent(() => {
      writer.line(`out[i] = ${emitObjectExpression(layout.fields)};`);
      writer.line(`o += ${layout.rowSize};`);
    });
    writer.line("}");
    writer.line("return out;");
  });
  writer.line("}");
  writer.line("return hydrate;");

  return writer.toString();
}

export function emitBinaryQuerySource(layout: BinaryRowLayout, program: BinaryQueryProgram): string {
  const plan = createBinaryQueryPlan(program.nodes);
  const lookup = createFieldLookup(layout);

  validateBinaryQueryPlan(lookup, plan);

  const writer = new CodeWriter();
  const hasParams = Boolean(program.params?.length);

  writer.line(`function query(rowset${hasParams ? ", params" : ""}) {`);
  writer.indent(() => {
    writer.line("const u8 = rowset.bytes;");
    writer.line("const dv = rowset.view;");
    writer.line("const dictionaries = rowset.dictionaries;");
    writer.line("const len = rowset.count;");
    for (const field of layout.fields) {
      if (field.dictionaryIndex !== undefined) {
        writer.line(`const d${field.dictionaryIndex} = dictionaries[${field.dictionaryIndex}];`);
      }
    }

    const prepared = new PreparedValues(writer);
    const condition = emitBinaryFilter(plan, lookup, prepared);

    if (plan.aggregate) {
      emitBinaryAggregateQuery(writer, layout, lookup, plan, condition);
    } else {
      emitBinaryArrayQuery(writer, layout, plan, condition);
    }
  });
  writer.line("}");

  return writer.toString();
}

export function compileBinaryQuery<
  TElement,
  TResult = TElement[],
  TParams extends Readonly<Record<string, unknown>> = Readonly<Record<never, never>>,
>(
  target: BinaryArray<TElement> | BinaryRowSet<TElement>,
  program: BinaryQueryProgram,
  options?: CompileCacheOptions
): BinaryQueryCompiled<TElement, TResult, TParams> {
  const layout = target.layout;
  const schema = target.schema;
  const bindingNames = program.bindings.map((_, index) => `__q${index}`);
  const cacheKey = `binary-query:${serializeQueryNodes(program.nodes)}`;
  const template = getCompileCached(
    schema,
    cacheKey,
    () => {
      const source = emitBinaryQuerySource(layout, program);

      return {
        source,
        create: globalThis.Function(...bindingNames, `return ${source};`),
      };
    },
    options
  );
  const compiled = template.create(...program.bindings) as BinaryQueryCompiled<TElement, TResult, TParams>;

  registerArtifact(compiled as object, {
    kind: "query",
    source: template.source,
    bindingNames,
    bindingValues: program.bindings,
  });
  return compiled;
}

function compileRowWriter(
  layout: BinaryRowLayout
): (
  input: readonly unknown[],
  len: number,
  u8: Uint8Array,
  dv: DataView,
  dictionaries: readonly BinaryDictionary[]
) => void {
  return globalThis.Function(emitBinaryRowSetWriterSource(layout))() as (
    input: readonly unknown[],
    len: number,
    u8: Uint8Array,
    dv: DataView,
    dictionaries: readonly BinaryDictionary[]
  ) => void;
}

function compileRowHydrator<TElement>(layout: BinaryRowLayout): (rowset: BinaryRowSet<TElement>) => TElement[] {
  return globalThis.Function(emitBinaryHydrateSource(layout))() as (rowset: BinaryRowSet<TElement>) => TElement[];
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
        ? new ArrayBuffer(options.capacity * layout.rowSize)
        : undefined),
    bufferOffset,
    byteLength:
      buffer !== undefined
        ? byteLength
        : strategy === "static" && options.capacity !== undefined
          ? options.capacity * layout.rowSize
          : 0,
  };
}

function allocateRowBuffer(
  state: BinaryArrayState,
  layout: BinaryRowLayout,
  strategy: BinaryRowSetStrategy,
  options: BinaryRowSetOptions,
  count: number
): { readonly bytes: Uint8Array; readonly view: DataView; readonly capacity: number } {
  const needed = count * layout.rowSize;

  if (strategy === "exact") {
    const buffer = new ArrayBuffer(needed);
    const bytes = new Uint8Array(buffer);

    return { bytes, view: new DataView(buffer), capacity: count };
  }

  if (strategy === "static") {
    const available = state.byteLength;

    if (needed > available) {
      throw new RangeError(`jit binary rowset: static capacity exceeded (${needed} bytes > ${available} bytes)`);
    }

    const buffer = state.buffer ?? EMPTY_BUFFER;
    const bytes = new Uint8Array(buffer, state.bufferOffset, needed);

    return {
      bytes,
      view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      capacity: Math.floor(available / layout.rowSize),
    };
  }

  const minBytes = Math.max(options.initialBytes ?? DEFAULT_DYNAMIC_BYTES, needed);

  if (state.buffer === undefined || state.byteLength < needed) {
    let nextSize = Math.max(state.byteLength, 1);

    while (nextSize < minBytes) nextSize *= 2;
    state.buffer = new ArrayBuffer(nextSize);
    state.bufferOffset = 0;
    state.byteLength = nextSize;
  }

  const bytes = new Uint8Array(state.buffer, 0, needed);

  return {
    bytes,
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    capacity: Math.floor(state.byteLength / layout.rowSize),
  };
}

function createRowSet<TElement>(
  schema: ObjectSchema,
  layout: BinaryRowLayout,
  strategy: BinaryRowSetStrategy,
  dictionaries: readonly BinaryDictionary[],
  target: { readonly bytes: Uint8Array; readonly view: DataView; readonly capacity: number },
  count: number,
  hydrate: (rowset: BinaryRowSet<TElement>) => TElement[]
): BinaryRowSet<TElement> {
  const rowset: BinaryRowSet<TElement> = {
    __jitBinaryRowSet: true,
    schema,
    layout,
    buffer: target.bytes.buffer,
    bytes: target.bytes,
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
  return { ids: new Map(), values: [] };
}

function expectArrayObjectSchema(schema: ArraySchema, feature: string): ObjectSchema {
  const resolved = resolveWrappers(schema.def.element).base;

  if (resolved.type !== TypeName.object) {
    throw new JITError("UNSUPPORTED_SCHEMA", `${feature} expects an array of object schemas`);
  }

  return resolved as ObjectSchema;
}

export function createBinaryRowLayout(schema: ObjectSchema): BinaryRowLayout {
  const props = schema.def.props;
  const fields: BinaryFieldLayout[] = [];
  let dictionaryIndex = 0;
  let guarded = 0;

  for (const key of Object.keys(props)) {
    const resolved = resolveWrappers(props[key]);

    if (resolved.optional || resolved.nullable) guarded++;
  }

  const maskBytes = Math.ceil(guarded / 4);
  let nextOffset = maskBytes;
  let guardIndex = 0;

  for (const key of Object.keys(props)) {
    const resolved = resolveWrappers(props[key]);
    const descriptor = describeField(key, resolved.base);
    const guard =
      resolved.optional || resolved.nullable
        ? { maskOffset: guardIndex >> 2, shift: (guardIndex++ & 3) * 2 }
        : undefined;
    const field: BinaryFieldLayout = {
      key,
      kind: descriptor.kind,
      offset: nextOffset,
      size: descriptor.size,
      ...(guard ? { guard } : {}),
      ...(descriptor.dictionary ? { dictionaryIndex: dictionaryIndex++, dictionaryMode: descriptor.dictionary } : {}),
      ...(descriptor.values ? { values: descriptor.values } : {}),
      ...(descriptor.literal !== undefined ? { literal: descriptor.literal } : {}),
    };

    fields[fields.length] = field;
    nextOffset += descriptor.size;
  }

  return {
    schema,
    rowSize: nextOffset,
    maskBytes,
    fields,
  };
}

function describeField(
  key: string,
  schema: ATS.AnyTypeSchema
): {
  readonly kind: BinaryFieldKind;
  readonly size: number;
  readonly dictionary?: "dynamic" | "fixed";
  readonly values?: readonly ScalarDictionaryValue[];
  readonly literal?: unknown;
} {
  switch (schema.type) {
    case TypeName.number:
    case TypeName.nan:
      return numberField(schema);
    case TypeName.int:
      return { kind: "int32", size: 4 };
    case TypeName.boolean:
      return { kind: "boolean", size: 1 };
    case TypeName.bigint:
      return { kind: "bigint", size: 8 };
    case TypeName.date:
      return { kind: "date", size: 8 };
    case TypeName.string:
      return { kind: "string", size: 4, dictionary: "dynamic" };
    case TypeName.enum: {
      const values = Object.values((schema as ATS.EnumSchema).def.values) as ScalarDictionaryValue[];

      return { kind: "enum", size: values.length <= 255 ? 1 : 4, dictionary: "fixed", values };
    }
    case TypeName.literal:
      return { kind: "literal", size: 0, literal: (schema as ATS.LiteralSchema).def.value };
    case TypeName.null:
      return { kind: "null", size: 0 };
    case TypeName.undefined:
      return { kind: "undefined", size: 0 };
    case TypeName.union:
    case TypeName.xor: {
      const values = literalUnionValues(schema);

      if (values) return { kind: "literalUnion", size: values.length <= 255 ? 1 : 4, dictionary: "fixed", values };
      break;
    }
  }

  throw new JITError(
    "UNSUPPORTED_SCHEMA",
    `binary rowset does not support field ${JSON.stringify(key)} (${schema.type}); use flat scalar object fields in v1`
  );
}

function numberField(schema: ATS.AnyTypeSchema): { readonly kind: BinaryFieldKind; readonly size: number } {
  const checks = ((schema.def as { readonly checks?: readonly ATS.SchemaCheck[] }).checks ?? []).map(
    (check) => check.kind
  );

  if (checks.includes("int32")) return { kind: "int32", size: 4 };
  if (checks.includes("float32")) return { kind: "float32", size: 4 };
  return { kind: "float64", size: 8 };
}

function literalUnionValues(schema: ATS.AnyTypeSchema): readonly ScalarDictionaryValue[] | undefined {
  const values: ScalarDictionaryValue[] = [];
  const options = (schema.def as ATS.OptionsDef).options;

  for (const option of options) {
    const resolved = resolveWrappers(option).base;

    if (resolved.type !== TypeName.literal) return undefined;
    const value = (resolved as ATS.LiteralSchema).def.value;

    if (typeof value !== "string" && typeof value !== "number") return undefined;
    values[values.length] = value;
  }
  return values;
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
  const offset = `o + ${field.offset}`;

  switch (field.kind) {
    case "float64":
      writer.line(`dv.setFloat64(${offset}, ${valueExpr}, true);`);
      return;
    case "float32":
      writer.line(`dv.setFloat32(${offset}, ${valueExpr}, true);`);
      return;
    case "int32":
      writer.line(`dv.setInt32(${offset}, ${valueExpr}, true);`);
      return;
    case "boolean":
      writer.line(`u8[${offset}] = ${valueExpr} ? 1 : 0;`);
      return;
    case "bigint":
      writer.line(`dv.setBigInt64(${offset}, ${valueExpr}, true);`);
      return;
    case "date":
      writer.line(`dv.setFloat64(${offset}, ${valueExpr}.getTime(), true);`);
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

  writer.line(`let ${code} = ${dictionary}.ids.get(${valueExpr});`);
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
  if (field.size === 1) writer.line(`u8[${offset}] = ${code};`);
  else writer.line(`dv.setUint32(${offset}, ${code}, true);`);
}

function emitObjectExpression(fields: readonly BinaryFieldLayout[], selected?: readonly string[]): string {
  const wanted = selected ? new Set(selected) : undefined;
  const entries: string[] = [];

  for (const field of fields) {
    if (wanted && !wanted.has(field.key)) continue;
    entries[entries.length] = `${emitLiteral(field.key)}: ${emitFieldValue(field)}`;
  }
  return `{ ${entries.join(", ")} }`;
}

function emitFieldValue(field: BinaryFieldLayout): string {
  const read = emitScalarRead(field);

  if (!field.guard) return read;

  const state = emitGuardState(field);

  return `(${state} === 1 ? null : ${state} === 2 ? ${read} : undefined)`;
}

function emitScalarRead(field: BinaryFieldLayout): string {
  const offset = `o + ${field.offset}`;

  switch (field.kind) {
    case "float64":
      return `dv.getFloat64(${offset}, true)`;
    case "float32":
      return `dv.getFloat32(${offset}, true)`;
    case "int32":
      return `dv.getInt32(${offset}, true)`;
    case "boolean":
      return `u8[${offset}] !== 0`;
    case "bigint":
      return `dv.getBigInt64(${offset}, true)`;
    case "date":
      return `new Date(dv.getFloat64(${offset}, true))`;
    case "string":
    case "enum":
    case "literalUnion":
      return `d${field.dictionaryIndex}.values[${field.size === 1 ? `u8[${offset}]` : `dv.getUint32(${offset}, true)`}]`;
    case "literal":
      return emitLiteral(field.literal as never);
    case "null":
      return "null";
    case "undefined":
      return "undefined";
  }
}

function emitFieldComparable(field: BinaryFieldLayout): string {
  const offset = `o + ${field.offset}`;

  switch (field.kind) {
    case "date":
      return `dv.getFloat64(${offset}, true)`;
    case "string":
    case "enum":
    case "literalUnion":
      return field.size === 1 ? `u8[${offset}]` : `dv.getUint32(${offset}, true)`;
    default:
      return emitScalarRead(field);
  }
}

function emitGuardState(field: BinaryFieldLayout): string {
  if (!field.guard) return "2";
  return `((u8[o + ${field.guard.maskOffset}] >> ${field.guard.shift}) & 3)`;
}

function createBinaryQueryPlan(nodes: readonly QueryNode[]): BinaryQueryPlan {
  const filters: QueryFilterNode[] = [];
  let select: QuerySelectFieldsNode | undefined;
  let aggregate: QueryAggregateNode | undefined;

  for (const node of nodes) {
    switch (node.kind) {
      case "filter":
        filters[filters.length] = node;
        break;
      case "select:fields":
        select = node;
        break;
      case "aggregate":
        aggregate = node;
        break;
      default:
        throw new JITError(
          "INVALID_QUERY",
          `binary rowset query supports filter, select, and aggregate in v1; received ${node.kind}`
        );
    }
  }

  if (select && aggregate) {
    throw new JITError("INVALID_QUERY", "binary rowset aggregate cannot be combined with select in v1");
  }

  return { filters, select, aggregate };
}

function createFieldLookup(layout: BinaryRowLayout): FieldLookup {
  return { fields: new Map(layout.fields.map((field) => [field.key, field])) };
}

function validateBinaryQueryPlan(lookup: FieldLookup, plan: BinaryQueryPlan): void {
  for (const filter of plan.filters) validateCondition(lookup, filter.condition);

  if (plan.select) validateKeys(lookup, plan.select.fields, "binary query select");
  if (plan.aggregate?.key) validateKeys(lookup, [plan.aggregate.key], `binary query ${plan.aggregate.op}`);
}

function validateCondition(lookup: FieldLookup, condition: QueryConditionNode): void {
  switch (condition.kind) {
    case "compare":
      validateValue(lookup, condition.left);
      validateValue(lookup, condition.right);
      return;
    case "logical":
      validateCondition(lookup, condition.left);
      validateCondition(lookup, condition.right);
      return;
    case "not":
      validateCondition(lookup, condition.inner);
      return;
  }
}

function validateValue(lookup: FieldLookup, value: QueryValueNode): void {
  if (value.kind === "field") validateKeys(lookup, [value.key], "binary query filter");
}

function validateKeys(lookup: FieldLookup, keys: readonly string[], label: string): void {
  for (const key of keys) {
    if (!lookup.fields.has(key)) throw new JITError("INVALID_QUERY", `${label} received unknown key ${key}`);
  }
}

function emitBinaryFilter(plan: BinaryQueryPlan, lookup: FieldLookup, prepared: PreparedValues): string | undefined {
  if (plan.filters.length === 0) return undefined;
  return plan.filters.map((filter) => emitCondition(filter.condition, lookup, prepared)).join(" && ");
}

function emitBinaryArrayQuery(
  writer: CodeWriter,
  layout: BinaryRowLayout,
  plan: BinaryQueryPlan,
  condition: string | undefined
): void {
  writer.line("const out = new Array(len);");
  writer.line("let j = 0;");
  writer.line("let o = 0;");
  writer.line("for (let i = 0; i < len; i++) {");
  writer.indent(() => {
    const accepted = () => {
      writer.line(`out[j++] = ${emitObjectExpression(layout.fields, plan.select?.fields)};`);
    };

    if (condition) {
      writer.line(`if (${condition}) {`);
      writer.indent(accepted);
      writer.line("}");
    } else {
      accepted();
    }
    writer.line(`o += ${layout.rowSize};`);
  });
  writer.line("}");
  writer.line("out.length = j;");
  writer.line("return out;");
}

function emitBinaryAggregateQuery(
  writer: CodeWriter,
  layout: BinaryRowLayout,
  lookup: FieldLookup,
  plan: BinaryQueryPlan,
  condition: string | undefined
): void {
  const aggregate = plan.aggregate;

  if (!aggregate) return;

  const field = aggregate.key ? lookup.fields.get(aggregate.key) : undefined;
  const accepted = (body: () => void) => {
    if (condition) {
      writer.line(`if (${condition}) {`);
      writer.indent(body);
      writer.line("}");
    } else {
      body();
    }
  };

  if (aggregate.op === "count") {
    writer.line("let acc = 0;");
    writer.line("let o = 0;");
    writer.line("for (let i = 0; i < len; i++) {");
    writer.indent(() => {
      accepted(() => writer.line("acc++;"));
      writer.line(`o += ${layout.rowSize};`);
    });
    writer.line("}");
    writer.line("return acc;");
    return;
  }

  if (!field) throw new JITError("INVALID_QUERY", `binary query ${aggregate.op} requires a field key`);
  if (field.kind !== "float64" && field.kind !== "float32" && field.kind !== "int32") {
    throw new JITError("INVALID_QUERY", `binary query ${aggregate.op} expects a numeric field`);
  }

  const value = emitFieldComparable(field);
  const present = field.guard ? `${emitGuardState(field)} === 2` : "true";

  switch (aggregate.op) {
    case "sum":
      writer.line("let acc = 0;");
      writer.line("let o = 0;");
      writer.line("for (let i = 0; i < len; i++) {");
      writer.indent(() => {
        accepted(() => writer.line(`if (${present}) acc += ${value};`));
        writer.line(`o += ${layout.rowSize};`);
      });
      writer.line("}");
      writer.line("return acc;");
      return;
    case "avg":
      writer.line("let acc = 0;");
      writer.line("let n = 0;");
      writer.line("let o = 0;");
      writer.line("for (let i = 0; i < len; i++) {");
      writer.indent(() => {
        accepted(() => {
          writer.line(`if (${present}) {`);
          writer.indent(() => {
            writer.line(`acc += ${value};`);
            writer.line("n++;");
          });
          writer.line("}");
        });
        writer.line(`o += ${layout.rowSize};`);
      });
      writer.line("}");
      writer.line("return n === 0 ? undefined : acc / n;");
      return;
    case "min":
    case "max": {
      const op = aggregate.op === "min" ? "<" : ">";

      writer.line("let acc;");
      writer.line("let o = 0;");
      writer.line("for (let i = 0; i < len; i++) {");
      writer.indent(() => {
        accepted(() => {
          writer.line(`if (${present}) {`);
          writer.indent(() => {
            writer.line(`const v = ${value};`);
            writer.line(`if (acc === undefined || v ${op} acc) acc = v;`);
          });
          writer.line("}");
        });
        writer.line(`o += ${layout.rowSize};`);
      });
      writer.line("}");
      writer.line("return acc;");
      return;
    }
  }
}

function emitCondition(condition: QueryConditionNode, lookup: FieldLookup, prepared: PreparedValues): string {
  switch (condition.kind) {
    case "compare":
      return emitCompare(condition.left, condition.op, condition.right, lookup, prepared);
    case "logical":
      return `(${emitCondition(condition.left, lookup, prepared)} ${condition.op === "and" ? "&&" : "||"} ${emitCondition(
        condition.right,
        lookup,
        prepared
      )})`;
    case "not":
      return `!(${emitCondition(condition.inner, lookup, prepared)})`;
  }
}

function emitCompare(
  left: QueryValueNode,
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
  right: QueryValueNode,
  lookup: FieldLookup,
  prepared: PreparedValues
): string {
  if (left.kind === "field") {
    const field = expectField(lookup, left.key);

    return emitFieldCompare(field, op, right, prepared);
  }

  if (right.kind === "field") {
    const field = expectField(lookup, right.key);

    return emitFieldCompare(field, reverseCompare(op), left, prepared);
  }

  throw new JITError("INVALID_QUERY", "binary rowset comparisons require at least one field operand");
}

function emitFieldCompare(
  field: BinaryFieldLayout,
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
  value: QueryValueNode,
  prepared: PreparedValues
): string {
  const comparable = wrapComparable(field, emitFieldComparable(field));
  const valueExpr = prepared.valueFor(field, value);
  const equality =
    field.guard === undefined
      ? `${comparable} === ${valueExpr}`
      : `((${prepared.rawFor(value)} === undefined && ${emitGuardState(field)} === 0) || (${prepared.rawFor(
          value
        )} === null && ${emitGuardState(field)} === 1) || (${emitGuardState(field)} === 2 && ${comparable} === ${valueExpr}))`;

  if (op === "eq") return equality;
  if (op === "neq") return `!(${equality})`;

  if (field.kind === "string" || field.kind === "enum" || field.kind === "literalUnion") {
    throw new JITError("INVALID_QUERY", `binary rowset ${op} does not support dictionary fields`);
  }

  const present = field.guard ? `${emitGuardState(field)} === 2 && ` : "";
  const operator = op === "gt" ? ">" : op === "gte" ? ">=" : op === "lt" ? "<" : "<=";

  return `(${present}${comparable} ${operator} ${valueExpr})`;
}

function wrapComparable(field: BinaryFieldLayout, expr: string): string {
  return field.kind === "boolean" ? `(${expr})` : expr;
}

function expectField(lookup: FieldLookup, key: string): BinaryFieldLayout {
  const field = lookup.fields.get(key);

  if (!field) throw new JITError("INVALID_QUERY", `binary rowset query received unknown key ${key}`);
  return field;
}

function reverseCompare(op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"): "eq" | "neq" | "gt" | "gte" | "lt" | "lte" {
  switch (op) {
    case "gt":
      return "lt";
    case "gte":
      return "lte";
    case "lt":
      return "gt";
    case "lte":
      return "gte";
    default:
      return op;
  }
}

class PreparedValues {
  readonly #writer: CodeWriter;
  readonly #prepared = new Map<string, string>();

  constructor(writer: CodeWriter) {
    this.#writer = writer;
  }

  rawFor(value: QueryValueNode): string {
    switch (value.kind) {
      case "binding":
        return value.name;
      case "param":
        return `params${emitPropertyAccess("", value.name)}`;
      case "literal":
        return emitLiteral(value.value as never);
      case "field":
        throw new JITError("INVALID_QUERY", "field-to-field dictionary comparisons are not supported in binary v1");
    }
  }

  valueFor(field: BinaryFieldLayout, value: QueryValueNode): string {
    if (field.kind === "date") {
      const raw = this.rawFor(value);
      const key = `date:${raw}`;
      const existing = this.#prepared.get(key);

      if (existing) return existing;
      const name = `p${this.#prepared.size}`;

      this.#writer.line(`const ${name} = ${raw} instanceof Date ? ${raw}.getTime() : ${raw};`);
      this.#prepared.set(key, name);
      return name;
    }

    if (field.kind === "string" || field.kind === "enum" || field.kind === "literalUnion") {
      const raw = this.rawFor(value);
      const key = `dict:${field.dictionaryIndex}:${raw}`;
      const existing = this.#prepared.get(key);

      if (existing) return existing;
      const name = `p${this.#prepared.size}`;

      this.#writer.line(`const ${name} = d${field.dictionaryIndex}.ids.get(${raw});`);
      this.#prepared.set(key, name);
      return name;
    }

    return this.rawFor(value);
  }
}

function serializeQueryNodes(nodes: readonly QueryNode[]): string {
  return nodes.map(serializeQueryNode).join(";");
}

function serializeQueryNode(node: QueryNode): string {
  switch (node.kind) {
    case "filter":
      return `f(${serializeCondition(node.condition)})`;
    case "select:fields":
      return `s(${node.fields.join(",")})`;
    case "aggregate":
      return `a(${node.op},${node.key ?? ""})`;
    case "unique":
      return `u(${node.key})`;
    case "keyed":
      return `k(${node.key})`;
    case "groupBy":
      return `g(${node.key})`;
    case "orderBy":
      return `o(${node.key},${node.direction})`;
    case "delete":
      return "d()";
    case "update":
      return `m(${Object.keys(node.patch).join(",")})`;
  }
}

function serializeCondition(condition: QueryConditionNode): string {
  switch (condition.kind) {
    case "compare":
      return `${condition.op}(${serializeValue(condition.left)},${serializeValue(condition.right)})`;
    case "logical":
      return `${condition.op}(${serializeCondition(condition.left)},${serializeCondition(condition.right)})`;
    case "not":
      return `not(${serializeCondition(condition.inner)})`;
  }
}

function serializeValue(value: QueryValueNode): string {
  switch (value.kind) {
    case "field":
      return `.${value.key}`;
    case "binding":
      return `$${value.name}`;
    case "param":
      return `p:${value.name}`;
    case "literal":
      return `#${typeof value.value}:${String(value.value)}`;
  }
}
