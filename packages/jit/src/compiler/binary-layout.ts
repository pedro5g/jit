import type * as ATS from "../core/ats/index.js";
import { createSchema, TypeName } from "../core/ats/index.js";
import { JITError } from "../errors/index.js";
import { type BinaryFieldDescriptor, describeField } from "./binary-field.js";
import type {
  BinaryFieldGuard,
  BinaryFieldLayout,
  BinaryMemoryLayout,
  BinaryRowLayout,
  BinaryRowViewUsage,
  BinaryUnionLayout,
  BinaryUnionVariantLayout,
} from "./binary-rowset.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";

type ObjectSchema = ATS.AnyTypeSchema & { readonly def: ATS.ObjectDef };

/** The physical schema and discriminator metadata for one binary element. */
export interface BinaryElementLayout {
  readonly schema: ObjectSchema;
  readonly union: BinaryUnionLayout | undefined;
}

export function resolveBinaryElement(schema: ATS.AnyTypeSchema, feature: string): BinaryElementLayout {
  const resolved = resolveWrappers(schema).base;

  if (resolved.type === TypeName.object) return { schema: resolved as ObjectSchema, union: undefined };
  if (resolved.type === TypeName.intersection) {
    return { schema: flattenObjectIntersection(resolved, feature), union: undefined };
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

  const variants = createUnionVariants(options, discriminator, feature);
  const merged = mergeUnionFields(options, variants, discriminator, feature);
  return { schema: createObjectSchema(merged), union: { discriminator, variants } };
}

function createUnionVariants(
  options: readonly ObjectSchema[],
  discriminator: string,
  feature: string
): BinaryUnionVariantLayout[] {
  const variants = options.map((option, tag) => {
    const discriminatorSchema = option.def.props[discriminator];
    const value = discriminatorSchema ? scalarLiteralValue(discriminatorSchema) : undefined;

    if (value === undefined) {
      throw new JITError(
        "UNSUPPORTED_SCHEMA",
        `${feature} discriminator ${JSON.stringify(discriminator)} must be a required string or number literal`
      );
    }
    return { tag, value, keys: Object.keys(option.def.props) } satisfies BinaryUnionVariantLayout;
  });
  const values = new Set(variants.map((variant) => `${typeof variant.value}:${String(variant.value)}`));

  if (values.size !== variants.length) {
    throw new JITError(
      "UNSUPPORTED_SCHEMA",
      `${feature} discriminator ${JSON.stringify(discriminator)} contains duplicate literal values`
    );
  }
  return variants;
}

function mergeUnionFields(
  options: readonly ObjectSchema[],
  variants: readonly BinaryUnionVariantLayout[],
  discriminator: string,
  feature: string
): Map<string, ResolvedObjectField> {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const option of options) {
    for (const key of Object.keys(option.def.props)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys[keys.length] = key;
    }
  }

  const merged = new Map<string, ResolvedObjectField>();
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
    const selected = mergeUnionField(options, key, feature);
    if (selected) merged.set(key, selected);
  }
  return merged;
}

function mergeUnionField(
  options: readonly ObjectSchema[],
  key: string,
  feature: string
): ResolvedObjectField | undefined {
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
  return selected ? { ...selected, optional: selected.optional || present !== options.length } : undefined;
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
  return { base: resolved.base, optional: resolved.optional, nullable: resolved.nullable };
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

interface LayoutEntry {
  readonly key: string;
  readonly descriptor: BinaryFieldDescriptor;
  readonly guard: BinaryFieldGuard | undefined;
  readonly dictionaryIndex: number | undefined;
}

interface LayoutOffsets {
  readonly memoryLayout: Exclude<BinaryMemoryLayout, "auto">;
  readonly offsets: ReadonlyMap<string, number>;
  readonly columnIndexes: ReadonlyMap<string, number>;
  readonly nextOffset: number;
}

/** Creates the physical byte layout used by binary rowsets and binary queries. */
export function createBinaryRowLayout(
  schema: ObjectSchema,
  requestedLayout: BinaryMemoryLayout = "auto",
  adaptiveStringFields?: ReadonlySet<string>,
  union: BinaryUnionLayout | undefined = undefined
): BinaryRowLayout {
  const { entries, maskBytes, alignment, payloadBytes } = createLayoutEntries(schema.def.props, adaptiveStringFields);
  const resolved = resolveLayoutOffsets(entries, maskBytes, alignment, requestedLayout);
  const fields = createLayoutFields(entries, resolved, maskBytes);
  const rowSize =
    resolved.memoryLayout === "columnar"
      ? payloadBytes
      : resolved.memoryLayout === "aligned"
        ? alignTo(resolved.nextOffset, alignment)
        : resolved.nextOffset;

  return {
    schema,
    rowSize,
    maskBytes,
    alignment: resolved.memoryLayout === "packed" ? 1 : alignment,
    paddingBytes: resolved.memoryLayout === "columnar" ? 0 : rowSize - payloadBytes,
    memoryLayout: resolved.memoryLayout,
    views: createViewUsage(fields),
    fields,
    columns:
      resolved.memoryLayout === "columnar"
        ? fields
            .filter((field) => field.columnIndex !== undefined)
            .sort((left, right) => (left.columnIndex ?? 0) - (right.columnIndex ?? 0))
        : [],
    union,
  };
}

function createLayoutEntries(
  props: Readonly<Record<string, ATS.AnyTypeSchema>>,
  adaptiveStringFields?: ReadonlySet<string>
): {
  readonly entries: readonly LayoutEntry[];
  readonly maskBytes: number;
  readonly alignment: 1 | 4 | 8;
  readonly payloadBytes: number;
} {
  const entries: LayoutEntry[] = [];
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
        ? { maskOffset: guardIndex >> 2, shift: (guardIndex++ & 3) * 2, maskStride: 0 }
        : undefined;
    entries.push({ key, descriptor, guard, dictionaryIndex: descriptor.dictionary ? dictionaryIndex++ : undefined });
    payloadBytes += descriptor.size;
  }
  return { entries, maskBytes, alignment, payloadBytes };
}

