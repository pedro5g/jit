import { collection } from "./collection-state.js";
import { patch } from "./patch.js";
import { reconcile } from "./reconcile.js";
import { update } from "./update.js";
import { watch, watchedList } from "./watch.js";

/**
 * Operations that describe immutable state evolution.
 *
 * Derived computation joins this namespace only when its reconstructive
 * runtime/define/AOT artifacts exist.
 */
export const state = Object.freeze({
  update,
  patch,
  collection,
  reconcile,
  watch,
  watchedList,
});
