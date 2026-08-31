/**
 * The context pipeline, one stage per file section.
 *
 * §PART 3 asks for these to be separable rather than tangled in one function,
 * and the reason is measurement: `context contamination` is a property of
 * *selection*, and you cannot measure a stage that does not exist as a thing.
 *
 *   classify   — what kind of evidence is this
 *   dedupe     — is it the same thing we already have
 *   select     — does its kind still have room
 *   allocate   — does it fit the budget
 */
import { NEAR_DUPLICATE } from "../../config/retrieval";
import type { EvidenceRole } from "../../core/entities/model-context";
import type { RetrievalResult } from "../../core/entities/retrieval";
import { tokenize } from "../retrieval/tokenizer";

// ------------------------------------------------------------------ classify

/**
 * What a passage is for.
 *
 * Derived from the chunk's own kind and from why retrieval returned it — not
 * from reading the text. A passage retrieved because the reader named the API
 * it documents is playing a different role from the same passage retrieved by
 * word overlap, and the quota below is what stops six of one crowding out the
 * other four.
 */
export function classify(result: RetrievalResult): EvidenceRole {
  if (result.reason === "current-context") return "current-context";
  if (result.reason === "exact-symbol") return "symbol";

  switch (result.chunk.kind) {
    case "migration":
    case "history":
      return "history";
    case "concept":
    case "overview":
      return "concept";
    case "example":
      return "example";
    case "guide":
      return "guide";
    default:
      return "reference";
  }
}

/**
 * How many passages of each kind a context may hold.
 *
 * The shape §PART 3 asks for: one block of symbol truth, two or three
 * explanatory passages, an example, a reference. Without quotas the ranking
 * happily returns six conceptual chunks that all say the library compiles
 * schemas ahead of time, and a small model given six restatements of one idea
 * produces a seventh.
 *
 * `history` is capped at one and only reachable when the question is about a
 * version — the retriever has already ranked it down; this is the second gate.
 */
export const ROLE_QUOTA: Record<EvidenceRole, number> = {
  symbol: 3,
  reference: 3,
  concept: 3,
  guide: 2,
  example: 2,
  "current-context": 2,
  history: 1,
};

// -------------------------------------------------------------------- dedupe

export interface DedupeReport<T> {
  kept: T[];
  dropped: number;
}

/**
 * Redundancy, in the three shapes it actually takes.
 *
 * Two slices of one entry are the same passage cut in half. Two entries on one
 * page are usually adjacent sections restating each other across a heading.
 * And two passages from different pages can still be near-copies — the
 * reference and the guide routinely carry the same example.
 *
 * No embeddings: token overlap is enough, it is deterministic, and it costs
 * nothing next to the retrieval that produced these.
 */
export function dedupe(results: readonly RetrievalResult[]): DedupeReport<RetrievalResult> {
  const seenEntries = new Set<string>();
  const kept: RetrievalResult[] = [];
  const keptTokens: Set<string>[] = [];
  let dropped = 0;

  for (const result of results) {
    if (seenEntries.has(result.chunk.knowledgeId)) {
      dropped += 1;
      continue;
    }

    const tokens = new Set(tokenize(result.chunk.content));
    if (keptTokens.some((previous) => overlap(tokens, previous) > NEAR_DUPLICATE)) {
      dropped += 1;
      continue;
    }

    seenEntries.add(result.chunk.knowledgeId);
    kept.push(result);
    keptTokens.push(tokens);
  }

  return { kept, dropped };
}

/** Share of the smaller passage's vocabulary that the larger one already has. */
export function overlap(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  if (small.size === 0) return 0;

  let shared = 0;
  for (const token of small) if (large.has(token)) shared += 1;

  return shared / small.size;
}

// -------------------------------------------------------------------- select

/**
 * Applies the quotas, in rank order.
 *
 * Rank order matters: a quota is a ceiling on a kind, not a reordering. The
 * best passage of an over-quota kind is kept and the fourth is dropped, rather
 * than the kind being sampled evenly — the ranking is still the best evidence
 * about what answers the question.
 */
export function selectByRole(
  results: readonly RetrievalResult[],
  roleOf: (result: RetrievalResult) => EvidenceRole,
  quota: Record<EvidenceRole, number> = ROLE_QUOTA
): { kept: RetrievalResult[]; dropped: number } {
  const used = new Map<EvidenceRole, number>();
  const kept: RetrievalResult[] = [];
  let dropped = 0;

  for (const result of results) {
    const role = roleOf(result);
    const count = used.get(role) ?? 0;

    if (count >= quota[role]) {
      dropped += 1;
      continue;
    }

    used.set(role, count + 1);
    kept.push(result);
  }

  return { kept, dropped };
}
