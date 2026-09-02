import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { build } from "../../../scripts/knowledge/build";
import { AuditService, StrictAuditPolicy } from "../application/audit/audit.service";
import { ContextService } from "../application/context/context.service";
import { acceptedHistory } from "../application/context/history";
import { promptOverhead, renderMessages } from "../application/context/render";
import { CopilotService } from "../application/services/copilot.service";
import { parseToolCalls, stripToolCalls } from "../application/tools/parse-tool-calls";
import { runTool } from "../application/tools/registry";
import type { GenerationRequest, GenerationResult, LanguageModelPort } from "../core/ports/language-model";
import { executableBlocks, prepareSnippet } from "../infrastructure/examples/snippet-safety";
import type { KnowledgeEngine } from "../infrastructure/knowledge-engine";
import { createKnowledgeEngine } from "../infrastructure/knowledge-engine";
import { MemoryArtifactLoader } from "../infrastructure/storage/memory-artifact-loader";
import { asksForSchema, CopilotController } from "../presentation/controllers/copilot.controller";

class ScriptedModel implements LanguageModelPort {
  readonly id = "scripted";
  readonly label = "Scripted";
  readonly requests: GenerationRequest[] = [];

  constructor(private readonly replies: string[]) {}

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    this.requests.push(request);
    return {
      text: this.replies[this.requests.length - 1] ?? "",
      finish: "stop",
    };
  }

  async stream(request: GenerationRequest, onDelta: (delta: string) => void): Promise<GenerationResult> {
    const result = await this.generate(request);
    onDelta(result.text);
    return result;
  }
}

let engine: KnowledgeEngine;
let loader: MemoryArtifactLoader;

beforeAll(async () => {
  const result = await build({
    embed: false,
    verifyExamples: false,
    write: false,
    quiet: true,
  });
  loader = new MemoryArtifactLoader({
    manifest: result.manifest,
    entries: result.entries,
    chunks: result.chunks,
    symbols: result.symbols,
    routes: result.routes,
    relations: result.relations,
    lexical: result.lexical,
  });
  engine = await createKnowledgeEngine(loader);
}, 120_000);

describe("tool protocol", () => {
  it("teaches the model the same closed tool tags the parser accepts", async () => {
    const question = "What does JIT.validate.safeParse do?";
    const report = await engine.retriever.retrieve(question, {
      context: { locale: "en" },
    });
    const context = new ContextService({
      knowledge: engine.knowledge,
      routes: engine.routes,
      symbols: engine.symbols,
    }).build({
      question,
      locale: "en",
      report,
      reservedTokens: promptOverhead(engine.symbols, {
        question,
        exactSymbols: report.exactSymbols,
      }),
    });
    const prompt = renderMessages(context, { symbols: engine.symbols })[0]?.content ?? "";

    expect(prompt).toContain("[[api:JIT.exact.path]]");
    expect(prompt).toContain("[[find:short topic]]");
  });

  it("accepts only closed, allowlisted call tags and deduplicates them", () => {
    expect(parseToolCalls("[[api:JIT.string.uuid]] [[api:JIT.string.uuid]] [[shell:rm -rf /]] [[find:uuid]]")).toEqual([
      { name: "lookupSymbol", input: "JIT.string.uuid" },
      { name: "searchKnowledge", input: "uuid" },
    ]);
    expect(stripToolCalls("Look [[api:JIT.string.uuid]] here")).toBe("Look here");
  });

  it("reads a real symbol and never synthesizes one", async () => {
    const found = await runTool(
      { name: "lookupSymbol", input: "JIT.string().uuid()" },
      {
        symbols: engine.symbols,
        knowledge: engine.knowledge,
        routes: engine.routes,
        retriever: engine.retriever,
        locale: "en",
      }
    );
    const missing = await runTool(
      { name: "lookupSymbol", input: "JIT.string.notEmpty" },
      {
        symbols: engine.symbols,
        knowledge: engine.knowledge,
        routes: engine.routes,
        retriever: engine.retriever,
        locale: "en",
      }
    );

    expect(found.hit).toBe(true);
    expect(found.output).toContain("JIT.string().uuid");
    expect(missing.output).not.toContain("JIT.string.notEmpty —");
  });
});

