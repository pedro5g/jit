export const HashStrategy = {
  ordered: "ordered",
  unordered: "unordered",
  identity: "identify",
  reference: "reference",
} as const;
export type HashStrategy = keyof typeof HashStrategy;
export interface HashHint {
  strategy?: HashStrategy;
}
