import type { CoverageCandidate, CoverageFacet, CoveragePlan, ExpansionResult } from "../../core/entities/coverage";
import type { KnowledgeFacet } from "../../core/entities/knowledge-entry";
import type { RetrievalReport, RetrievalResult } from "../../core/entities/retrieval";
import type { ChunkRepository, KnowledgeRepository } from "../../core/repositories";
import type { FacetId, KnowledgeId } from "../../core/value-objects/ids";
import { overlap } from "../context/stages";
import { estimateTokens } from "../context/token-budget";
import { queryConcepts, tokenize } from "../retrieval/tokenizer";
import { classifyQuestion } from "./question-classifier";

export interface CoverageRequest {
  question: string;
  report: RetrievalReport;
  expansion: ExpansionResult;
  maxEvidence?: number;
}

export class CoveragePlanner {
  constructor(private readonly deps: { knowledge: KnowledgeRepository; chunks: ChunkRepository }) {}

  plan(request: CoverageRequest): CoveragePlan {
    const classification = classifyQuestion(request.question, request.report);
    const candidates = this.candidates(request, classification.scope);
    const seedCandidates = candidates.filter((candidate) => !candidate.expanded);
    const includeSymbols = (request.report.explicitSymbols?.length ?? request.report.exactSymbols.length) > 0;
    // Focused and lookup tasks should not let an expanded neighbour redefine
    // what counts as important. Broad tasks deliberately discover facets over
    // the full pool; narrow tasks use the direct retrieval set as their
    // evidence contract.
    const facetCandidates = classification.scope === "broad" ? candidates : seedCandidates;
    const facets = this.rankFacets(request.question, facetCandidates, includeSymbols);
    const important = facets
      .filter((facet) => facet.source === "concept" || facet.candidateCount <= 2)
      .slice(0, classification.scope === "broad" ? 12 : 4);
    const limit = request.maxEvidence ?? 8;
    const selected = this.select(candidates, important, classification.scope, limit);
    const seedFacets = this.rankFacets(request.question, seedCandidates, includeSymbols);
    const seedImportant = seedFacets
      .filter((facet) => facet.source === "concept" || facet.candidateCount <= 2)
      .slice(0, classification.scope === "broad" ? 12 : 4);
    const baseline = this.select(seedCandidates, seedImportant, classification.scope, limit);
    const combined = mergeCandidates(baseline.kept, selected.kept, limit);
    const selectedFacetIds = new Set<FacetId>();
    for (const candidate of combined) {
      for (const facet of candidate.facets) {
        if (facet.source !== "kind" && facet.source !== "route") selectedFacetIds.add(facet.id);
      }
    }

    const coveredImportant = important.filter((facet) => selectedFacetIds.has(facet.id)).length;
    const coverage = important.length === 0 ? (combined.length > 0 ? 1 : 0) : coveredImportant / important.length;
    const relevance = average(combined.map((candidate) => candidate.relevance));
    const sourceConfidence = average(
      combined.map((candidate) => sourceWeight(this.deps.knowledge.findById(candidate.result.chunk.knowledgeId)?.kind))
    );
    const redundancyDropped = selected.redundancyDropped + baseline.redundancyDropped;
    const redundancyPenalty = candidates.length === 0 ? 0 : redundancyDropped / candidates.length;
    const coverageScore = roundUnit(
      coverage * 0.55 + relevance * 0.25 + sourceConfidence * 0.2 - redundancyPenalty * 0.15
    );
    const requiredEvidence = classification.scope === "broad" ? 3 : 1;
    const requiredCoverage = classification.scope === "broad" ? 0.5 : 0.25;

    return {
      scope: classification.scope,
      answerMode: classification.answerMode,
      seeds: request.expansion.seeds,
      expansion: request.expansion,
      candidates,
      facets,
      selected: combined.map((candidate) => candidate.result),
      selectedFacetIds: [...selectedFacetIds],
      coverageScore,
      redundancyDropped,
      readiness: {
        sufficient:
          request.report.coverage.covered &&
          combined.length >= requiredEvidence &&
          coverage >= requiredCoverage &&
          sourceConfidence >= 0.45,
        coverage: roundUnit(coverage),
        evidenceCount: combined.length,
        sourceConfidence: roundUnit(sourceConfidence),
      },
    };
  }

