import type {
  QueryAggregateNode,
  QueryConditionNode,
  QueryFilterNode,
  QueryNode,
  QuerySelectFieldsNode,
  QueryValueNode,
} from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
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
export type BinaryMemoryLayout = "auto" | "packed" | "aligned" | "columnar";

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
  readonly maskStride: number;
}

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

export interface BinaryRowViewUsage {
  readonly int32: boolean;
  readonly uint32: boolean;
  readonly float32: boolean;
  readonly float64: boolean;
  readonly bigint64: boolean;
}

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

export interface BinaryUnionVariantLayout {
  readonly tag: number;
  readonly value: string | number;
  readonly keys: readonly string[];
}

export interface BinaryUnionLayout {
  readonly discriminator: string;
  readonly variants: readonly BinaryUnionVariantLayout[];
}

export interface BinaryDictionary {
  readonly ids: Map<ScalarDictionaryValue, number>;
  readonly values: ScalarDictionaryValue[];
  identity: boolean;
}

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
  ATS.TypeofSchema<TSchema> extends (infer TElement)[] ? TElement : never;

interface BinaryArrayState {
  buffer: ArrayBufferLike | undefined;
  bufferOffset: number;
  byteLength: number;
}

interface BinaryCompileHints {
  readonly adaptiveStringFields?: ReadonlySet<string>;
}

