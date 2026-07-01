import type { CloneHint } from "./clone-hint.js";
import type { CollectionHint } from "./collection-hint.js";
import type { CompareHint } from "./compare-hint.js";
import type { DiffHint } from "./diff-hint.js";
import type { EntityHint } from "./entity-hint.js";
import type { HashHint } from "./hash-hint.js";
import type { SerializeHint } from "./serialize-hint.js";

export interface CompileHints<T = unknown> {
  entity?: EntityHint<T>;
  collection?: CollectionHint<T>;
  compare?: CompareHint;
  clone?: CloneHint;
  hash?: HashHint;
  diff?: DiffHint;
  serialize?: SerializeHint;
}
