/** Describes the JIT path contract used by the public API. */
export type Path = readonly (string | number)[];

/** Describes the JIT update set node contract used by the public API. */
export interface UpdateSetNode {
  readonly kind: "set";
  readonly path: Path;
  readonly value: unknown;
}

/** Describes the JIT update node contract used by the public API. */
export type UpdateNode = UpdateSetNode;
