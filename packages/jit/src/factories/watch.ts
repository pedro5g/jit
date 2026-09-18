import { compileWatch, type Watch, type WatchOptions } from "../compiler/watch.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import {
  KeyedWatchedList,
  WatchedList,
  type WatchedListOptions,
  type WatchedListSnapshot,
  type WatchedListUpdate,
} from "../runtime/watch/index.js";

type CollectionElement<TValue> = TValue extends readonly (infer TElement)[]
  ? TElement
  : TValue extends Set<infer TElement>
    ? TElement
    : TValue extends Map<unknown, infer TElement>
      ? TElement
      : never;

/**
 * Result returned by a compiled runtime watcher.
 *
 * @template TItem - The watched collection element type.
 * @example
 * ```ts
 * const result: WatchedListResult<User> = JIT.state.watch(Users, { key: "id" })(previous, current);
 * ```
 */
export type WatchedListResult<TItem> = import("../compiler/watch.js").WatchResult<TItem>;
/**
 * Input options accepted by `JIT.state.watch(schema, options)`.
 *
 * @template TValue - The watched collection type.
 * @example
 * ```ts
 * const options: WatchInput<readonly User[]> = { key: "id" };
 * ```
 */
export type WatchInput<TValue> = WatchOptions<CollectionElement<TValue>>;
/**
 * Runtime watcher returned by `JIT.state.watch(schema, options)`.
 *
 * @template TValue - The watched collection type.
 * @param previous - The previous collection snapshot.
 * @param current - The current collection snapshot.
 * @returns Added, removed, updated, and change-summary information.
 * @example
 * ```ts
 * const changes = JIT.state.watch(Users, { key: "id" })(previous, current);
 * ```
 */
export type RuntimeWatch<TValue> = Watch<TValue>;
/** Provides the JIT type operation for the supplied input. */
export type { WatchedListOptions, WatchedListSnapshot, WatchedListUpdate };
/** Provides the JIT keyed watched list operation for the supplied input. */
export { KeyedWatchedList, WatchedList };

/**
 * Compiles a keyed collection diff function.
 *
 * The generated function compares previous/current collections by `options.key`
 * and returns DDD-style added, removed, updated, and `isChanged` information.
 *
 * @template TSchema - The collection schema type.
 * @param schema - The schema or builder the watcher runs against.
 * @param options - The key and optional change callbacks.
 * @returns A compiled runtime watcher.
 * @example
 * ```ts
 * const changes = JIT.state.watch(Users, { key: "id" });
 * changes(previous, current);
 * ```
 */
export function watch<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options: WatchInput<ATS.TypeofSchema<TSchema>>
): RuntimeWatch<ATS.TypeofSchema<TSchema>> {
  return compileWatch(unwrapSchema(schema), options);
}

/**
 * Creates a runtime watched list for aggregate child collections.
 *
 * When `options.key` is provided this returns an indexed watched list optimized
 * for O(1) identity lookups by key.
 *
 * @template TSchema - The collection schema type.
 * @param _schema - The schema or builder used only for type inference.
 * @param initialItems - The initial collection items.
 * @param options - Identity and comparison options.
 * @returns A watched list instance.
 * @example
 * ```ts
 * const list = new JIT.WatchedList([{ id: 1 }], { key: "id" });
 * list.add({ id: 2 });
 * ```
 */
export function watchedList<TSchema extends ATS.AnyTypeSchema>(
  _schema: SchemaInput<TSchema>,
  initialItems: readonly CollectionElement<ATS.TypeofSchema<TSchema>>[] = [],
  options: WatchedListOptions<CollectionElement<ATS.TypeofSchema<TSchema>>> = {}
): WatchedList<CollectionElement<ATS.TypeofSchema<TSchema>>> {
  if (options.key) {
    return new KeyedWatchedList(initialItems, {
      ...options,
      key: options.key,
    });
  }

  return new WatchedList(initialItems, options);
}
