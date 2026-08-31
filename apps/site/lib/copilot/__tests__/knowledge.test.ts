import { beforeAll, describe, expect, it } from "vitest";
import { type BuildResult, build } from "../../../scripts/knowledge/build";
import { isFatal } from "../../../scripts/knowledge/validate";
import { symbolPath } from "../core/value-objects/ids";
import { allCases, runEval } from "../eval/run";
import { createKnowledgeEngine, type KnowledgeEngine } from "../infrastructure/knowledge-engine";
import { MemoryArtifactLoader } from "../infrastructure/storage/memory-artifact-loader";

/**
 * The whole knowledge pipeline, against the real documentation, with no model
 * and nothing written to disk.
 *
 * §93's first tier. It is the tier that catches almost everything and the only
 * one cheap enough to run on every commit: compiling 79 pages and querying the
 * result takes about as long as the rest of the suite.
 *
 * Embeddings are off, so this measures the *deterministic* half — capability
 * level 1 in §79, which has to work on a machine with no WebGPU and no
 * download. The hybrid numbers come from `pnpm knowledge:eval`.
 */
describe("knowledge pipeline", () => {
  let result: BuildResult;

  beforeAll(async () => {
    result = await build({ embed: false, verifyExamples: false, write: false, quiet: true });
  }, 120_000);

  it("compiles the documentation without a fatal problem", () => {
    // §67: an unregistered route, a duplicated id or a dangling relation is
    // invisible at build time and produces a confidently wrong answer later.
    expect(result.problems.filter(isFatal)).toEqual([]);
  });

  it("produces a coherent artifact set", () => {
    expect(result.entries.length).toBeGreaterThan(400);
    expect(result.chunks.length).toBeGreaterThanOrEqual(result.entries.length);
    expect(result.symbols.length).toBeGreaterThan(400);
    expect(result.manifest.contentHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is reproducible: the same tree compiles to the same hash", async () => {
    const again = await build({ embed: false, verifyExamples: false, write: false, quiet: true });
    expect(again.manifest.contentHash).toBe(result.manifest.contentHash);
  }, 120_000);

  it("documents every top-level member it knows about", () => {
    const documented = new Set(result.entries.flatMap((entry) => entry.symbols));
    const orphans = result.symbols
      .filter((symbol) => !symbol.parent && symbol.kind !== "type" && !documented.has(symbol.id))
      .map((symbol) => symbol.path);

    // Advisory in the build, asserted here: a public API with no passage
    // behind it is one the ghost can name and cannot explain.
    expect(orphans).toEqual([]);
  });

  it("points every symbol at a route that exists", () => {
    const routes = new Set(result.routes.map((route) => route.id));
    const dangling = result.symbols.filter((symbol) => symbol.routeId && !routes.has(symbol.routeId));
    expect(dangling).toEqual([]);
  });

  it("documents an API on the page that defines it, not the page before it alphabetically", () => {
    // The bug this locks: ties in the evidence ranking were broken by entry
    // id, so `JIT.clone` was documented at `reference/functions/canonical`.
    const byPath = new Map(result.symbols.map((symbol) => [symbolPath(symbol.id), symbol]));

    expect(byPath.get("jit.clone")?.routeId).toBe("route.docs.reference.functions.clone");
    expect(byPath.get("jit.string.uuid")?.routeId).toBe("route.docs.reference.operators.strings");
    expect(byPath.get("jit.security.mask")?.routeId).toBe("route.docs.reference.functions.mask");
    expect(byPath.get("jit.validate.safeParse")?.routeId).toBe("route.docs.reference.functions.validation");
  });

  it("keeps a symbol's own page among its examples", () => {
    // Truncating `examples` to eight used to drop the authoritative page when
    // enough other pages happened to sort before it, so `JIT.cqrs` kept eight
    // passages that merely mention it and none from the page documenting it.
    //
    // Symbols whose declared page never uses them are excluded, because that
    // is a documentation bug rather than a compiler one — the build reports
    // those separately as a coverage advisory.
    const entries = new Map(result.entries.map((entry) => [entry.id, entry]));
    const missing = result.symbols
      .filter((symbol) => symbol.routeId && symbol.examples.length > 0)
      .filter((symbol) =>
        result.entries.some((entry) => entry.routeId === symbol.routeId && entry.symbols.includes(symbol.id))
      )
      .filter((symbol) => !symbol.examples.some((id) => entries.get(id)?.routeId === symbol.routeId))
      .map((symbol) => symbol.path);

    expect(missing).toEqual([]);
  });
});

describe("retrieval, without a model", () => {
  let engine: KnowledgeEngine;

  beforeAll(async () => {
    const result = await build({ embed: false, verifyExamples: false, write: false, quiet: true });
    engine = await createKnowledgeEngine(
      new MemoryArtifactLoader({
        manifest: result.manifest,
        entries: result.entries,
        chunks: result.chunks,
        symbols: result.symbols,
        routes: result.routes,
        lexical: result.lexical,
      })
    );
  }, 120_000);

  it("resolves every API a question names outright", async () => {
    // §106 sets this at 100% because it is the floor: a retriever that cannot
    // find `JIT.mask` when asked about `JIT.mask` has a defect no amount of
    // conceptual tuning hides.
    const run = await runEval(
      engine,
      null,
      allCases(engine).filter((entry) => entry.category === "api-lookup")
    );
    expect(run.metrics.exactSymbolAccuracy).toBe(1);
  }, 120_000);

  it("never puts a release-notes page in front of a question about behaviour", async () => {
    // The failure the old ranking made most often, and the most expensive one:
    // an answer built from a changelog describes a delta to someone who has
    // never seen the thing it applies to.
    const run = await runEval(engine, null);
    expect(run.metrics.forbiddenHits).toBe(0);
  }, 120_000);

  it("meets the lexical-only retrieval floor", async () => {
    const run = await runEval(engine, null);

    // Deliberately below §98's targets: those are for the hybrid stack. This
    // is what a reader with no WebGPU and no download gets, and it still has
    // to be a working documentation search.
    expect(run.metrics.recallAt5).toBeGreaterThan(0.85);
    expect(run.metrics.mrr).toBeGreaterThan(0.7);
  }, 120_000);

  it("reports why each result was returned", async () => {
    const report = await engine.retriever.retrieve("how do I validate a uuid?", { context: { locale: "en" } });

    expect(report.results.length).toBeGreaterThan(0);
    expect(report.exactSymbols.map((symbol) => symbol.id)).toContain("symbol.jit.string.uuid");
    for (const result of report.results) {
      expect(result.reason).toBeTruthy();
      expect(result.finalScore).toBeGreaterThan(0);
    }
  });

  it("resolves a route id to a real path and refuses one it never registered", () => {
    const resolved = engine.routes.resolve("route.docs.quick-start" as never, "pt-BR");
    expect(resolved).toBe("/docs/quick-start");

    // §82: navigation is an allowlist, and this is the list.
    expect(engine.routes.resolve("route.docs.made.up" as never, "en")).toBeUndefined();
  });
});
