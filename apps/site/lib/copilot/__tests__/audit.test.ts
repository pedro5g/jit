import { beforeAll, describe, expect, it } from "vitest";
import { build } from "../../../scripts/knowledge/build";
import { parseActions } from "../application/actions/parse-actions";
import { AuditService, retryInstruction, StrictAuditPolicy } from "../application/audit/audit.service";
import { ContextService } from "../application/context/context.service";
import { promptOverhead, renderedSize, renderMessages } from "../application/context/render";
import { estimateTokens } from "../application/context/token-budget";
import { CONTEXT_BUDGET } from "../config/retrieval";
import type { AuditResult } from "../core/entities/audit";
import type { ModelContext } from "../core/entities/model-context";
import { createKnowledgeEngine, type KnowledgeEngine } from "../infrastructure/knowledge-engine";
import { MemoryArtifactLoader } from "../infrastructure/storage/memory-artifact-loader";

/**
 * The audit, against the real symbol index.
 *
 * Every hallucination below was actually produced by a model running on this
 * site — `JIT.compare.deepEqual`, `JIT.security.redact`, `.notEmpty()`, an
 * example with a SQL query in it, a JSON envelope instead of a reply. All of
 * them passed every gate the old assistant had. §101's target is not that a
 * small model stops inventing names; it is that an invented name never
 * reaches a reader, and these are the cases that define whether it does.
 */
