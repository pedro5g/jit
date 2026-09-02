import type { FacetId, KnowledgeId } from "../value-objects/ids";
import type { KnowledgeFacet } from "./knowledge-entry";
import type { KnowledgeRelationKind } from "./knowledge-relation";
import type { RetrievalResult } from "./retrieval";

export type QuestionScope = "lookup" | "focused" | "broad";
export type AnswerMode = "lookup" | "explain" | "deep-explain" | "navigate" | "code";

export interface ExpandedKnowledgeCandidate {
  knowledgeId: KnowledgeId;
  from: KnowledgeId;
  relation: KnowledgeRelationKind;
  depth: number;
  seedScore: number;
  relevance: number;
}

export interface ExpansionResult {
  seeds: KnowledgeId[];
  candidates: ExpandedKnowledgeCandidate[];
  visited: number;
  elapsedMs: number;
}

export interface CoverageCandidate {
  result: RetrievalResult;
  facets: KnowledgeFacet[];
  relevance: number;
  expanded?: ExpandedKnowledgeCandidate;
}

export interface CoverageFacet {
  id: FacetId;
  label: string;
  source: KnowledgeFacet["source"];
  importance: number;
  candidateCount: number;
}

export interface GenerationReadiness {
  sufficient: boolean;
  coverage: number;
  evidenceCount: number;
  sourceConfidence: number;
}

export interface CoveragePlan {
  scope: QuestionScope;
  answerMode: AnswerMode;
  seeds: KnowledgeId[];
  expansion: ExpansionResult;
  candidates: CoverageCandidate[];
  facets: CoverageFacet[];
  selected: RetrievalResult[];
  selectedFacetIds: FacetId[];
  coverageScore: number;
  redundancyDropped: number;
  readiness: GenerationReadiness;
}
