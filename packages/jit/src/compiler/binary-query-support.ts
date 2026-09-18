import type { BinaryRowLayout } from "./binary-rowset.js";

export { serializeQueryNodes } from "./query-serialization.js";

export function serializeBinaryLayout(layout: BinaryRowLayout): string {
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