  private candidates(request: CoverageRequest, scope: CoveragePlan["scope"]): CoverageCandidate[] {
    const byEntry = new Map<KnowledgeId, CoverageCandidate>();
    const best = request.report.results[0]?.finalScore ?? 1;

    for (const result of request.report.results) {
      const entry = this.deps.knowledge.findById(result.chunk.knowledgeId);
      if (!entry || byEntry.has(entry.id)) continue;
      const chunk = this.chunkFor(entry.id, result.chunk, scope);
      if (!chunk) continue;
      byEntry.set(entry.id, {
        result: chunk === result.chunk ? result : { ...result, chunk },
        facets: entry.facets,
        relevance: round(result.finalScore / best),
      });
    }

    for (const expanded of request.expansion.candidates) {
      if (byEntry.has(expanded.knowledgeId)) continue;
      const entry = this.deps.knowledge.findById(expanded.knowledgeId);
      const chunk = this.chunkFor(expanded.knowledgeId, undefined, scope);
      if (!entry || !chunk) continue;
      const result: RetrievalResult = {
        chunk,
        scores: {},
        finalScore: best * Math.max(0.2, expanded.relevance),
        reason: "hybrid",
      };
      byEntry.set(entry.id, { result, facets: entry.facets, relevance: expanded.relevance, expanded });
    }

    return [...byEntry.values()].sort(
      (left, right) => right.relevance - left.relevance || left.result.chunk.id.localeCompare(right.result.chunk.id)
    );
  }

  /**
   * A broad explanation needs the informative section of a knowledge entry,
   * not necessarily the first chunk that happened to win retrieval. Entries
   * are split for indexing, and the opening chunk of a concept page is often
   * only its thesis while the next chunk contains the documented mechanisms.
   * Choosing the longest source chunk is deterministic and keeps the unit of
   * provenance intact; focused/API questions retain the retrieval winner.
   */
  private chunkFor(
    knowledgeId: KnowledgeId,
    preferred: RetrievalResult["chunk"] | undefined,
    scope: CoveragePlan["scope"]
  ): RetrievalResult["chunk"] | undefined {
    const chunks = this.deps.chunks.byKnowledgeId(knowledgeId);
    if (chunks.length === 0) return preferred;
    if (scope !== "broad") return preferred ?? chunks[0];
    return chunks
      .slice()
      .sort(
        (left, right) =>
          right.content.length - left.content.length || left.part - right.part || left.id.localeCompare(right.id)
      )[0];
  }

  private rankFacets(
    question: string,
    candidates: readonly CoverageCandidate[],
    includeSymbols: boolean
  ): CoverageFacet[] {
    const concepts = queryConcepts(question);
    const scored = new Map<FacetId, CoverageFacet>();

    for (const candidate of candidates) {
      for (const facet of candidate.facets) {
        if (facet.source === "kind" || facet.source === "route" || (!includeSymbols && facet.source === "symbol"))
          continue;
        const current = scored.get(facet.id) ?? {
          id: facet.id,
          label: facet.label,
          source: facet.source,
          importance: 0,
          candidateCount: 0,
        };
        current.candidateCount += 1;
        current.importance = Math.max(
          current.importance,
          candidate.relevance * facetWeight(facet) + (matches(concepts, facet.label) ? 0.6 : 0)
        );
        scored.set(facet.id, current);
      }
    }

    return [...scored.values()]
      .map((facet) => ({ ...facet, importance: round(facet.importance + Math.min(0.2, facet.candidateCount * 0.025)) }))
      .sort(
        (left, right) =>
          facetSourceRank(left.source) - facetSourceRank(right.source) ||
          right.importance - left.importance ||
          left.id.localeCompare(right.id)
      );
  }

  private select(
    candidates: readonly CoverageCandidate[],
    important: readonly CoverageFacet[],
    scope: CoveragePlan["scope"],
    limit: number
  ): { kept: CoverageCandidate[]; redundancyDropped: number } {
    if (scope !== "broad") return { kept: candidates.slice(0, limit), redundancyDropped: 0 };

    const first = candidates[0];
    const remaining = candidates.slice(1);
    const kept: CoverageCandidate[] = first ? [first] : [];
    const covered = new Set<FacetId>();
    const tokenSets: Set<string>[] = first ? [new Set(tokenize(first.result.chunk.content))] : [];
    let redundancyDropped = 0;

    if (first) for (const facet of first.facets) covered.add(facet.id);

    while (remaining.length > 0 && kept.length < limit) {
      if (kept.length >= 3 && important.every((facet) => covered.has(facet.id))) break;
      let winner = -1;
      let winnerUtility = -Infinity;

      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index];
        const tokens = new Set(tokenize(candidate.result.chunk.content));
        const redundancy = tokenSets.reduce((highest, previous) => Math.max(highest, overlap(tokens, previous)), 0);
        const newFacetValue = candidate.facets.reduce((sum, facet) => {
          if (covered.has(facet.id)) return sum;
          return sum + (important.find((item) => item.id === facet.id)?.importance ?? 0);
        }, 0);
        const tokenCost = Math.max(1, estimateTokens(candidate.result.chunk.content));
        const entry = this.deps.knowledge.findById(candidate.result.chunk.knowledgeId);
        const relationBonus = candidate.expanded
          ? candidate.expanded.relation === "reference" || candidate.expanded.relation === "related"
            ? 0.25
            : candidate.expanded.relation === "parent" || candidate.expanded.relation === "child"
              ? 0.15
              : 0.05
          : 0;
        const explanatoryBonus = entry?.kind === "concept" || entry?.kind === "overview" ? 0.15 : 0;
        const utility =
          candidate.relevance * 0.45 +
          newFacetValue * 0.45 +
          (1 - redundancy) * 0.1 +
          relationBonus +
          explanatoryBonus -
          tokenCost / 20_000;
        if (utility > winnerUtility) {
          winner = index;
          winnerUtility = utility;
        }
      }

