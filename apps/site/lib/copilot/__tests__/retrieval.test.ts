import { describe, expect, it } from "vitest";
import { normalize } from "../../../scripts/knowledge/embeddings/binary";
import { buildLexicalIndex } from "../../../scripts/knowledge/indexes/lexical";
import { HybridRetriever } from "../application/retrieval/hybrid-retriever";
import { extractSymbolMentions, normalizeSymbolInput, symbolCandidates } from "../application/retrieval/symbol-query";
import { RRF_K, SIGNAL_WEIGHTS } from "../config/retrieval";
import type { ApiSymbol } from "../core/entities/api-symbol";
import type { DocumentChunk } from "../core/entities/document-chunk";
import { StaticChunkRepository, StaticSymbolRepository } from "../infrastructure/repositories/static-repositories";
import { StaticLexicalRepository } from "../infrastructure/retrieval/lexical-repository";
import { PackedVectorRepository } from "../infrastructure/retrieval/vector-repository";

// ------------------------------------------------------------------ fixtures

/**
 * Ids are branded, and a fixture writes them as plain strings.
 *
 * The cast lives here, once, rather than at every literal — the brand exists
 * to stop production code inventing an id, not to make a test spell one out
 * six ways.
 */
type ChunkFixture = Omit<Partial<DocumentChunk>, "id" | "knowledgeId" | "routeId"> & {
  id: string;
  content: string;
  knowledgeId?: string;
  routeId?: string;
};

function chunk(overrides: ChunkFixture): DocumentChunk {
  return {
    knowledgeId: `knowledge.${overrides.id}`,
    locale: "en",
    title: "Title",
    breadcrumb: "Page › Title",
    routeId: "route.docs.page",
    kind: "reference",
    dense: false,
    showsRemovedApis: false,
    symbols: [],
    part: 0,
    parts: 1,
    sourceFile: "content/docs/page.mdx",
    sourceHash: "hash",
    embeddingHash: "embedding",
    ...overrides,
  } as unknown as DocumentChunk;
}

type SymbolFixture = Omit<Partial<ApiSymbol>, "id" | "parent" | "examples"> & {
  id: string;
  name: string;
  kind: ApiSymbol["kind"];
  parent?: string;
  examples?: string[];
};

function symbol(overrides: SymbolFixture): ApiSymbol {
  return {
    path: `JIT.${overrides.name}`,
    signatures: [],
    validOn: [],
    purpose: "",
    examples: [],
    ...overrides,
  } as unknown as ApiSymbol;
}

// ------------------------------------------------------------ symbol queries

describe("symbol query normalization", () => {
  it("strips call and generic syntax", () => {
    expect(normalizeSymbolInput("JIT.string().uuid()")).toBe("JIT.string.uuid");
    expect(normalizeSymbolInput("JIT.validate.parse<User>(User)")).toBe("JIT.validate.parse");
    expect(normalizeSymbolInput(".uuid()")).toBe("uuid");
  });

  it("offers the full path before the bare name", () => {
    expect(symbolCandidates("JIT.validate.safeParse")).toEqual([
      { path: "jit.validate.safeParse" },
      { path: "jit.validate" },
      { name: "safeParse" },
    ]);
  });

  it("reads a long chain as its factory plus its last step", () => {
    // `JIT.string().min(3).uuid()` is a question about uuid, on a string.
    expect(symbolCandidates("JIT.string().min(3).uuid()")).toContainEqual({ path: "jit.string.uuid" });
  });

  it("separates what the reader stated from what the wording implies", () => {
    const stated = extractSymbolMentions("how do I use JIT.validate.safeParse?");
    expect(stated.stated).toContain("jit.validate.safeParse");

    const implied = extractSymbolMentions("como validar um uuid?");
    expect(implied.stated).toHaveLength(0);
    expect(implied.implied).toContain("uuid");
  });

  it("does not treat an ordinary noun as an API reference", () => {
    // "how do I clone an object" is not a question about JIT.object.
    const { implied } = extractSymbolMentions("how do I clone an object?");
    expect(implied).not.toContain("object");
    expect(implied).toContain("clone");
  });

  it("case-folds an acronym API", () => {
    expect(extractSymbolMentions("what is a DTO in jit?").implied).toContain("dto");
  });
});

