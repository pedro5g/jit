import type { ExpandedKnowledgeCandidate, ExpansionResult } from "../../core/entities/coverage";
import type { KnowledgeRelation, KnowledgeRelationKind } from "../../core/entities/knowledge-relation";
import type { RetrievalResult } from "../../core/entities/retrieval";
import type { ChunkRepository, KnowledgeGraphRepository, KnowledgeRepository } from "../../core/repositories";
import type { KnowledgeId } from "../../core/value-objects/ids";
import type { Locale } from "../../core/value-objects/locale";
import { queryConcepts, tokenize } from "../retrieval/tokenizer";

export interface ExpansionRequest {
  question: string;
  seeds: RetrievalResult[];
  locale: Locale;
  maxDepth: number;
  maxCandidates: number;
}

export interface KnowledgeExpansionDeps {
  graph: KnowledgeGraphRepository;
  knowledge: KnowledgeRepository;
  chunks: ChunkRepository;
}

interface FrontierItem {
  id: KnowledgeId;
  depth: number;
  seedScore: number;
  priority: number;
}

interface EdgeProposal {
  edge: KnowledgeRelation;
  score: number;
  relation: (typeof RELATION_CONFIDENCE)[KnowledgeRelationKind];
}

const RELATION_CONFIDENCE = {
  reference: 1,
  "same-symbol": 0.95,
  parent: 0.9,
  child: 0.85,
  related: 0.8,
  "same-concept": 0.75,
  "same-route": 0.65,
} as const;

export class KnowledgeExpansionService {
  constructor(private readonly deps: KnowledgeExpansionDeps) {}

  expand(request: ExpansionRequest): ExpansionResult {
    const started = performance.now();
    const seeds = uniqueSeeds(request.seeds).slice(0, 5);
    const best = Math.max(seeds[0]?.finalScore ?? 1, Number.EPSILON);
    const visited = new Set<KnowledgeId>(seeds.map((seed) => seed.chunk.knowledgeId));
    let frontier: FrontierItem[] = seeds.map((seed) => ({
      id: seed.chunk.knowledgeId,
      depth: 0,
      seedScore: seed.finalScore / best,
      priority: seed.finalScore / best,
    }));
    const candidates: ExpandedKnowledgeCandidate[] = [];
    const query = queryConcepts(request.question);

    while (frontier.length > 0 && candidates.length < request.maxCandidates) {
      const next: FrontierItem[] = [];
      const remainingBudget = request.maxCandidates - candidates.length;
      const stageBudget =
        frontier[0]?.depth === 0 && request.maxDepth > 1
          ? Math.min(remainingBudget, Math.ceil(request.maxCandidates * 0.7))
          : remainingBudget;
      const perNode = Math.max(1, Math.floor(stageBudget / Math.max(1, frontier.length)));
      const proposals = frontier.map((item) => {
        const depth = item.depth + 1;
        if (depth > request.maxDepth) return { item, depth, edges: [] as EdgeProposal[] };
        return {
          item,
          depth,
          edges: this.deps.graph
            .neighbours(item.id)
            .filter((edge) => !visited.has(edge.to))
            .map((edge) => {
              const entry = this.deps.knowledge.findById(edge.to);
              if (!entry) return null;

              // Expansion is over the compiled corpus, not a translation
              // lookup. A Portuguese question may legitimately expand English
              // source entries; locale never changes the graph's identity.
              // Expansion ranks neighbourhood metadata, not full passages.
              // Reading and tokenizing every document behind a high-degree
              // shared-symbol edge made a bounded traversal proportional to
              // the size of the corpus. The selected chunk remains the only
              // text sent to the model later in the pipeline.
              const lexical = relevance(
                query,
                `${entry.breadcrumb} ${entry.title} ${entry.facets.map((facet) => facet.label).join(" ")}`
              );
              const relation = RELATION_CONFIDENCE[edge.kind];
              const score = lexical * 0.6 + (item.seedScore * relation * 0.4) / depth;
              return { edge, score, relation };
            })
            .filter((proposal): proposal is EdgeProposal => proposal !== null)
            .sort(
              (left, right) =>
                right.score - left.score || right.relation - left.relation || left.edge.to.localeCompare(right.edge.to)
            ),
        };
      });

      // Round-robin keeps one highly connected seed from consuming the whole
      // budget. Ranking each node's edges before the rounds makes expansion
      // deterministic without taking a greedy single path.
      for (let round = 0; round < perNode && candidates.length < request.maxCandidates; round += 1) {
        for (const proposal of proposals) {
          const candidate = proposal.edges[round];
          if (!candidate || visited.has(candidate.edge.to)) continue;
          visited.add(candidate.edge.to);

          candidates.push({
            knowledgeId: candidate.edge.to,
            from: proposal.item.id,
            relation: candidate.edge.kind,
            depth: proposal.depth,
            seedScore: roundValue(proposal.item.seedScore),
            relevance: roundValue(candidate.score),
          });
          next.push({
            id: candidate.edge.to,
            depth: proposal.depth,
            seedScore: proposal.item.seedScore * candidate.relation,
            priority: candidate.score,
          });
          if (candidates.length >= stageBudget || candidates.length >= request.maxCandidates) break;
        }
      }
      frontier = next.sort(
        (left, right) =>
          right.priority - left.priority || right.seedScore - left.seedScore || left.id.localeCompare(right.id)
      );
    }

    candidates.sort(
      (left, right) => right.relevance - left.relevance || left.knowledgeId.localeCompare(right.knowledgeId)
    );
    return {
      seeds: seeds.map((seed) => seed.chunk.knowledgeId),
      candidates,
      visited: visited.size,
      elapsedMs: performance.now() - started,
    };
  }
}

function uniqueSeeds(results: readonly RetrievalResult[]): RetrievalResult[] {
  const seen = new Set<KnowledgeId>();
  return results.filter((result) => {
    if (seen.has(result.chunk.knowledgeId)) return false;
    seen.add(result.chunk.knowledgeId);
    return true;
  });
}

function relevance(concepts: ReturnType<typeof queryConcepts>, text: string): number {
  const tokens = new Set(tokenize(text));
  if (concepts.length === 0) return 0;
  let hits = 0;
  for (const concept of concepts) if (concept.variants.some((variant) => tokens.has(variant))) hits += 1;
  return hits / concepts.length;
}

function roundValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}
