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

export type WatchedListResult<TItem> = import("../compiler/watch.js").WatchResult<TItem>;
export type WatchInput<TValue> = WatchOptions<CollectionElement<TValue>>;
export type RuntimeWatch<TValue> = Watch<TValue>;
export type { WatchedListOptions, WatchedListSnapshot, WatchedListUpdate };
export { KeyedWatchedList, WatchedList };

/**
 * Compiles a keyed collection diff function.
 *
 * The generated function compares previous/current collections by `options.key`
 * and returns DDD-style added, removed, updated, and `isChanged` information.
 */
export function watch<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>,
  options: WatchInput<ATS.InferSchema<TSchema>>
): RuntimeWatch<ATS.InferSchema<TSchema>> {
  return compileWatch(unwrapSchema(schema), options);
}

/**
 * Creates a runtime watched list for aggregate child collections.
 *
 * When `options.key` is provided this returns an indexed watched list optimized
 * for O(1) identity lookups by key.
 */
export function watchedList<TSchema extends ATS.AnyTypeSchema>(
  _schema: SchemaInput<TSchema>,
  initialItems: readonly CollectionElement<ATS.InferSchema<TSchema>>[] = [],
  options: WatchedListOptions<CollectionElement<ATS.InferSchema<TSchema>>> = {}
): WatchedList<CollectionElement<ATS.InferSchema<TSchema>>> {
  if (options.key) {
    return new KeyedWatchedList(initialItems, {
      ...options,
      key: options.key,
    });
  }

  return new WatchedList(initialItems, options);
}
