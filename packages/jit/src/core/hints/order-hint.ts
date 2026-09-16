export type { OrderHint } from "./hint-types.js";

export const OrderDirection = {
  asc: "asc",
  desc: "desc",
} as const;
export type OrderDirection = keyof typeof OrderDirection;
