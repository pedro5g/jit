/**
 * Deterministic perfect evidence for the capability experiment.
 *
 * This belongs to eval, not the application graph. It starts at the locator
 * already declared by an explanation case and follows only structural edges
 * that a documentation compiler can prove: the exact section, its parent or
 * child, and explicit references. Retrieval scores, embeddings, symbols and
 * semantic expansion are deliberately absent from this module.
 */

import { estimateTokens } from "../application/context/token-budget.js";
import type { DocumentChunk } from "../core/entities/document-chunk.js";
import type { KnowledgeEntry, KnowledgeFacet } from "../core/entities/knowledge-entry.js";
import type { KnowledgeRelationKind } from "../core/entities/knowledge-relation.js";
import type { ChunkRepository, KnowledgeGraphRepository, KnowledgeRepository } from "../core/repositories/index.js";
import type { ChunkId, FacetId, KnowledgeId, RouteId } from "../core/value-objects/ids.js";
import type { Locale } from "../core/value-objects/locale.js";
import type { EvalCase } from "./types.js";

export const ORACLE_CONTEXT_VERSION = 1;
export const ORACLE_MAX_EVIDENCE_TOKENS = 1600;

export type OracleFacetPriority = "core" | "supporting" | "optional";
export type OracleEvidenceRelation = "canonical" | "parent" | "child" | "reference";

export interface OracleEvidence {
  knowledgeId: KnowledgeId;
  chunkId: ChunkId;
  routeId: RouteId;
  anchor?: string;
  breadcrumb: string;
  title: string;
  content: string;
  facets: KnowledgeFacet[];
  relation: OracleEvidenceRelation;
  priority: OracleFacetPriority;
  tokens: number;
  sourceFile: string;
  showsRemovedApis: boolean;
}

export interface OracleFacet {
  id: FacetId;
  label: string;
  priority: OracleFacetPriority;
}

export interface OracleContext {
  question: string;
  locale: Locale;
  routeId: RouteId;
  anchor?: string;
  evidence: OracleEvidence[];
  facets: FacetId[];
  facetPriorities: OracleFacet[];
  evidenceTokens: number;
  evidenceLimit: number;
  overBudget: boolean;
}

interface CandidateEntry {
  entry: KnowledgeEntry;
  relation: OracleEvidenceRelation;
  priority: OracleFacetPriority;
}

const STRUCTURAL_RELATIONS = new Set<KnowledgeRelationKind>(["parent", "child", "reference"]);
const FACET_SOURCES = new Set<KnowledgeFacet["source"]>(["heading", "concept"]);
const PRIORITY_RANK: Record<OracleFacetPriority, number> = { core: 0, supporting: 1, optional: 2 };

export interface OracleContextBuilderDeps {
  knowledge: KnowledgeRepository;
  graph: KnowledgeGraphRepository;
  chunks: ChunkRepository;
  maxEvidenceTokens?: number;
}

export class OracleContextBuilder {
  private readonly maxEvidenceTokens: number;

  constructor(private readonly deps: OracleContextBuilderDeps) {
    this.maxEvidenceTokens = deps.maxEvidenceTokens ?? ORACLE_MAX_EVIDENCE_TOKENS;
  }

