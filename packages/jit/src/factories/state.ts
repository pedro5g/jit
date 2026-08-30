import { collection } from "./collection-state.js";
import { derive } from "./derive.js";
import { patch } from "./patch.js";
import { reconcile } from "./reconcile.js";
import { update } from "./update.js";
import { watch } from "./watch.js";

/** Operations that describe immutable state evolution. */
export const state = Object.freeze({
  update,
  patch,
  collection,
  derive,
  reconcile,
  watch,
});
