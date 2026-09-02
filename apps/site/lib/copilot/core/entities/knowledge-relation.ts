import type { KnowledgeId } from "../value-objects/ids";

/** An edge is navigation metadata, never evidence that either endpoint is true. */
export type KnowledgeRelationKind =
  | "parent"
  | "child"
  | "reference"
  | "same-symbol"
  | "same-concept"
  | "same-route"
  | "related";

export type KnowledgeRelationSource =
  | "heading-hierarchy"
  | "route-hierarchy"
  | "mdx-link"
  | "frontmatter"
  | "shared-symbol"
  | "derived-concept";

export interface KnowledgeRelation {
  from: KnowledgeId;
  to: KnowledgeId;
  kind: KnowledgeRelationKind;
  source: KnowledgeRelationSource;
}

export interface KnowledgeNode {
  id: KnowledgeId;
  edges: KnowledgeRelation[];
}
