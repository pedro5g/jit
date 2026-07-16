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
 */
export type WatchedListResult<TItem> = import("../compiler/watch.js").WatchResult<TItem>;
/**
 * Input options accepted by `JIT.watch(schema, options)`.
 *
 * @template TValue - The watched collection type.
 */
export type WatchInput<TValue> = WatchOptions<CollectionElement<TValue>>;
/**
 * Runtime watcher returned by `JIT.watch(schema, options)`.
 *
 * @template TValue - The watched collection type.
 * @param previous - The previous collection snapshot.
 * @param current - The current collection snapshot.
 * @returns Added, removed, updated, and change-summary information.
 */
export type RuntimeWatch<TValue> = Watch<TValue>;
export type { WatchedListOptions, WatchedListSnapshot, WatchedListUpdate };
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
