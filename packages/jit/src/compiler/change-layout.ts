import type * as ATS from "../core/ats/index.js";
import { allFieldPaths, type ChangedDescriptor, type MaskRepresentation, resolveChangedDescriptor } from "./changed.js";

/**
 * The path-to-bit agreement a change mask rests on.
 *
 * A mask is only meaningful next to the layout it was produced against. Change
 * masks, mutation results, watches and derived computations all read the same
 * layout so a bit means the same field everywhere; a mask produced against a
 * different layout is a different number, and saying so is the point of giving
 * the layout an identity.
 */
export interface ChangeLayout {
  /** Watched paths in bit order; the index is the bit position. */
  readonly paths: readonly string[];
  readonly representation: MaskRepresentation;
  /** Identity of the agreement, for compatibility checks. Never persisted. */
  readonly id: string;
}

export function resolveChangeLayout(schema: ATS.AnyTypeSchema, paths?: readonly string[]): ChangeLayout {
  return changeLayoutOf(resolveChangedDescriptor(schema, paths ?? allFieldPaths(schema, "JIT.compare.changed()")));
}

export function changeLayoutOf(descriptor: ChangedDescriptor): ChangeLayout {
  const paths = descriptor.fields.map((field) => field.path);
  return Object.freeze({
    paths: Object.freeze(paths),
    representation: descriptor.representation,
    id: `${descriptor.representation}:${paths.join(",")}`,
  });
}

export function changeLayoutBit(layout: ChangeLayout, path: string): number | undefined {
  const bit = layout.paths.indexOf(path);
  return bit === -1 ? undefined : bit;
}

/**
 * The bit a write to `path` sets, or `undefined` when the layout watches
 * nothing that contains it.
 *
 * A watched path that is a prefix of the write is the field that changed: the
 * write happened inside it. The reverse — writing an ancestor of a watched path
 * — cannot say whether the watched leaf changed, so it is not answered here.
 */
export function changeLayoutBitFor(layout: ChangeLayout, path: readonly string[]): number | undefined {
  const written = path.join(".");
  let best: number | undefined;
  let bestLength = -1;

  for (let index = 0; index < layout.paths.length; index++) {
    const candidate = layout.paths[index] as string;
    if (candidate !== written && !written.startsWith(`${candidate}.`)) continue;
    if (candidate.length > bestLength) {
      best = index;
      bestLength = candidate.length;
    }
  }
  return best;
}

/** Emits the literal for one bit, in the layout's representation. */
export function emitChangeBit(layout: ChangeLayout, bit: number): string {
  return layout.representation === "bigint" ? `(1n << ${bit}n)` : `${1 << bit}`;
}

export function emitChangeZero(layout: ChangeLayout): string {
  return layout.representation === "bigint" ? "0n" : "0";
}