  build(request: { case: EvalCase }): OracleContext {
    const routeId = request.case.expected.routes?.[0] ?? request.case.expected.best;
    if (!routeId) throw new Error(`capability case has no expected route: ${request.case.question}`);

    const canonical = this.canonicalEntries(routeId, request.case.expected.anchor);
    if (canonical.length === 0) {
      throw new Error(
        `capability oracle locator resolved no knowledge entry: ${routeId}${request.case.expected.anchor ? `#${request.case.expected.anchor}` : ""}`
      );
    }

    const candidates: CandidateEntry[] = canonical.map((entry) => ({ entry, relation: "canonical", priority: "core" }));
    const seen = new Set(canonical.map((entry) => entry.id));
    const relatedCandidates = new Map<KnowledgeId, CandidateEntry>();

    for (const entry of canonical) {
      for (const edge of this.deps.graph
        .neighbours(entry.id)
        .filter((relation) => STRUCTURAL_RELATIONS.has(relation.kind))
        .sort((left, right) => left.kind.localeCompare(right.kind) || left.to.localeCompare(right.to))) {
        const related = this.deps.knowledge.findById(edge.to);
        if (!related || seen.has(related.id)) continue;
        const relation = edge.kind as "parent" | "child" | "reference";
        const candidate: CandidateEntry = {
          entry: related,
          relation,
          priority: relation === "reference" ? "optional" : "supporting",
        };
        const current = relatedCandidates.get(related.id);
        if (
          !current ||
          PRIORITY_RANK[candidate.priority] < PRIORITY_RANK[current.priority] ||
          (candidate.priority === current.priority && candidate.relation.localeCompare(current.relation) < 0)
        ) {
          relatedCandidates.set(related.id, candidate);
        }
      }
    }
    candidates.push(...relatedCandidates.values());

    const evidence: OracleEvidence[] = [];
    let evidenceTokens = 0;
    let dropped = 0;

    for (const candidate of candidates.sort(compareCandidates)) {
      const chunks = this.deps.chunks.byKnowledgeId(candidate.entry.id);
      if (chunks.length === 0) continue;
      const candidateEvidence = chunks.map((chunk) => this.toEvidence(chunk, candidate));
      const candidateTokens = candidateEvidence.reduce((sum, item) => sum + item.tokens, 0);
      const mustKeep = candidate.priority === "core";

      if (!mustKeep && evidence.length > 0 && evidenceTokens + candidateTokens > this.maxEvidenceTokens) {
        dropped += candidateEvidence.length;
        continue;
      }

      evidence.push(...candidateEvidence);
      evidenceTokens += candidateTokens;
    }

    const facets = new Map<FacetId, OracleFacet>();
    for (const item of evidence) {
      for (const facet of item.facets.filter((value) => FACET_SOURCES.has(value.source))) {
        const current = facets.get(facet.id);
        if (!current || PRIORITY_RANK[item.priority] < PRIORITY_RANK[current.priority]) {
          facets.set(facet.id, { id: facet.id, label: facet.label, priority: item.priority });
        }
      }
    }

    const facetPriorities = [...facets.values()].sort(
      (left, right) => PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] || left.id.localeCompare(right.id)
    );

    return {
      question: request.case.question,
      locale: request.case.locale,
      routeId,
      ...(request.case.expected.anchor ? { anchor: request.case.expected.anchor } : {}),
      evidence,
      facets: facetPriorities.map((facet) => facet.id),
      facetPriorities,
      evidenceTokens,
      evidenceLimit: this.maxEvidenceTokens,
      overBudget: evidenceTokens > this.maxEvidenceTokens || dropped > 0,
    };
  }

  private canonicalEntries(routeId: RouteId, anchor?: string): KnowledgeEntry[] {
    const exact = this.deps.knowledge
      .all()
      .filter((entry) => entry.routeId === routeId && (anchor ? entry.anchor === anchor : entry.anchor === undefined))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (exact.length > 0) return exact;

    // A page without an intro entry is still a valid route locator. The
    // deterministic fallback keeps the first canonical section rather than
    // silently consulting retrieval.
    return this.deps.knowledge
      .all()
      .filter((entry) => entry.routeId === routeId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, 1);
  }

  private toEvidence(chunk: DocumentChunk, candidate: CandidateEntry): OracleEvidence {
    const evidence: OracleEvidence = {
      knowledgeId: chunk.knowledgeId,
      chunkId: chunk.id,
      routeId: chunk.routeId,
      ...(chunk.anchor ? { anchor: chunk.anchor } : {}),
      breadcrumb: chunk.breadcrumb,
      title: chunk.title,
      content: chunk.content,
      facets: candidate.entry.facets,
      relation: candidate.relation,
      priority: candidate.priority,
      tokens: 0,
      sourceFile: candidate.entry.source.file,
      showsRemovedApis: chunk.showsRemovedApis,
    };
    evidence.tokens = estimateTokens(`${evidence.breadcrumb} ${evidence.title}\n${evidence.content}`);
    return evidence;
  }
}

function compareCandidates(left: CandidateEntry, right: CandidateEntry): number {
  return PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] || left.entry.id.localeCompare(right.entry.id);
}
