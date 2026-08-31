import type { KnowledgeId, RouteId, SymbolId } from "../value-objects/ids";
import type { Locale } from "../value-objects/locale";

/**
 * What a piece of knowledge is for, which decides how it is allowed to rank.
 *
 * `history` is the one that earns its own kind rather than being a tag. The
 * changelog and the migration guide are written in the exact vocabulary of
 * every conceptual question — "Faster compilation and faster safeParse" is a
 * heading — and their sections are short, which every length-normalized
 * ranking rewards. Left alone they take first place for "why is jit fast", and
 * an answer built on release notes describes a delta to someone who has never
 * seen the thing the delta applies to. They are still the right answer when
 * the question is about a version, so the kind ranks them down rather than
 * dropping them.
 */
export type KnowledgeKind =
  | "concept"
  | "api"
  | "reference"
  | "guide"
  | "example"
  | "error"
  | "migration"
  | "history"
  | "overview";

/**
 * One canonical unit of documented knowledge.
 *
 * The unit is a *section*, not a page and not a chunk: a page covers several
 * subjects and a chunk is a slice made for a token budget. A section is the
 * smallest thing that answers a question on its own, which is what a citation
 * has to point at and what an eval case has to name.
 *
 * `id` is stable across rewrites of `content`, which is what lets an eval
 * expectation outlive an editing pass. `source.hash` is what changed instead,
 * and the embedding cache is keyed by that.
 */
export interface KnowledgeEntry {
  id: KnowledgeId;
  kind: KnowledgeKind;
  /** The language this was *written* in — not the language it may be read in. */
  locale: Locale;

  title: string;
  /**
   * `page › parent heading › heading`. "Performance" means nothing on its own;
   * a dozen pages have that heading, and the trail is what tells
   * "equal › Performance" from "dto › Performance" — both to the ranking and
   * to a model reading the passage back.
   */
  breadcrumb: string;
  content: string;

  routeId: RouteId;
  /** Heading anchor within the page, absent for a page intro. */
  anchor?: string;

  /** Every public API name this entry documents or demonstrates. */
  symbols: SymbolId[];

  /**
   * Entries deliberately linked to this one, from `related:` frontmatter and
   * from shared symbols. A reader who reaches one almost always wants the
   * other, and no ranking signal expresses that on its own.
   */
  related: KnowledgeId[];

  /**
   * The entry is mostly a table.
   *
   * An index row names every API in two words each, so it matches nearly any
   * question and explains none of them. A correct but thin answer: ranked
   * below the page that explains the thing, not removed.
   */
  dense: boolean;

  /**
   * The entry quotes APIs the library no longer has.
   *
   * The migration guide does this on purpose — its job is showing
   * `JIT.validator` next to what replaced it — and once chunked, the "// 1.x"
   * comment that framed the block may not travel with the code. Marked so the
   * prompt can say what it is, and so the audit does not read the names back
   * as evidence that they exist.
   */
  showsRemovedApis: boolean;

  source: {
    /** Repo-relative, for `knowledge:inspect` and for blaming a bad chunk. */
    file: string;
    /** Digest of the normalized content — what incremental rebuilds compare. */
    hash: string;
  };
}