interface BinaryElementLayout {
  readonly schema: ObjectSchema;
  readonly union: BinaryUnionLayout | undefined;
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
const EMPTY_INT32 = new Int32Array(EMPTY_BUFFER);
const EMPTY_UINT32 = new Uint32Array(EMPTY_BUFFER);
const EMPTY_FLOAT32 = new Float32Array(EMPTY_BUFFER);
const EMPTY_FLOAT64 = new Float64Array(EMPTY_BUFFER);
const EMPTY_BIGINT64 = new BigInt64Array(EMPTY_BUFFER);
const EMPTY_OFFSETS = new Uint32Array(EMPTY_BUFFER);

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

export function emitBinaryQuerySource(layout: BinaryRowLayout, program: BinaryQueryProgram): string {
  const plan = createBinaryQueryPlan(program.nodes);
  const lookup = createFieldLookup(layout);

  validateBinaryQueryPlan(lookup, plan);
  const accessedFields = collectQueryAccessFields(layout, lookup, plan);

  const writer = new CodeWriter();
  const hasParams = Boolean(program.params?.length);

  writer.line(`function query(rowset${hasParams ? ", params" : ""}) {`);
  writer.indent(() => {
    emitRowViewBindings(writer, accessedFields);
    if (hasDictionary(accessedFields)) writer.line("const dictionaries = rowset.dictionaries;");
    writer.line("const len = rowset.count;");
    emitDictionaryBindings(writer, accessedFields);

    const prepared = new PreparedValues(writer);
    const aggregateKey = plan.aggregate?.key;
    const cacheAggregateValue = aggregateKey !== undefined && filtersReadField(plan.filters, aggregateKey);
    const comparableOverrides = cacheAggregateValue ? new Map([[aggregateKey, "v"]]) : undefined;
    const condition = emitBinaryFilter(plan, lookup, prepared, comparableOverrides);

    if (plan.aggregate) {
      emitBinaryAggregateQuery(writer, layout, lookup, plan, condition, accessedFields, cacheAggregateValue);
    } else {
      emitBinaryArrayQuery(writer, layout, plan, condition, accessedFields);
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
  const cacheKey = `binary-query:${serializeBinaryLayout(layout)}:${serializeQueryNodes(program.nodes)}`;
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

function resolveBinaryElement(schema: ATS.AnyTypeSchema, feature: string): BinaryElementLayout {
  const resolved = resolveWrappers(schema).base;

  if (resolved.type === TypeName.object) {
    return { schema: resolved as ObjectSchema, union: undefined };
  }
  if (resolved.type === TypeName.intersection) {
    return {
      schema: flattenObjectIntersection(resolved, feature),
      union: undefined,
    };
  }
  if (resolved.type === TypeName.union || resolved.type === TypeName.discriminatedUnion) {
    return flattenObjectUnion(resolved, feature);
  }
  throw new JITError(
    "UNSUPPORTED_SCHEMA",
    `${feature} expects object, object intersection, or discriminated object union elements`
  );
}

interface ResolvedObjectField {
  readonly base: ATS.AnyTypeSchema;
  readonly optional: boolean;
  readonly nullable: boolean;
}

function flattenObjectIntersection(schema: ATS.AnyTypeSchema, feature: string): ObjectSchema {
  const options = (schema.def as ATS.OptionsDef).options;
  const fields = new Map<string, ResolvedObjectField>();

  for (const option of options) {
    const object = resolveObjectOption(option, feature);

    for (const key of Object.keys(object.def.props)) {
      const next = resolvedObjectField(object.def.props[key]);
      const previous = fields.get(key);

      if (previous && fieldSignature(key, previous.base) !== fieldSignature(key, next.base)) {
        throw new JITError(
          "UNSUPPORTED_SCHEMA",
          `${feature} intersection has incompatible physical definitions for field ${JSON.stringify(key)}`
        );
      }
      fields.set(
        key,
        previous
          ? {
              base: previous.base,
              optional: previous.optional && next.optional,
              nullable: previous.nullable && next.nullable,
            }
          : next
      );
    }
  }
  return createObjectSchema(fields);
}

function flattenObjectUnion(schema: ATS.AnyTypeSchema, feature: string): BinaryElementLayout {
  const options = (schema.def as ATS.OptionsDef).options.map((option) => resolveObjectOption(option, feature));
  const explicit =
    schema.type === TypeName.discriminatedUnion ? (schema.def as ATS.DiscriminatedUnionDef).discriminator : undefined;
  const discriminator = explicit ?? inferLiteralDiscriminator(options);

  if (!discriminator) {
    throw new JITError(
      "UNSUPPORTED_SCHEMA",
      `${feature} object unions require a shared field with a distinct string or number literal in every option`
    );
  }

  const variants = options.map((option, tag) => {
    const discriminatorSchema = option.def.props[discriminator];
    const value = discriminatorSchema ? scalarLiteralValue(discriminatorSchema) : undefined;

    if (value === undefined) {
      throw new JITError(
        "UNSUPPORTED_SCHEMA",
        `${feature} discriminator ${JSON.stringify(discriminator)} must be a required string or number literal`
      );
    }
    return {
      tag,
      value,
      keys: Object.keys(option.def.props),
    } satisfies BinaryUnionVariantLayout;
  });
  const values = new Set(variants.map((variant) => `${typeof variant.value}:${String(variant.value)}`));

  if (values.size !== variants.length) {
    throw new JITError(
      "UNSUPPORTED_SCHEMA",
      `${feature} discriminator ${JSON.stringify(discriminator)} contains duplicate literal values`
    );
  }

  const keys: string[] = [];
  const seen = new Set<string>();
  const merged = new Map<string, ResolvedObjectField>();

  for (const option of options) {
    for (const key of Object.keys(option.def.props)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys[keys.length] = key;
      }
    }
  }

  for (const key of keys) {
    if (key === discriminator) {
      const literalSchemas = variants.map((variant) => createSchema(TypeName.literal, { value: variant.value }));
      merged.set(key, {
        base: createSchema(TypeName.union, { options: literalSchemas }),
        optional: false,
        nullable: false,
      });
      continue;
    }

    let selected: ResolvedObjectField | undefined;
    let present = 0;

    for (const option of options) {
      const field = option.def.props[key];

      if (!field) continue;
      const next = resolvedObjectField(field);

      if (selected && fieldSignature(key, selected.base) !== fieldSignature(key, next.base)) {
        throw new JITError(
          "UNSUPPORTED_SCHEMA",
          `${feature} union has incompatible physical definitions for field ${JSON.stringify(key)}`
        );
      }
      selected = selected
        ? {
            base: selected.base,
            optional: selected.optional || next.optional,
            nullable: selected.nullable || next.nullable,
          }
        : next;
      present++;
    }

    if (selected)
      merged.set(key, {
        ...selected,
        optional: selected.optional || present !== options.length,
      });
  }

  return {
    schema: createObjectSchema(merged),
    union: { discriminator, variants },
  };
}

function resolveObjectOption(schema: ATS.AnyTypeSchema, feature: string): ObjectSchema {
  const resolved = resolveWrappers(schema).base;

  if (resolved.type === TypeName.object) return resolved as ObjectSchema;
  if (resolved.type === TypeName.intersection) return flattenObjectIntersection(resolved, feature);
  throw new JITError("UNSUPPORTED_SCHEMA", `${feature} composition options must resolve to object schemas`);
}

function inferLiteralDiscriminator(options: readonly ObjectSchema[]): string | undefined {
  const first = options[0];

  if (!first) return undefined;
  for (const key of Object.keys(first.def.props)) {
    const seen = new Set<string>();
    let valid = true;

    for (const option of options) {
      const schema = option.def.props[key];
      const value = schema ? scalarLiteralValue(schema) : undefined;

      if (value === undefined) {
        valid = false;
        break;
      }
      const signature = `${typeof value}:${String(value)}`;
      if (seen.has(signature)) {
        valid = false;
        break;
      }
      seen.add(signature);
    }
    if (valid) return key;
  }
  return undefined;
}

function scalarLiteralValue(schema: ATS.AnyTypeSchema): string | number | undefined {
  const resolved = resolveWrappers(schema);

  if (resolved.optional || resolved.nullable || resolved.base.type !== TypeName.literal) return undefined;
  const value = (resolved.base as ATS.LiteralSchema).def.value;
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function resolvedObjectField(schema: ATS.AnyTypeSchema): ResolvedObjectField {
  const resolved = resolveWrappers(schema);
  return {
    base: resolved.base,
    optional: resolved.optional,
    nullable: resolved.nullable,
  };
}

function createObjectSchema(fields: ReadonlyMap<string, ResolvedObjectField>): ObjectSchema {
  const props: Record<string, ATS.AnyTypeSchema> = {};

  for (const [key, field] of fields) {
    let schema = field.base;
    if (field.nullable) schema = createSchema(TypeName.nullable, { innerType: schema });
    if (field.optional) schema = createSchema(TypeName.optional, { innerType: schema });
    props[key] = schema;
  }
  return createSchema(TypeName.object, { props }) as ObjectSchema;
}

function fieldSignature(key: string, schema: ATS.AnyTypeSchema): string {
  const descriptor = describeField(key, schema);
  return JSON.stringify([descriptor.kind, descriptor.size, descriptor.values, descriptor.literal]);
}

export function createBinaryRowLayout(
  schema: ObjectSchema,
  requestedLayout: BinaryMemoryLayout = "auto",
  adaptiveStringFields?: ReadonlySet<string>,
  union: BinaryUnionLayout | undefined = undefined
): BinaryRowLayout {
  const props = schema.def.props;
  const entries: {
    readonly key: string;
    readonly descriptor: BinaryFieldDescriptor;
    readonly guard: BinaryFieldGuard | undefined;
    readonly dictionaryIndex: number | undefined;
  }[] = [];
  let dictionaryIndex = 0;
  let guarded = 0;

  for (const key of Object.keys(props)) {
    const resolved = resolveWrappers(props[key]);

    if (resolved.optional || resolved.nullable) guarded++;
  }

  const maskBytes = Math.ceil(guarded / 4);
  let guardIndex = 0;
  let alignment: 1 | 4 | 8 = 1;
  let payloadBytes = maskBytes;

  for (const key of Object.keys(props)) {
    const resolved = resolveWrappers(props[key]);
    const descriptor = describeField(key, resolved.base, adaptiveStringFields);
    const fieldAlignment = alignmentForSize(descriptor.size);
    if (fieldAlignment > alignment) alignment = fieldAlignment;
    const guard =
      resolved.optional || resolved.nullable
        ? {
            maskOffset: guardIndex >> 2,
            shift: (guardIndex++ & 3) * 2,
            maskStride: 0,
          }
        : undefined;

    entries[entries.length] = {
      key,
      descriptor,
      guard,
      dictionaryIndex: descriptor.dictionary ? dictionaryIndex++ : undefined,
    };
    payloadBytes += descriptor.size;
  }

  const packedOffsets = new Map<string, number>();
  let packedRowSize = maskBytes;

  for (const entry of entries) {
    packedOffsets.set(entry.key, packedRowSize);
    packedRowSize += entry.descriptor.size;
  }

  const naturallyAligned =
    packedRowSize % alignment === 0 &&
    entries.every((entry) => {
      const fieldAlignment = alignmentForSize(entry.descriptor.size);
      return (packedOffsets.get(entry.key) ?? 0) % fieldAlignment === 0;
    });
  const memoryLayout = requestedLayout === "auto" ? (naturallyAligned ? "aligned" : "packed") : requestedLayout;
  const offsets = memoryLayout === "packed" ? packedOffsets : new Map<string, number>();
  const columnIndexes = new Map<string, number>();
  let nextOffset = memoryLayout === "packed" ? packedRowSize : maskBytes;

  if (memoryLayout === "aligned") {
    // Small fields fill the bytes after the header before wider aligned lanes.
    for (const size of [1, 4, 8] as const) {
      if (!entries.some((entry) => entry.descriptor.size === size)) continue;
      nextOffset = alignTo(nextOffset, alignmentForSize(size));

      for (const entry of entries) {
        if (entry.descriptor.size !== size) continue;
        offsets.set(entry.key, nextOffset);
        nextOffset += size;
      }
    }
  }

  if (memoryLayout === "columnar") {
    let columnIndex = 0;

    for (const size of [1, 4, 8] as const) {
      for (const entry of entries) {
        if (entry.descriptor.size !== size) continue;
        columnIndexes.set(entry.key, columnIndex++);
      }
    }
  }

  const rowSize =
    memoryLayout === "columnar"
      ? payloadBytes
      : memoryLayout === "aligned"
        ? alignTo(nextOffset, alignment)
        : nextOffset;
  const requiredAlignment = memoryLayout === "packed" ? 1 : alignment;

  const fields: BinaryFieldLayout[] = entries.map((entry) => {
    const columnIndex = columnIndexes.get(entry.key);

    return {
      key: entry.key,
      kind: entry.descriptor.kind,
      offset: offsets.get(entry.key) ?? nextOffset,
      size: entry.descriptor.size,
      access: fieldAccess(entry.descriptor, memoryLayout),
      ...(entry.guard
        ? {
            guard: {
              maskOffset: entry.guard.maskOffset,
              shift: entry.guard.shift,
              maskStride: memoryLayout === "columnar" ? maskBytes : 0,
            },
          }
        : {}),
      ...(columnIndex !== undefined ? { columnIndex } : {}),
      ...(entry.dictionaryIndex !== undefined
        ? {
            dictionaryIndex: entry.dictionaryIndex,
            dictionaryMode: entry.descriptor.dictionary,
          }
        : {}),
      ...(entry.descriptor.values ? { values: entry.descriptor.values } : {}),
      ...(entry.descriptor.literal !== undefined ? { literal: entry.descriptor.literal } : {}),
    };
  });
  const columns =
    memoryLayout === "columnar"
      ? fields
          .filter((field) => field.columnIndex !== undefined)
          .sort((left, right) => (left.columnIndex ?? 0) - (right.columnIndex ?? 0))
      : [];

  return {
    schema,
    rowSize,
    maskBytes,
    alignment: requiredAlignment,
    paddingBytes: memoryLayout === "columnar" ? 0 : rowSize - payloadBytes,
    memoryLayout,
    views: createViewUsage(fields),
    fields,
    columns,
    union,
  };
}

function fieldAccess(
  descriptor: BinaryFieldDescriptor,
  memoryLayout: Exclude<BinaryMemoryLayout, "auto">
): BinaryFieldLayout["access"] {
  if (descriptor.size === 0) return "none";
  if (descriptor.size === 1) return "byte";
  if (memoryLayout === "packed") return "dataView";

  switch (descriptor.kind) {
    case "int32":
      return "int32";
    case "float32":
      return "float32";
    case "float64":
    case "date":
      return "float64";
    case "bigint":
      return "bigint64";
    case "string":
    case "enum":
    case "literalUnion":
      return "uint32";
    default:
      throw new JITError("INVALID_OPERATION", `binary field ${descriptor.kind} has no aligned access strategy`);
  }
}

function alignTo(value: number, alignment: 1 | 4 | 8): number {
  return Math.ceil(value / alignment) * alignment;
}

function alignmentForSize(size: number): 1 | 4 | 8 {
  if (size === 8) return 8;
  if (size === 4) return 4;
  return 1;
}

function createViewUsage(fields: readonly BinaryFieldLayout[]): BinaryRowViewUsage {
  let int32 = false;
  let uint32 = false;
  let float32 = false;
  let float64 = false;
  let bigint64 = false;

  for (const field of fields) {
    switch (field.access) {
      case "int32":
        int32 = true;
        break;
      case "uint32":
        uint32 = true;
        break;
      case "float32":
        float32 = true;
        break;
      case "float64":
        float64 = true;
        break;
      case "bigint64":
        bigint64 = true;
        break;
      default:
        break;
    }
  }

  return { int32, uint32, float32, float64, bigint64 };
}

interface BinaryAccessNeeds {
  readonly bytes: boolean;
  readonly dataView: boolean;
  readonly words: boolean;
  readonly doubles: boolean;
  readonly views: BinaryRowViewUsage;
}

function getAccessNeeds(fields: readonly BinaryFieldLayout[]): BinaryAccessNeeds {
  const views = createViewUsage(fields);
  let bytes = false;
  let dataView = false;
  let words = false;
  let doubles = false;

  for (const field of fields) {
    if (field.guard !== undefined || field.access === "byte") bytes = true;
    if (field.access === "dataView") dataView = true;
    if (field.access === "int32" || field.access === "uint32" || field.access === "float32") words = true;
    if (field.access === "float64" || field.access === "bigint64") doubles = true;
  }

  return { bytes, dataView, words, doubles, views };
}

function emitRowViewBindings(writer: CodeWriter, fields: readonly BinaryFieldLayout[], source = "rowset"): void {
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

function emitDictionaryBindings(
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

function hasDictionary(fields: readonly BinaryFieldLayout[]): boolean {
  return fields.some((field) => field.dictionaryIndex !== undefined);
}

function emitRowCursorDeclarations(
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

function emitRowCursorAdvance(writer: CodeWriter, layout: BinaryRowLayout, fields: readonly BinaryFieldLayout[]): void {
  if (layout.memoryLayout === "columnar") return;
  const needs = getAccessNeeds(fields);

  if (needs.bytes || needs.dataView) writer.line(`o += ${layout.rowSize};`);
  if (needs.words) writer.line(`w += ${layout.rowSize / 4};`);
  if (needs.doubles) writer.line(`d += ${layout.rowSize / 8};`);
}

interface BinaryFieldDescriptor {
  readonly kind: BinaryFieldKind;
  readonly size: number;
  readonly dictionary?: "dynamic" | "adaptive" | "fixed";
  readonly values?: readonly ScalarDictionaryValue[];
  readonly literal?: unknown;
}

function describeField(
  key: string,
  schema: ATS.AnyTypeSchema,
  adaptiveStringFields?: ReadonlySet<string>
): BinaryFieldDescriptor {
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
      return {
        kind: "string",
        size: 4,
        dictionary: adaptiveStringFields?.has(key) ? "adaptive" : "dynamic",
      };
    case TypeName.enum: {
      const values = Object.values((schema as ATS.EnumSchema).def.values) as ScalarDictionaryValue[];

      return {
        kind: "enum",
        size: values.length <= 255 ? 1 : 4,
        dictionary: "fixed",
        values,
      };
    }
    case TypeName.literal:
      return {
        kind: "literal",
        size: 0,
        literal: (schema as ATS.LiteralSchema).def.value,
      };
    case TypeName.null:
      return { kind: "null", size: 0 };
    case TypeName.undefined:
      return { kind: "undefined", size: 0 };
    case TypeName.union:
    case TypeName.xor: {
      const values = literalUnionValues(schema);

      if (values)
        return {
          kind: "literalUnion",
          size: values.length <= 255 ? 1 : 4,
          dictionary: "fixed",
          values,
        };
      break;
    }
  }

  throw new JITError(
    "UNSUPPORTED_SCHEMA",
    `binary rowset does not support field ${JSON.stringify(key)} (${schema.type}); use flat scalar object fields in v1`
  );
}

function numberField(schema: ATS.AnyTypeSchema): {
  readonly kind: BinaryFieldKind;
  readonly size: number;
} {
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

function emitObjectExpression(fields: readonly BinaryFieldLayout[], selected?: readonly string[]): string {
  const wanted = selected ? new Set(selected) : undefined;
  const entries: string[] = [];

  for (const field of fields) {
    if (wanted && !wanted.has(field.key)) continue;
    entries[entries.length] = `${emitLiteral(field.key)}: ${emitFieldValue(field)}`;
  }
  return `{ ${entries.join(", ")} }`;
}

function emitHydratedObjectAssignment(writer: CodeWriter, layout: BinaryRowLayout, target: string): void {
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

function emitFieldComparable(field: BinaryFieldLayout): string {
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

function emitTypedIndex(field: BinaryFieldLayout): string {
  if (field.columnIndex !== undefined) return `b${field.columnIndex} + i`;
  if (field.size === 8) return `d + ${field.offset / 8}`;
  if (field.size === 4) return `w + ${field.offset / 4}`;
  throw new JITError("INVALID_OPERATION", `binary field ${field.key} does not use a typed index`);
}

function emitByteIndex(field: BinaryFieldLayout): string {
  return field.columnIndex === undefined ? `o + ${field.offset}` : `b${field.columnIndex} + i`;
}

function emitMaskIndex(layout: BinaryRowLayout, maskOffset: number): string {
  if (layout.memoryLayout !== "columnar") return `o + ${maskOffset}`;
  if (layout.maskBytes === 1) return "i";
  return `i * ${layout.maskBytes} + ${maskOffset}`;
}

function emitGuardState(field: BinaryFieldLayout): string {
  if (!field.guard) return "2";
  const maskIndex =
    field.guard.maskStride === 0
      ? `o + ${field.guard.maskOffset}`
      : field.guard.maskStride === 1
        ? "i"
        : `i * ${field.guard.maskStride} + ${field.guard.maskOffset}`;

  return `((u8[${maskIndex}] >> ${field.guard.shift}) & 3)`;
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

function collectQueryAccessFields(
  layout: BinaryRowLayout,
  lookup: FieldLookup,
  plan: BinaryQueryPlan
): readonly BinaryFieldLayout[] {
  const keys = new Set<string>();

  for (const filter of plan.filters) collectConditionFieldKeys(filter.condition, keys);

  if (plan.aggregate?.key) {
    keys.add(plan.aggregate.key);
  } else if (!plan.aggregate) {
    if (plan.select) {
      for (const key of plan.select.fields) keys.add(key);
    } else {
      for (const field of layout.fields) keys.add(field.key);
    }
  }

  return layout.fields.filter((field) => keys.has(field.key) && lookup.fields.has(field.key));
}

function collectConditionFieldKeys(condition: QueryConditionNode, keys: Set<string>): void {
  switch (condition.kind) {
    case "compare":
      if (condition.left.kind === "field") keys.add(condition.left.key);
      if (condition.right.kind === "field") keys.add(condition.right.key);
      return;
    case "logical":
      collectConditionFieldKeys(condition.left, keys);
      collectConditionFieldKeys(condition.right, keys);
      return;
    case "not":
      collectConditionFieldKeys(condition.inner, keys);
      return;
  }
}

function filtersReadField(filters: readonly QueryFilterNode[], key: string): boolean {
  const keys = new Set<string>();

  for (const filter of filters) collectConditionFieldKeys(filter.condition, keys);
  return keys.has(key);
}

function emitBinaryFilter(
  plan: BinaryQueryPlan,
  lookup: FieldLookup,
  prepared: PreparedValues,
  comparableOverrides?: ReadonlyMap<string, string>
): string | undefined {
  if (plan.filters.length === 0) return undefined;
  return plan.filters
    .map((filter) => emitCondition(filter.condition, lookup, prepared, comparableOverrides))
    .join(" && ");
}

function emitBinaryArrayQuery(
  writer: CodeWriter,
  layout: BinaryRowLayout,
  plan: BinaryQueryPlan,
  condition: string | undefined,
  accessedFields: readonly BinaryFieldLayout[]
): void {
  writer.line("const out = new Array(len);");
  writer.line("let j = 0;");
  emitRowCursorDeclarations(writer, layout, accessedFields);
  writer.line("for (let i = 0; i < len; i++) {");
  writer.indent(() => {
    const accepted = () => {
      if (layout.union && !plan.select) {
        emitHydratedObjectAssignment(writer, layout, "out[j++]");
      } else {
        writer.line(`out[j++] = ${emitObjectExpression(layout.fields, plan.select?.fields)};`);
      }
    };

    if (condition) {
      writer.line(`if (${condition}) {`);
      writer.indent(accepted);
      writer.line("}");
    } else {
      accepted();
    }
    emitRowCursorAdvance(writer, layout, accessedFields);
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
  condition: string | undefined,
  accessedFields: readonly BinaryFieldLayout[],
  cacheAggregateValue: boolean
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
    emitRowCursorDeclarations(writer, layout, accessedFields);
    writer.line("for (let i = 0; i < len; i++) {");
    writer.indent(() => {
      accepted(() => writer.line("acc++;"));
      emitRowCursorAdvance(writer, layout, accessedFields);
    });
    writer.line("}");
    writer.line("return acc;");
    return;
  }

  if (!field) throw new JITError("INVALID_QUERY", `binary query ${aggregate.op} requires a field key`);
  if (field.kind !== "float64" && field.kind !== "float32" && field.kind !== "int32") {
    throw new JITError("INVALID_QUERY", `binary query ${aggregate.op} expects a numeric field`);
  }

  const rawValue = emitFieldComparable(field);
  const value = cacheAggregateValue ? "v" : rawValue;
  const present = field.guard ? `${emitGuardState(field)} === 2` : "true";

  switch (aggregate.op) {
    case "sum":
      writer.line("let acc = 0;");
      emitRowCursorDeclarations(writer, layout, accessedFields);
      writer.line("for (let i = 0; i < len; i++) {");
      writer.indent(() => {
        if (cacheAggregateValue) writer.line(`const v = ${rawValue};`);
        const shouldAdd = condition ? (field.guard ? `(${condition}) && ${present}` : condition) : present;

        if (shouldAdd === "true") writer.line(`acc += ${value};`);
        else writer.line(`acc += (${shouldAdd}) ? ${value} : 0;`);
        emitRowCursorAdvance(writer, layout, accessedFields);
      });
      writer.line("}");
      writer.line("return acc;");
      return;
    case "avg":
      writer.line("let acc = 0;");
      writer.line("let n = 0;");
      emitRowCursorDeclarations(writer, layout, accessedFields);
      writer.line("for (let i = 0; i < len; i++) {");
      writer.indent(() => {
        if (cacheAggregateValue) writer.line(`const v = ${rawValue};`);
        accepted(() => {
          writer.line(`if (${present}) {`);
          writer.indent(() => {
            writer.line(`acc += ${value};`);
            writer.line("n++;");
          });
          writer.line("}");
        });
        emitRowCursorAdvance(writer, layout, accessedFields);
      });
      writer.line("}");
      writer.line("return n === 0 ? undefined : acc / n;");
      return;
    case "min":
    case "max": {
      const op = aggregate.op === "min" ? "<" : ">";

      writer.line("let acc;");
      emitRowCursorDeclarations(writer, layout, accessedFields);
      writer.line("for (let i = 0; i < len; i++) {");
      writer.indent(() => {
        if (cacheAggregateValue) writer.line(`const v = ${rawValue};`);
        accepted(() => {
          writer.line(`if (${present}) {`);
          writer.indent(() => {
            writer.line(`const candidate = ${value};`);
            writer.line(`if (acc === undefined || candidate ${op} acc) acc = candidate;`);
          });
          writer.line("}");
        });
        emitRowCursorAdvance(writer, layout, accessedFields);
      });
      writer.line("}");
      writer.line("return acc;");
      return;
    }
  }
}

function emitCondition(
  condition: QueryConditionNode,
  lookup: FieldLookup,
  prepared: PreparedValues,
  comparableOverrides?: ReadonlyMap<string, string>
): string {
  switch (condition.kind) {
    case "compare":
      return emitCompare(condition.left, condition.op, condition.right, lookup, prepared, comparableOverrides);
    case "logical":
      return `(${emitCondition(condition.left, lookup, prepared, comparableOverrides)} ${condition.op === "and" ? "&&" : "||"} ${emitCondition(
        condition.right,
        lookup,
        prepared,
        comparableOverrides
      )})`;
    case "not":
      return `!(${emitCondition(condition.inner, lookup, prepared, comparableOverrides)})`;
  }
}

function emitCompare(
  left: QueryValueNode,
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
  right: QueryValueNode,
  lookup: FieldLookup,
  prepared: PreparedValues,
  comparableOverrides?: ReadonlyMap<string, string>
): string {
  if (left.kind === "field") {
    const field = expectField(lookup, left.key);

    return emitFieldCompare(field, op, right, prepared, comparableOverrides?.get(left.key));
  }

  if (right.kind === "field") {
    const field = expectField(lookup, right.key);

    return emitFieldCompare(field, reverseCompare(op), left, prepared, comparableOverrides?.get(right.key));
  }

  throw new JITError("INVALID_QUERY", "binary rowset comparisons require at least one field operand");
}

function emitFieldCompare(
  field: BinaryFieldLayout,
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
  value: QueryValueNode,
  prepared: PreparedValues,
  comparableOverride?: string
): string {
  if (field.dictionaryMode === "adaptive") {
    throw new JITError("INVALID_QUERY", `binary adaptive string field ${field.key} is projection-only`);
  }
  const comparable = comparableOverride ?? emitFieldComparable(field);
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
    if (field.kind === "boolean") {
      const raw = this.rawFor(value);
      const key = `boolean:${raw}`;
      const existing = this.#prepared.get(key);

      if (existing) return existing;
      const name = `p${this.#prepared.size}`;

      this.#writer.line(`const ${name} = ${raw} === true ? 1 : ${raw} === false ? 0 : -1;`);
      this.#prepared.set(key, name);
      return name;
    }

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

function serializeBinaryLayout(layout: BinaryRowLayout): string {
  return JSON.stringify([
    layout.memoryLayout,
    layout.rowSize,
    layout.maskBytes,
    layout.union
      ? [layout.union.discriminator, layout.union.variants.map((variant) => [variant.tag, variant.value, variant.keys])]
      : undefined,
    layout.fields.map((field) => [
      field.key,
      field.kind,
      field.offset,
      field.size,
      field.access,
      field.columnIndex,
      field.guard?.maskOffset,
      field.guard?.shift,
    ]),
  ]);
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