describe("answer example execution", () => {
  it("extracts executable blocks and rejects ambient browser capabilities", () => {
    expect(executableBlocks("```ts\nconst schema = JIT.string();\n```")).toEqual(["const schema = JIT.string();"]);
    expect(prepareSnippet("const schema = JIT.string();")).toEqual({
      ok: true,
      code: "const schema = JIT.string();",
    });
    expect(prepareSnippet("JIT.string(); fetch('/secret')")).toMatchObject({
      ok: false,
    });
    expect(prepareSnippet("const value = 1")).toMatchObject({ ok: false });
  });

  it("fails closed when a generated example does not execute", async () => {
    const service = new CopilotService({
      engine,
      context: new ContextService({
        knowledge: engine.knowledge,
        routes: engine.routes,
        symbols: engine.symbols,
      }),
      audit: new AuditService(),
      policy: new StrictAuditPolicy(false),
      examples: {
        verify: async () => ({
          ok: false,
          error: "safeParse is not a function",
        }),
      },
    });
    const model = new ScriptedModel(["Use this example. [1]\n\n```ts\nconst schema = JIT.string().notReal();\n```"]);

    const answer = await service.ask({ question: "how do I validate a uuid?" }, model, null);

    expect(answer.rejected).toBe(true);
    expect(answer.text).toContain("documentation grounds the answer");
    expect(answer.audit.findings.some((finding) => finding.kind === "invalid-example")).toBe(true);
  });

  it("does not stream unaudited model text", async () => {
    const service = new CopilotService({
      engine,
      context: new ContextService({
        knowledge: engine.knowledge,
        routes: engine.routes,
        symbols: engine.symbols,
      }),
      audit: new AuditService(),
      policy: new StrictAuditPolicy(false),
    });
    const model = new ScriptedModel(["The library was created by A Fictional Founder in 2020."]);
    const deltas: string[] = [];

    const answer = await service.ask(
      { question: "why is jit fast?", locale: "en", onDelta: (delta) => deltas.push(delta) },
      model,
      null
    );

    expect(deltas).toEqual([answer.text]);
    expect(deltas.join()).not.toContain("Fictional Founder");
  });
});

describe("conversation history", () => {
  it("never feeds rejected prose or its paired question into the next answer", () => {
    expect(
      acceptedHistory([
        { role: "user", content: "first" },
        { role: "assistant", content: "grounded" },
        { role: "user", content: "why is it fast?" },
        {
          role: "assistant",
          content: "invented runtime claim",
          rejected: true,
        },
        { role: "user", content: "follow-up" },
      ])
    ).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "grounded" },
      { role: "user", content: "follow-up" },
    ]);
  });
});

describe("bounded tool loop", () => {
  function service() {
    return new CopilotService({
      engine,
      context: new ContextService({
        knowledge: engine.knowledge,
        routes: engine.routes,
        symbols: engine.symbols,
      }),
      audit: new AuditService(),
    });
  }

  it("feeds deterministic results back to the model and hides call tags", async () => {
    const model = new ScriptedModel([
      "[[api:JIT.validate.safeParse]]",
      "JIT.validate.safeParse returns a structured result rather than throwing. [1]",
    ]);

    const answer = await service().ask({ question: "What does JIT.validate.safeParse do?" }, model, null);

    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.messages.at(-1)?.content).toContain("JIT.validate.safeParse");
    expect(answer.text).not.toContain("[[api:");
  });

  it("runs at most four calls even when the model asks for more", async () => {
    const model = new ScriptedModel([
      ["string", "number", "boolean", "date", "bigint"].map((name) => `[[api:JIT.${name}]]`).join(" "),
      "The requested API names were checked.",
    ]);

    await service().ask({ question: "Check these schema factories" }, model, null);

    const toolTurn = model.requests[1]?.messages.at(-1)?.content ?? "";
    expect(toolTurn.match(/\[lookupSymbol:/g)).toHaveLength(4);
    expect(toolTurn).not.toContain("JIT.bigint");
  });

  it("does not invoke a model when the corpus does not cover the subject", async () => {
    const model = new ScriptedModel(["JIT connects through a PostgreSQL adapter."]);

    const answer = await service().ask({ question: "how do I connect jit to postgres?" }, model, null);

    expect(model.requests).toHaveLength(0);
    expect(answer.insufficientEvidence).toBe(true);
    expect(answer.text).toContain("no evidence");
  });

  it("keeps evidence for a covered conceptual question written in Portuguese", async () => {
    const model = new ScriptedModel([
      "A geração especializada emite acesso direto a propriedades e loops indexados. [1]",
    ]);

    const answer = await service().ask(
      {
        question: "como funciona a geração de código especializado?",
        locale: "pt-BR",
      },
      model,
      null
    );

    expect(model.requests).toHaveLength(1);
    expect(answer.insufficientEvidence).toBe(false);
    expect(answer.evidence.length).toBeGreaterThan(0);
  });
});

describe("browser controller", () => {
  it("routes schema construction intent without stealing conceptual schema questions", () => {
    expect(asksForSchema("create a schema for a user")).toBe(true);
    expect(asksForSchema("Explain what this schema compiles to")).toBe(false);
    expect(asksForSchema("what happens from a schema to a compiled operation?")).toBe(false);
  });

  it("does not impose a model-tier policy on conceptual synthesis", async () => {
    const source = readFileSync(
      path.resolve(import.meta.dirname, "../presentation/controllers/copilot.controller.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/current\.tier\s*===\s*["']light["']/);
  });

  it("keeps retrieval useful without a loaded model", async () => {
    const controller = new CopilotController(loader);
    const response = await controller.ask({
      question: "how do I validate a uuid?",
      currentPath: "/docs",
    });

    expect(response.kind).toBe("search");
    if (response.kind !== "search") return;
    expect(response.context.evidence.length).toBeGreaterThan(0);
    expect(response.report.exactSymbols.some((symbol) => symbol.path.includes("uuid"))).toBe(true);
    controller.dispose();
  });
});
