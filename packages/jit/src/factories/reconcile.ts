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
import type { RowKey, RowOf } from "./row-types.js";

/**
 * One structural difference, as `JIT.compare.diff` reports it.
 *
 * @example
 * ```ts
 * const changes: ReconcileDelta = [{ type: "update", path: ["name"], value: "Ada" }];
 * ```
 */
export type ReconcileDelta = readonly (
  | { readonly type: "add" | "update"; readonly path: readonly PropertyKey[]; readonly value: unknown }
  | { readonly type: "remove"; readonly path: readonly PropertyKey[] }
)[];

/**
 * Before-and-after rows for one changed identity.
 *
 * @example
 * ```ts
 * const change: ReconcileChange<User> = { before: oldUser, after: newUser };
 * ```
 */
export interface ReconcileChange<TRow> {
  readonly before: TRow;
  readonly after: TRow;
}

/**
 * Before-and-after rows plus a structural diff.
 *
 * @example
 * ```ts
 * const change: ReconcileChangeWithDiff<User> = { before: oldUser, after: newUser, diff: [] };
 * ```
 */
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

/**
 * Only the channels that were asked for are present, because only they are built.
 *
 * @example
 * ```ts
 * type Channels = ResolvedChannels<{ changed: false }>;
 * ```
 */
export type ReconcileResult<TRow, TChannels, TChange> = {
  readonly [K in keyof ReconcileChannels as TChannels[K & keyof TChannels] extends false
    ? never
    : K]: K extends "changed" ? TChange[] : TRow[];
};

/**
 * One streamed reconciliation event.
 *
 * @example
 * ```ts
 * const event: ReconcileEvent<User, ReconcileChange<User>> = { type: "added", value: user };
 * ```
 */
export type ReconcileEvent<TRow, TChange> =
  | { readonly type: "added"; readonly value: TRow }
  | { readonly type: "removed"; readonly value: TRow }
  | { readonly type: "unchanged"; readonly value: TRow }
  | { readonly type: "changed"; readonly value: TChange };

/**
 * A visitor is handed each result as it is found; nothing is collected.
 *
 * @example
 * ```ts
 * const visitor: ReconcileVisitor<User> = { changed: (before, after) => console.log(before, after) };
 * ```
 */
export interface ReconcileVisitor<TRow> {
  /** Receives a row present only in the current snapshot. */
  added?(value: TRow): void;
  /** Receives a row present only in the previous snapshot. */
  removed?(value: TRow): void;
  /** Receives a row unchanged between snapshots. */
  unchanged?(value: TRow): void;
  /** Receives a row whose identity exists in both snapshots but changed. */
  changed?(before: TRow, after: TRow, diff?: ReconcileDelta): void;
}

/**
 * Allocation-aware sinks for a reconciliation plan.
 *
 * @example
 * ```ts
 * const visit = JIT.state.reconcile(Users).to.visitor();
 * visit(previous, current, visitor);
 * ```
 */
export interface ReconcileSinks<TRow, TChange> {
  /** Streams results as they are found, materializing nothing. */
  iterator(): (previous: readonly TRow[], current: readonly TRow[]) => IterableIterator<ReconcileEvent<TRow, TChange>>;
  /** Pushes each result into a callback; no arrays and no generator frames. */
  visitor(): (previous: readonly TRow[], current: readonly TRow[], visitor: ReconcileVisitor<TRow>) => void;
}

/**
 * Compiled comparison plan for two keyed collection snapshots.
 *
 * @example
 * ```ts
 * const plan = JIT.state.reconcile(Users).changes("diff");
 * const result = plan(previous, current);
 * ```
 */
export interface ReconcilePlan<TSchema extends ATS.AnyTypeSchema, TChannels, TChange> {
  /** Reconciles two snapshots and returns the enabled result channels. */
  (
    previous: readonly RowOf<TSchema>[],
    current: readonly RowOf<TSchema>[]
  ): ReconcileResult<RowOf<TSchema>, TChannels, TChange>;
  /** Names the identity when the collection declares none, or to override it. */
  by<const TKey extends RowKey<TSchema>>(key: TKey): ReconcilePlan<TSchema, TChannels, TChange>;
  /** `"diff"` attaches a structural diff to each changed pair. It runs only when equality failed. */
  /** Changes carry the before and after rows only. */
  changes(mode: "value"): ReconcilePlan<TSchema, TChannels, ReconcileChange<RowOf<TSchema>>>;
  /** Changes also carry the structural diff. */
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
 *
 * @example
 * ```ts
 * const Users = JIT.array(User).keyed("id");
 * const plan = JIT.state.reconcile(Users, { added: true, removed: true });
 * plan(previous, current);
 * ```
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