function resolveLayoutOffsets(
  entries: readonly LayoutEntry[],
  maskBytes: number,
  alignment: 1 | 4 | 8,
  requestedLayout: BinaryMemoryLayout
): LayoutOffsets {
  const packed = createPackedOffsets(entries, maskBytes);
  const memoryLayout = chooseMemoryLayout(entries, packed, alignment, requestedLayout);
  const offsets = memoryLayout === "packed" ? packed.offsets : new Map<string, number>();
  const nextOffset =
    memoryLayout === "aligned"
      ? fillAlignedOffsets(entries, offsets, maskBytes)
      : memoryLayout === "packed"
        ? packed.rowSize
        : maskBytes;
  const columnIndexes = memoryLayout === "columnar" ? createColumnIndexes(entries) : new Map<string, number>();
  return { memoryLayout, offsets, columnIndexes, nextOffset };
}

function createPackedOffsets(
  entries: readonly LayoutEntry[],
  maskBytes: number
): { readonly offsets: Map<string, number>; readonly rowSize: number } {
  const offsets = new Map<string, number>();
  let rowSize = maskBytes;
  for (const entry of entries) {
    offsets.set(entry.key, rowSize);
    rowSize += entry.descriptor.size;
  }
  return { offsets, rowSize };
}

function chooseMemoryLayout(
  entries: readonly LayoutEntry[],
  packed: { readonly offsets: ReadonlyMap<string, number>; readonly rowSize: number },
  alignment: 1 | 4 | 8,
  requestedLayout: BinaryMemoryLayout
): Exclude<BinaryMemoryLayout, "auto"> {
  if (requestedLayout !== "auto") return requestedLayout;
  const naturallyAligned =
    packed.rowSize % alignment === 0 &&
    entries.every((entry) => {
      const fieldAlignment = alignmentForSize(entry.descriptor.size);
      return (packed.offsets.get(entry.key) ?? 0) % fieldAlignment === 0;
    });
  return naturallyAligned ? "aligned" : "packed";
}

function fillAlignedOffsets(entries: readonly LayoutEntry[], offsets: Map<string, number>, maskBytes: number): number {
  let nextOffset = maskBytes;
  for (const size of [1, 4, 8] as const) {
    const sizedEntries = entries.filter((entry) => entry.descriptor.size === size);
    if (sizedEntries.length === 0) continue;
    nextOffset = alignTo(nextOffset, alignmentForSize(size));
    for (const entry of sizedEntries) {
      offsets.set(entry.key, nextOffset);
      nextOffset += size;
    }
  }
  return nextOffset;
}

function createColumnIndexes(entries: readonly LayoutEntry[]): Map<string, number> {
  const columnIndexes = new Map<string, number>();
  let columnIndex = 0;
  for (const size of [1, 4, 8] as const) {
    for (const entry of entries) {
      if (entry.descriptor.size !== size) continue;
      columnIndexes.set(entry.key, columnIndex++);
    }
  }
  return columnIndexes;
}

function createLayoutFields(
  entries: readonly LayoutEntry[],
  offsets: LayoutOffsets,
  maskBytes: number
): BinaryFieldLayout[] {
  return entries.map((entry) => {
    const columnIndex = offsets.columnIndexes.get(entry.key);
    return {
      key: entry.key,
      kind: entry.descriptor.kind,
      offset: offsets.offsets.get(entry.key) ?? offsets.nextOffset,
      size: entry.descriptor.size,
      access: fieldAccess(entry.descriptor, offsets.memoryLayout),
      ...(entry.guard
        ? {
            guard: {
              maskOffset: entry.guard.maskOffset,
              shift: entry.guard.shift,
              maskStride: offsets.memoryLayout === "columnar" ? maskBytes : 0,
            },
          }
        : {}),
      ...(columnIndex === undefined ? {} : { columnIndex }),
      ...(entry.dictionaryIndex === undefined
        ? {}
        : { dictionaryIndex: entry.dictionaryIndex, dictionaryMode: entry.descriptor.dictionary }),
      ...(entry.descriptor.values ? { values: entry.descriptor.values } : {}),
      ...(entry.descriptor.literal === undefined ? {} : { literal: entry.descriptor.literal }),
    };
  });
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

export function alignTo(value: number, alignment: 1 | 4 | 8): number {
  return Math.ceil(value / alignment) * alignment;
}

export function alignmentForSize(size: number): 1 | 4 | 8 {
  if (size === 8) return 8;
  if (size === 4) return 4;
  return 1;
}

export function createViewUsage(fields: readonly BinaryFieldLayout[]): BinaryRowViewUsage {
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

/** Resolves the typed views required by a generated rowset operation. */
export function getAccessNeeds(fields: readonly BinaryFieldLayout[]): BinaryAccessNeeds {
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