describe("symbol repository", () => {
  const symbols = [
    symbol({ id: "symbol.jit.validate", name: "validate", kind: "namespace" }),
    symbol({
      id: "symbol.jit.validate.safeParse",
      name: "safeParse",
      kind: "function",
      parent: "symbol.jit.validate",
      examples: ["a", "b", "c"],
    }),
    symbol({ id: "symbol.jit.string.safeParse", name: "safeParse", kind: "method" }),
    symbol({ id: "symbol.jit.string.uuid", name: "uuid", kind: "method", examples: ["a"] }),
    symbol({ id: "symbol.jit.Update", name: "Update", kind: "type" }),
    symbol({ id: "symbol.jit.state.update", name: "update", kind: "function", examples: ["a", "b"] }),
  ];
  const repository = new StaticSymbolRepository(symbols);

  it("resolves a written path exactly", () => {
    expect(repository.findExact("JIT.validate.safeParse(User)")?.id).toBe("symbol.jit.validate.safeParse");
  });

  it("resolves an ambiguous bare name to the one with the documentation behind it", () => {
    // `safeParse` is a namespace member and a chain method on every kind.
    // Refusing to answer meant exact lookup never fired on the name readers
    // ask about most.
    expect(repository.findExact("safeParse")?.id).toBe("symbol.jit.validate.safeParse");
  });

  it("does not let an undocumented type export shadow the API of the same name", () => {
    expect(repository.findExact("update")?.id).toBe("symbol.jit.state.update");
  });

  it("finds a near miss without inventing one", () => {
    expect(repository.search("safepars")[0]?.symbol.id).toBe("symbol.jit.validate.safeParse");
    expect(repository.search("notEmpty")).toEqual([]);
    expect(repository.findExact("JIT.compare.deepEqual")).toBeUndefined();
  });
});

// --------------------------------------------------------------------- bm25

describe("lexical repository", () => {
  const chunks = [
    chunk({ id: "chunk.a", content: "Validate a UUID string with the uuid check.", title: "uuid" }),
    chunk({ id: "chunk.b", content: "Clone an object deeply and quickly.", title: "clone" }),
    chunk({ id: "chunk.c", content: "The constructor and valueOf of a schema builder.", title: "constructor" }),
  ];
  const repository = new StaticLexicalRepository(buildLexicalIndex(chunks));

  it("ranks the chunk that is about the term first", () => {
    expect(repository.search("uuid", 3)[0].chunkId).toBe("chunk.a");
    expect(repository.search("clone an object", 3)[0].chunkId).toBe("chunk.b");
  });

  it("survives tokens that collide with Object.prototype", () => {
    // `postings["constructor"]` on a plain object answers from the prototype,
    // and the build crashed on the word appearing in the real corpus.
    expect(repository.search("constructor", 3)[0].chunkId).toBe("chunk.c");
    expect(repository.search("valueOf", 3)[0].chunkId).toBe("chunk.c");
  });

  it("measures how much a query narrows the corpus", () => {
    const specific = repository.specificity([{ term: "uuid", weight: 1 }]);
    const vague = repository.specificity([{ term: "a", weight: 1 }]);
    expect(specific).toBeGreaterThan(vague);
    expect(specific).toBeLessThanOrEqual(1);
  });

  it("returns nothing rather than everything for a query it cannot match", () => {
    expect(repository.search("kubernetes", 3)).toEqual([]);
  });
});

// ------------------------------------------------------------------- vectors

