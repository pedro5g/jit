import {
  ALL_CHANNELS,
  compileReconcile,
  type ReconcileChanges,
  type ReconcileChannels,
  type ReconcileSink,
  resolveReconcileDescriptor,
} from "../compiler/reconcile.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";

type RowOf<TSchema extends ATS.AnyTypeSchema> =
  ATS.TypeofSchema<TSchema> extends readonly (infer TRow)[] ? TRow : ATS.TypeofSchema<TSchema>;
type RowKey<TSchema extends ATS.AnyTypeSchema> = Extract<keyof RowOf<TSchema>, string>;

/** One structural difference, as `JIT.compare.diff` reports it. */
export type ReconcileDelta = readonly (
  | { readonly type: "add" | "update"; readonly path: readonly PropertyKey[]; readonly value: unknown }
  | { readonly type: "remove"; readonly path: readonly PropertyKey[] }
)[];

export interface ReconcileChange<TRow> {
  readonly before: TRow;
  readonly after: TRow;
}

export interface ReconcileChangeWithDiff<TRow> extends ReconcileChange<TRow> {
  readonly diff: ReconcileDelta;
}

/** A channel is on unless it was explicitly turned off. */
export type ResolvedChannels<TChannels> = {
  readonly [K in keyof ReconcileChannels]: K extends keyof TChannels
    ? TChannels[K] extends false
      ? false
      : true
    : true;
};

/** Only the channels that were asked for are present, because only they are built. */
export type ReconcileResult<TRow, TChannels, TChange> = {
  readonly [K in keyof ReconcileChannels as TChannels[K & keyof TChannels] extends false
    ? never
    : K]: K extends "changed" ? TChange[] : TRow[];
};

export type ReconcileEvent<TRow, TChange> =
  | { readonly type: "added"; readonly value: TRow }
  | { readonly type: "removed"; readonly value: TRow }
  | { readonly type: "unchanged"; readonly value: TRow }
  | { readonly type: "changed"; readonly value: TChange };

/** A visitor is handed each result as it is found; nothing is collected. */
export interface ReconcileVisitor<TRow> {
  added?(value: TRow): void;
  removed?(value: TRow): void;
  unchanged?(value: TRow): void;
  changed?(before: TRow, after: TRow, diff?: ReconcileDelta): void;
}

export interface ReconcileSinks<TRow, TChange> {
  /** Streams results as they are found, materializing nothing. */
  iterator(): (previous: readonly TRow[], current: readonly TRow[]) => IterableIterator<ReconcileEvent<TRow, TChange>>;
  /** Pushes each result into a callback; no arrays and no generator frames. */
  visitor(): (previous: readonly TRow[], current: readonly TRow[], visitor: ReconcileVisitor<TRow>) => void;
}

export interface ReconcilePlan<TSchema extends ATS.AnyTypeSchema, TChannels, TChange> {
  (
    previous: readonly RowOf<TSchema>[],
    current: readonly RowOf<TSchema>[]
  ): ReconcileResult<RowOf<TSchema>, TChannels, TChange>;
  /** Names the identity when the collection declares none, or to override it. */
  by<const TKey extends RowKey<TSchema>>(key: TKey): ReconcilePlan<TSchema, TChannels, TChange>;
  /** `"diff"` attaches a structural diff to each changed pair. It runs only when equality failed. */
  changes(mode: "value"): ReconcilePlan<TSchema, TChannels, ReconcileChange<RowOf<TSchema>>>;
  changes(mode: "diff"): ReconcilePlan<TSchema, TChannels, ReconcileChangeWithDiff<RowOf<TSchema>>>;
  readonly to: ReconcileSinks<RowOf<TSchema>, TChange>;
}

/**
 * Compares two snapshots of a keyed collection in one pass over each side.
 *
 * Identity comes from the collection's own facts unless `.by()` names it.
 * Equality is the compiled `equal` for the row, so a rebuilt object with the
 * same values is unchanged rather than changed. Channels that are turned off
 * are not allocated, not appended to and — for `removed` — not even walked;
 * turning both `changed` and `unchanged` off removes the comparison itself.
 */
export function reconcile<TSchema extends ATS.AnyTypeSchema, const TChannels extends Partial<ReconcileChannels> = {}>(
  schema: SchemaInput<TSchema>,
  channels?: TChannels
): ReconcilePlan<TSchema, ResolvedChannels<TChannels>, ReconcileChange<RowOf<TSchema>>> {
  return createReconcilePlan(unwrapSchema(schema), undefined, { ...ALL_CHANNELS, ...channels }, "value") as never;
}

type AnyPlan = ReconcilePlan<ATS.AnyTypeSchema, unknown, unknown>;

function createReconcilePlan(
  schema: ATS.AnyTypeSchema,
  key: string | undefined,
  channels: ReconcileChannels,
  changes: ReconcileChanges
): AnyPlan {
  const compile = (sink: ReconcileSink) =>
    compileReconcile(schema, resolveReconcileDescriptor(schema, key, channels, changes, sink));
  // A collection with no identity fact must still accept `.by()`, so an
  // unresolvable reconciliation defers its diagnostic to the moment it is used.
  const plan = (key === undefined && !canResolve(schema) ? unresolved(schema) : compile("result")) as AnyPlan;

  Object.defineProperties(plan, {
    by: { value: (next: string) => createReconcilePlan(schema, next, channels, changes) },
    changes: { value: (mode: ReconcileChanges) => createReconcilePlan(schema, key, channels, mode) },
    to: {
      value: Object.freeze({
        iterator: () => compile("iterator"),
        visitor: () => compile("visitor"),
      }),
    },
  });
  return plan;
}

function canResolve(schema: ATS.AnyTypeSchema): boolean {
  try {
    resolveReconcileDescriptor(schema, undefined, ALL_CHANNELS, "value", "result");
    return true;
  } catch {
    return false;
  }
}

function unresolved(schema: ATS.AnyTypeSchema): AnyPlan {
  return (() => resolveReconcileDescriptor(schema, undefined, ALL_CHANNELS, "value", "result")) as unknown as AnyPlan;
}
