const DiffStrategy = {
  patch: "patch",
  replace: "replace",
  entity: "entity",
} as const;
type DiffStrategy = keyof typeof DiffStrategy;
export interface DiffHint {
  strategy?: DiffStrategy;
}
