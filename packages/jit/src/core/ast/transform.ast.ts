export interface TransformFieldNode {
  readonly kind: "transform:field";
  readonly key: string;
  readonly binding: string;
}

export interface TransformObjectNode {
  readonly kind: "transform:object";
  readonly fields: readonly TransformFieldNode[];
}

export type TransformNode = TransformObjectNode;