describe("vector repository", () => {
  const dimensions = 4;
  const vectors = [
    normalize(Float32Array.from([1, 0, 0, 0])),
    normalize(Float32Array.from([0, 1, 0, 0])),
    normalize(Float32Array.from([0.9, 0.1, 0, 0])),
  ];
  const packed = new Float32Array(vectors.length * dimensions);
  for (const [index, vector] of vectors.entries()) packed.set(vector, index * dimensions);

  const repository = new PackedVectorRepository(packed, ["chunk.a", "chunk.b", "chunk.c"], dimensions);

  it("ranks by cosine, which is a dot product once both sides are normalized", () => {
    const results = repository.search(normalize(Float32Array.from([1, 0, 0, 0])), 3);
    expect(results.map((match) => match.chunkId)).toEqual(["chunk.a", "chunk.c", "chunk.b"]);
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  it("honours the limit through the bounded insertion sort", () => {
    expect(repository.search(normalize(Float32Array.from([1, 1, 0, 0])), 2)).toHaveLength(2);
  });

  it("refuses to answer from a truncated file rather than answering wrongly", () => {
    const short = new PackedVectorRepository(packed.slice(0, 8), ["chunk.a", "chunk.b", "chunk.c"], dimensions);
    expect(short.available).toBe(false);
    expect(short.search(vectors[0], 3)).toEqual([]);
  });

  it("is simply unavailable when the build shipped no vectors", () => {
    const none = new PackedVectorRepository(null, ["chunk.a"], dimensions);
    expect(none.available).toBe(false);
  });
});

// --------------------------------------------------------------------- fusion

describe("reciprocal rank fusion", () => {
  const chunks = [
    chunk({
      id: "chunk.agreed",
      content: "Two retrievers found this one about masking fields.",
      routeId: "route.docs.a",
    }),
    chunk({
      id: "chunk.lexical",
      content: "Only the lexical retriever found this about tokens.",
      routeId: "route.docs.b",
    }),
    chunk({
      id: "chunk.dense",
      content: "A table of every api and its purpose in two words.",
      routeId: "route.docs.c",
      dense: true,
    }),
    chunk({
      id: "chunk.history",
      content: "What changed in the two point oh release for masking.",
      routeId: "route.docs.d",
      kind: "migration",
    }),
  ];

  const chunkRepository = new StaticChunkRepository(chunks);
  const lexical = new StaticLexicalRepository(buildLexicalIndex(chunks));
  const symbols = new StaticSymbolRepository([]);

  const retriever = new HybridRetriever({
    chunks: chunkRepository,
    symbols,
    lexical,
    vectors: new PackedVectorRepository(null, [], 4),
  });

  it("prefers agreement between retrievers over one retriever's confidence", async () => {
    // The property a weighted sum could never express: rank 3 in two
    // retrievers beats rank 1 in one.
    const twoAtThree = (2 * SIGNAL_WEIGHTS.lexical) / (RRF_K + 3);
    const oneAtOne = SIGNAL_WEIGHTS.lexical / (RRF_K + 1);
    expect(twoAtThree).toBeGreaterThan(oneAtOne);
  });

  it("ranks a history page down when the question is not about a version", async () => {
    const withoutHistory = await retriever.retrieve("masking fields", {
      context: { locale: "en" },
      allowHistory: false,
    });
    const withHistory = await retriever.retrieve("masking fields", { context: { locale: "en" }, allowHistory: true });

    const scoreOf = (report: Awaited<ReturnType<typeof retriever.retrieve>>) =>
      report.results.find((result) => result.chunk.id === "chunk.history")?.finalScore ?? 0;

    expect(scoreOf(withoutHistory)).toBeLessThan(scoreOf(withHistory));
  });

  it("reports which signal carried each hit", async () => {
    const report = await retriever.retrieve("tokens", { context: { locale: "en" } });
    expect(report.results[0].reason).toBe("lexical");
    expect(report.results[0].scores.lexical).toBeGreaterThan(0);
  });

  it("refuses a subject absent from the corpus without discarding covered questions", async () => {
    const absent = await retriever.retrieve("does jit support graphql subscriptions?", {
      context: { locale: "en" },
    });
    const covered = await retriever.retrieve("masking fields", { context: { locale: "en" } });

    expect(absent.coverage.covered).toBe(false);
    expect(absent.coverage.unknownTerms).toContain("graphql");
    expect(covered.coverage.covered).toBe(true);
  });

  it("does not confuse a supported subject with an external integration claim", async () => {
    const supported = await retriever.retrieve("does jit support masking fields?", {
      context: { locale: "en" },
    });

    expect(supported.coverage.unknownTerms).not.toContain("masking");
    expect(supported.coverage.covered).toBe(true);
  });

  it("keeps at most two chunks from one page", async () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      chunk({
        id: `chunk.same.${index}`,
        content: `Masking recipe number ${index} with entirely different words ${"alpha beta gamma ".repeat(index + 1)}`,
        routeId: "route.docs.same",
      })
    );

    const local = new HybridRetriever({
      chunks: new StaticChunkRepository(many),
      symbols,
      lexical: new StaticLexicalRepository(buildLexicalIndex(many)),
      vectors: new PackedVectorRepository(null, [], 4),
    });

    const report = await local.retrieve("masking recipe", { context: { locale: "en" } });
    expect(report.results.length).toBeLessThanOrEqual(2);
  });

  it("drops a chunk that mostly repeats one already kept", async () => {
    const twins = [
      chunk({
        id: "chunk.one",
        content: "Deep clone copies every nested value quickly and safely.",
        routeId: "route.docs.one",
      }),
      chunk({
        id: "chunk.two",
        content: "Deep clone copies every nested value quickly and safely.",
        routeId: "route.docs.two",
      }),
    ];

    const local = new HybridRetriever({
      chunks: new StaticChunkRepository(twins),
      symbols,
      lexical: new StaticLexicalRepository(buildLexicalIndex(twins)),
      vectors: new PackedVectorRepository(null, [], 4),
    });

    const report = await local.retrieve("deep clone nested value", { context: { locale: "en" } });
    expect(report.results).toHaveLength(1);
  });
});
