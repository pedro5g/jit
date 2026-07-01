import type { Configurable, PropertySelector } from "./shared.js";

export interface EntityHint<T> {
  key: Configurable<PropertySelector<T>>;
  immutable?: boolean;
  cacheIndex?: boolean;
}
