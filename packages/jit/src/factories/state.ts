import { collection } from "./collection-state.js";
import { derive } from "./derive.js";
import { patch } from "./patch.js";
import { reconcile } from "./reconcile.js";
import { update } from "./update.js";
import { watch } from "./watch.js";

/**
 * Operations that describe immutable state evolution.
 *
 * @example
 * ```ts
 * const User = JIT.object({ id: JIT.number(), name: JIT.string() });
 * const rename = JIT.state.update(User).patch({ name: "Ada" }).compile();
 * rename({ id: 1, name: "Grace" }, {}); // { id: 1, name: "Ada" }
 * ```
 */
export const state = Object.freeze({
  update,
  patch,
  collection,
  derive,
  reconcile,
  watch,
});