describe("audit", () => {
  let engine: KnowledgeEngine;
  let contextService: ContextService;
  let audit: AuditService;

  beforeAll(async () => {
    const result = await build({
      embed: false,
      verifyExamples: false,
      write: false,
      quiet: true,
    });
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

    contextService = new ContextService({
      knowledge: engine.knowledge,
      routes: engine.routes,
      symbols: engine.symbols,
    });
    audit = new AuditService();
  }, 120_000);

  async function contextFor(question: string): Promise<ModelContext> {
    const report = await engine.retriever.retrieve(question, {
      context: { locale: "en" },
    });
    return contextService.build({
      question,
      locale: "en",
      report,
      reservedTokens: promptOverhead(engine.symbols, {
        question,
        exactSymbols: report.exactSymbols,
      }),
    });
  }

  const corpusKnows = (term: string) => engine.lexical.knows(term);

  /**
   * Detection and policy, kept apart here exactly as they are in the service.
   *
   * The audit returns findings; whether findings reject an answer is the
   * policy's call. A test asserting on one `valid` flag would be asserting on
   * both at once, which is what made the old tolerance impossible to change
   * without changing what was detected.
   */
  const policy = new StrictAuditPolicy();
  const rejects = (result: AuditResult) => policy.shouldReject(result);

  const check = async (question: string, answer: string) =>
    audit.run({
      question,
      answer,
      locale: "en",
      modelContext: await contextFor(question),
      symbols: engine.symbols,
      knowledge: engine.knowledge,
      corpusKnows,
      topScore: 0.05,
      agreement: 2,
    });

  it("rejects a namespace member that does not exist", async () => {
    const result = await check(
      "how do I compare two objects?",
      "Use `JIT.compare.deepEqual(User)` to compile a deep equality check. It walks the schema once. [1]"
    );

    expect(rejects(result)).toBe(true);
    expect(result.findings.some((finding) => finding.kind === "invented-symbol")).toBe(true);
    expect(result.findings.flatMap((finding) => finding.offenders)).toContain("JIT.compare.deepEqual");
  });

  it("rejects an invented member of a real namespace", async () => {
    const result = await check(
      "how do I hide sensitive fields?",
      'Call `JIT.security.redact(User, ["email"])` to strip the field before logging. [1]'
    );

    expect(rejects(result)).toBe(true);
    expect(result.findings.flatMap((finding) => finding.offenders)).toContain("JIT.security.redact");
  });

  it("rejects an invented chain method", async () => {
    const result = await check(
      "how do I require a non-empty string?",
      "Write `JIT.string().notEmpty()` and the compiled check rejects the empty string. [1]"
    );

    expect(rejects(result)).toBe(true);
    expect(result.findings.flatMap((finding) => finding.offenders)).toContain(".notEmpty()");
  });

  it("says which schema kind a real method belongs to", async () => {
    // Being told `.email()` is valid on a string is worth far more to a reader
    // than being told it does not exist — because it does.
    const result = await check("how do I validate a number?", "Use `JIT.number().email()` to check the format. [1]");

    expect(rejects(result)).toBe(true);
    expect(result.findings.map((finding) => finding.detail).join(" ")).toMatch(/valid on/);
  });

  it("accepts an answer that uses the library correctly", async () => {
    const result = await check(
      "how do I validate a uuid?",
      [
        "Compile the check once and call it. [1]",
        "",
        "```ts",
        "const Id = JIT.string().uuid();",
        "const isId = JIT.validate.is(Id);",
        'isId("6f0d…");',
        "```",
      ].join("\n")
    );

    const names = result.findings.filter((finding) => finding.kind === "invented-symbol");

    expect(names).toEqual([]);
  });

  it("does not flag ordinary JavaScript methods in an example", async () => {
    const result = await check(
      "how do I validate a list?",
      ["```ts", "const Users = JIT.array(JIT.string());", 'const names = [1, 2].map(String).join(",");', "```"].join(
        "\n"
      )
    );

    expect(result.findings.some((finding) => finding.kind === "invented-symbol")).toBe(false);
  });

  it("rejects an example that drifted into another technology", async () => {
    const result = await check(
      "how do I query a list?",
      ["```ts", "const rows = await User.query('SELECT * FROM users WHERE id = ?', [id]);", "```"].join("\n")
    );

    expect(rejects(result)).toBe(true);
    expect(result.findings.some((finding) => finding.kind === "foreign-domain-drift")).toBe(true);
  });

  it("rejects an example that never calls the library", async () => {
    const result = await check(
      "why is jit fast?",
      ["```ts", 'if (user.id !== undefined && typeof user.name === "string") return true;', "```"].join("\n")
    );

    const drift = result.findings.find((finding) => finding.kind === "foreign-domain-drift");
    expect(drift).toBeDefined();
    // Detection remains a warning; production policy still fails closed for
    // this particular warning because the block is presented as a jit example.
    expect(drift?.severity).toBe("warning");
    expect(rejects(result)).toBe(true);
  });

  it("grounds a faithful Portuguese explanation against English evidence", async () => {
    const context = await contextFor("why is generated code fast?");
    const result = audit.run({
      question: "por que o código gerado é rápido?",
      answer:
        "O caminho gerado é rápido porque emite acesso direto às propriedades, loops indexados e somente as validações exigidas pelo schema. [1]",
      locale: "pt-BR",
      modelContext: {
        ...context,
        locale: "pt-BR",
        question: "por que o código gerado é rápido?",
      },
      symbols: engine.symbols,
      knowledge: engine.knowledge,
      corpusKnows,
      topScore: 0.05,
      agreement: 2,
    });

    expect(result.grounding.coverage).toBeGreaterThanOrEqual(0.9);
    expect(rejects(result)).toBe(false);
  });

  it("blocks the observed unsupported runtime claim even though its detector is a warning", async () => {
    const result = await check(
      "why is generated code fast?",
      "The generated code is fast because it avoids the overhead of a full JavaScript runtime by using AOT compilation directly in the function body. This means the compiler generates a single executable block containing all necessary logic without needing a separate loader or interpreter between the input and output.\n\n```ts\ndeclare const generate = () => 'generated-fast-code';\n```"
    );

    expect(result.findings.some((finding) => finding.kind === "unsupported-factual-claim")).toBe(true);
    expect(rejects(result)).toBe(true);
  });

  it("catches a generation that looped", async () => {
    const result = await check(
      "what is jit?",
      ["const User = JIT.object({});", "const User = JIT.object({});", "const User = JIT.object({});"].join("\n")
    );

    expect(rejects(result)).toBe(true);
    expect(result.findings[0].kind).toBe("generation-degeneration");
    // Everything after degeneration would describe the same broken output.
    expect(result.findings).toHaveLength(1);
  });

  it("catches raw machine output", async () => {
    const result = await check("what is jit?", '{"question": "what is jit?", "answer": "a data engine"}');

    expect(rejects(result)).toBe(true);
    expect(result.findings[0].kind).toBe("generation-degeneration");
  });

  it("catches an answer cut off inside a code block", async () => {
    const result = await check("how do I clone?", "Use clone. [1]\n\n```ts\nconst c = JIT.clone(User);");

    expect(result.findings[0].kind).toBe("generation-degeneration");
  });

  it("flags a figure the documentation never states", async () => {
    const result = await check(
      "how fast is jit?",
      "jit validates in 0.3ns per field, which is 47x faster than the alternatives. [1]"
    );

    const figures = result.findings.find((finding) => finding.source === "unsupported-number");
    expect(figures).toBeDefined();
    // A footnote, not a block: the answer is still useful with an asterisk.
    expect(figures?.severity).toBe("warning");
  });

  it("catches an answer written from training data rather than from the sources", async () => {
    /**
     * The barrier that actually works for this, and the one that does not.
     *
     * A pre-generation "is this covered?" gate was the obvious design and it
     * is not buildable from the signals available: measured against the real
     * corpus, "why is jit fast?" and "does jit support graphql subscriptions?"
     * produce the identical fused score, and raw BM25 ranks the graphql
     * question *above* a covered one. So the check moved to where the evidence
     * is — the answer itself, which shares almost no vocabulary with anything
     * it was shown.
     */
    const context = await contextFor("how do I connect jit to postgres?");

    const invented = audit.run({
      question: "how do I connect jit to postgres?",
      answer:
        "jit connects to postgres through its adapter layer. Configure the connection string in the config file and the query compiler will push predicates down into the database, which is how it stays fast on large tables. The adapter pools connections and retries failed transactions automatically.",
      locale: "en",
      modelContext: context,
      symbols: engine.symbols,
      knowledge: engine.knowledge,
      corpusKnows,
      topScore: 0.016,
      agreement: 1,
    });

    expect(rejects(invented)).toBe(true);
    expect(invented.classification.origins).toContain("grounding_failure");
    expect(invented.grounding.verdict).toBe("substantially-ungrounded");
    expect(invented.confidence.grounding).toBeLessThan(1);
  });

  it("accepts the honest refusal for the same question", async () => {
    const context = await contextFor("how do I connect jit to postgres?");

    const honest = audit.run({
      question: "how do I connect jit to postgres?",
      answer: "The documentation does not cover connecting jit to a database.",
      locale: "en",
      modelContext: context,
      symbols: engine.symbols,
      knowledge: engine.knowledge,
      corpusKnows,
      topScore: 0.016,
      agreement: 1,
    });

    expect(rejects(honest)).toBe(false);
  });

  it("computes confidence from evidence rather than from the answer", async () => {
    const context = await contextFor("how do I validate a uuid?");
    const answer = "Compile the check with `JIT.validate.is`. [1]";

    const shared = {
      question: "how do I validate a uuid?",
      answer,
      locale: "en" as const,
      modelContext: context,
      symbols: engine.symbols,
      knowledge: engine.knowledge,
      corpusKnows,
    };

    const strong = audit.run({ ...shared, topScore: 0.08, agreement: 3 });
    const weak = audit.run({ ...shared, topScore: 0.016, agreement: 1 });

    expect(strong.confidence.retrieval).toBeGreaterThan(weak.confidence.retrieval);
    expect(strong.confidence.symbols).toBe(1);
  });

  it("tells the retry exactly what to fix", async () => {
    const result = await check("how do I compare objects?", "Use `JIT.compare.deepEqual(User)`. [1]");
    const instruction = retryInstruction(result.findings, engine.symbols);

    expect(instruction).toContain("JIT.compare.deepEqual");
    expect(instruction).toMatch(/does not exist|not part of the library/);
  });
});

