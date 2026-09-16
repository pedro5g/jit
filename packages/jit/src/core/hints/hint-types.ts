import type { Compare, Configurable, PropertySelector } from "./shared.js";

export interface EntityHint<T = unknown> {
  readonly type?: "entity";
  readonly key: Configurable<PropertySelector<T>>;
  readonly immutable?: boolean;
  readonly cacheIndex?: boolean;
}

export interface IndexHint {
  readonly type?: "index";
  readonly key: string;
}

export interface OrderHint<T = unknown> {
  readonly type?: "order";
  readonly key?: string;
  readonly direction?: Configurable<"asc" | "desc">;
  readonly strategy?: Configurable<"locale" | "natural" | "custom">;
  readonly comparer?: Compare<T>;
}

export interface HashHint {
  readonly type?: "hash";
  readonly strategy?: "ordered" | "unordered" | "identity" | "reference";
}
