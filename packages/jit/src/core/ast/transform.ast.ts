/** Describes the JIT transform field node contract used by the public API. */
export interface TransformFieldNode {
  readonly kind: "transform:field";
  readonly key: string;
  readonly binding: string;
}

/** Describes the JIT transform object node contract used by the public API. */
export interface TransformObjectNode {
  readonly kind: "transform:object";
  readonly fields: readonly TransformFieldNode[];
}

/** Describes the JIT transform node contract used by the public API. */
export type TransformNode = TransformObjectNode;