      const [candidate] = remaining.splice(winner, 1);
      const tokens = new Set(tokenize(candidate.result.chunk.content));
      if (tokenSets.some((previous) => overlap(tokens, previous) > 0.72)) {
        redundancyDropped += 1;
        continue;
      }
      kept.push(candidate);
      tokenSets.push(tokens);
      for (const facet of candidate.facets) covered.add(facet.id);
    }

    return { kept, redundancyDropped };
  }
}

function matches(concepts: ReturnType<typeof queryConcepts>, label: string): boolean {
  const tokens = new Set(tokenize(label));
  return concepts.some((concept) => concept.variants.some((variant) => tokens.has(variant)));
}

function facetWeight(facet: KnowledgeFacet): number {
  if (facet.source === "concept") return 1.1;
  if (facet.source === "heading") return 1;
  if (facet.source === "symbol") return 0.8;
  if (facet.source === "page") return 0.65;
  return 0.4;
}

function facetSourceRank(source: KnowledgeFacet["source"]): number {
  if (source === "concept") return 0;
  if (source === "heading") return 1;
  if (source === "page") return 2;
  if (source === "symbol") return 3;
  return 4;
}

function sourceWeight(kind: string | undefined): number {
  if (kind === "concept" || kind === "reference" || kind === "overview") return 1;
  if (kind === "guide" || kind === "example") return 0.8;
  if (kind === "history" || kind === "migration") return 0.35;
  return 0.6;
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mergeCandidates(
  baseline: readonly CoverageCandidate[],
  expanded: readonly CoverageCandidate[],
  limit: number
): CoverageCandidate[] {
  const merged: CoverageCandidate[] = [];
  const seen = new Set<KnowledgeId>();
  // Seed selection is a quality floor. Expansion may add a facet, but it must
  // not silently replace a direct hit with a neighbour that only scored well
  // because it is related. Keeping this invariant makes the before/after eval
  // meaningful: graph expansion can improve coverage, never manufacture it by
  // deleting the evidence the seed-only plan already had.
  for (const candidate of baseline.slice(0, limit)) {
    const id = candidate.result.chunk.knowledgeId;
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(candidate);
  }
  for (const candidate of expanded.filter((item) => item.expanded)) {
    const id = candidate.result.chunk.knowledgeId;
    if (seen.has(id)) continue;

    const before = facetIds(merged);
    const addsFacet = [...facetIds([candidate])].some((facet) => !before.has(facet));
    if (!addsFacet) continue;

    if (merged.length < limit) {
      seen.add(id);
      merged.push(candidate);
      continue;
    }

    const replacement = merged.findIndex((current, index) => {
      const remaining = merged.filter((_, candidateIndex) => candidateIndex !== index);
      const after = facetIds(remaining);
      return [...facetIds([current])].every((facet) => after.has(facet) || isStructuralFacet(facet));
    });
    if (replacement < 0) continue;

    seen.delete(merged[replacement].result.chunk.knowledgeId);
    seen.add(id);
    merged[replacement] = candidate;
  }
  return merged;
}

function facetIds(candidates: readonly CoverageCandidate[]): Set<FacetId> {
  const ids = new Set<FacetId>();
  for (const candidate of candidates) {
    for (const facet of candidate.facets) {
      if (!isStructuralFacet(facet.id)) ids.add(facet.id);
    }
  }
  return ids;
}

function isStructuralFacet(id: FacetId): boolean {
  return id.startsWith("facet.kind.") || id.startsWith("facet.route.");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundUnit(value: number): number {
  return round(Math.max(0, Math.min(1, value)));
}
