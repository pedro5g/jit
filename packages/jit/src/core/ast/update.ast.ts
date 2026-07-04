export type Path = readonly (string | number)[];

export interface UpdateSetNode {
  readonly kind: "set";
  readonly path: Path;
  readonly value: unknown;
}

export type UpdateNode = UpdateSetNode;
