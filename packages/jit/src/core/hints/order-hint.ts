import type { Compare, Configurable } from "./shared.js";

export type { OrderHint } from "./hint-types.js";

export const OrderDirection = {
  asc: "asc",
  desc: "desc",
} as const;
export type OrderDirection = keyof typeof OrderDirection;
export const OrderStrategy = {
  locale: "locale",
  natural: "natural",
  custom: "custom",
} as const;
export type OrderStrategy = keyof typeof OrderStrategy;
export type OrderHintShape<T> = {
  direction?: Configurable<OrderDirection>;
  strategy?: Configurable<OrderStrategy>;
  comparer?: Compare<T>;
};
