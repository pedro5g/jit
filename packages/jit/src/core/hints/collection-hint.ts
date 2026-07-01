import type { OrderHint } from "./order-hint.js";
import type { Configurable } from "./shared.js";

export interface CollectionHint<T> {
  identify?: Configurable<PropertyKey>;
  unique?: Configurable<boolean>;
  indexed?: Configurable<boolean>;
  searchable?: Configurable<boolean>;
  ordered?: OrderHint<T>;
}