describe("context", () => {
  let engine: KnowledgeEngine;
  let contextService: ContextService;

  beforeAll(async () => {
    const result = await build({
      embed: false,
      verifyExamples: false,
      write: false,
      quiet: true,
    });
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
    contextService = new ContextService({
      knowledge: engine.knowledge,
      routes: engine.routes,
      symbols: engine.symbols,
    });
  }, 120_000);

  const contextFor = async (question: string) => {
    const report = await engine.retriever.retrieve(question, {
      context: { locale: "en" },
    });
    return contextService.build({
      question,
      locale: "en",
      report,
      reservedTokens: promptOverhead(engine.symbols, {
        question,
        exactSymbols: report.exactSymbols,
      }),
      budget: CONTEXT_BUDGET.hard,
    });
  };

  it("keeps the whole rendered prompt inside the budget", async () => {
    // The budget covers the prompt, not the documentation half of it. Counting
    // only the passages is how a "1,093 token" context rendered as 2,307.
    for (const question of [
      "how do I validate a uuid?",
      "why is jit fast?",
      "how do I use JIT.compare.deepEqual?",
      "como filtrar uma lista grande?",
    ]) {
      const context = await contextFor(question);
      const messages = renderMessages(context, { symbols: engine.symbols });
      const tokens = estimateTokens(messages.map((message) => message.content).join("\n"));

      expect(tokens, `${question} rendered ${tokens} tokens`).toBeLessThanOrEqual(CONTEXT_BUDGET.hard);
      expect(renderedSize(messages)).toBeGreaterThan(0);
    }
  }, 60_000);

  it("never shows two slices of one passage", async () => {
    const context = await contextFor("how does jit compile schemas?");
    const ids = context.evidence.map((evidence) => evidence.knowledgeId);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("numbers the sources so a citation resolves", async () => {
    const context = await contextFor("how do I mask a field?");

    expect(context.evidence.map((evidence) => evidence.index)).toEqual(
      context.evidence.map((_evidence, index) => index + 1)
    );

    for (const evidence of context.evidence) {
      expect(contextService.pathFor(evidence, "en")).toMatch(/^\/docs\//);
      expect(contextService.entryFor(evidence)).toBeDefined();
    }
  });

  it("says so, rather than answering, when retrieval returned nothing at all", async () => {
    // Narrow by design: this fires only where there is genuinely nothing, and
    // the grounding validator carries every case where retrieval returned
    // something irrelevant. A score threshold cannot tell those apart.
    const context = await contextFor("what is the weather today?");
    expect(context.empty).toBe(true);

    const messages = renderMessages(context, { symbols: engine.symbols });
    // The prompt asks for the refusal instead of carrying the rules that would
    // let the model produce an answer.
    expect(messages[0].content).toMatch(/does not cover this question/);
    expect(messages[0].content).not.toMatch(/API SURFACE/);
  });

  it("states the real members when the question names an API that does not exist", async () => {
    const context = await contextFor("how do I use JIT.compare.deepEqual?");
    const system = renderMessages(context, { symbols: engine.symbols })[0].content;

    expect(system).toContain("JIT.compare.deepEqual does not exist");
    expect(system).toMatch(/JIT\.compare has: changed, diff, equal, hash/);
  });
});

describe("actions", () => {
  const evidence = [
    {
      index: 1,
      routeId: "route.docs.reference.functions.mask",
      breadcrumb: "mask › Fields",
      anchor: "fields",
    },
    { index: 2, routeId: "route.docs.quick-start", breadcrumb: "Quick start" },
  ] as never as Parameters<typeof parseActions>[0]["evidence"];

  const routes = { resolve: () => "/docs" } as never as Parameters<typeof parseActions>[0]["routes"];

  it("turns a tag into a structured action and strips it from the prose", () => {
    const parsed = parseActions({
      answer: "Use the mask reference. [[go:route.docs.reference.functions.mask]]",
      evidence,
      routes,
      locale: "en",
    });

    expect(parsed.text).toBe("Use the mask reference.");
    expect(parsed.actions).toEqual([
      {
        type: "navigate",
        routeId: "route.docs.reference.functions.mask",
        anchor: "fields",
        label: "Open mask",
      },
    ]);
  });

  it("drops a route the answer was never shown", () => {
    // §82: the allowlist is the sources, not the registry. A model naming a
    // real page it never saw is guessing.
    const parsed = parseActions({
      answer: "See [[go:route.docs.reference.functions.equal]] for more.",
      evidence,
      routes,
      locale: "en",
    });

    expect(parsed.actions).toEqual([]);
    expect(parsed.rejected).toEqual(["route.docs.reference.functions.equal"]);
  });

  it("refuses anything that is not a route id", () => {
    const parsed = parseActions({
      answer: "Go to [[go:/docs/../../etc/passwd]] and [[go:https://example.com]].",
      evidence,
      routes,
      locale: "en",
    });

    expect(parsed.actions).toEqual([]);
    expect(parsed.rejected).toHaveLength(2);
  });

  it("holds back a half-written tag while streaming", () => {
    const parsed = parseActions({
      answer: "Use the mask reference. [[go:route.docs.refe",
      evidence,
      routes,
      locale: "en",
      streaming: true,
    });

    expect(parsed.text).toBe("Use the mask reference.");
  });
});
