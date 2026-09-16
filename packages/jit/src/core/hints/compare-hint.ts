const CompareHash = {
  deep: "deep",
  shallow: "shallow",
  reference: "reference",
  identify: "identify",
} as const;
type CompareMode = keyof typeof CompareHash;
export interface CompareHint {
  mode?: CompareMode;
}
