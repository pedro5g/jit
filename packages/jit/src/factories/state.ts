import { patch } from "./patch.js";
import { reconcile } from "./reconcile.js";
import { update } from "./update.js";
import { watch, watchedList } from "./watch.js";

/**
 * Operations that describe immutable state evolution.
 *
 * Collection mutation and derived computation join this namespace only when
 * their reconstructive runtime/define/AOT artifacts exist.
 */
export const state = Object.freeze({
  update,
  patch,
  reconcile,
  watch,
  watchedList,
});
