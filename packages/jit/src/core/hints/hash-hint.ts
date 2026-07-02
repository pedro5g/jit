export const HashStrategy = {
  ordered: "ordered",
  unordered: "unordered",
  identity: "identify",
  reference: "reference",
} as const;
export type HashStrategy = keyof typeof HashStrategy;
export type { HashHint } from "./hint-types.js";
