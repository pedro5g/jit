import { beforeAll, describe, expect, it } from "vitest";
import { build } from "../../../scripts/knowledge/build";
import { AuditService } from "../application/audit/audit.service";
import { ContextService } from "../application/context/context.service";
import { CopilotService } from "../application/services/copilot.service";
import { parseToolCalls, stripToolCalls } from "../application/tools/parse-tool-calls";
import { runTool } from "../application/tools/registry";
import type { GenerationRequest, GenerationResult, LanguageModelPort } from "../core/ports/language-model";
import type { KnowledgeEngine } from "../infrastructure/knowledge-engine";
import { createKnowledgeEngine } from "../infrastructure/knowledge-engine";
import { MemoryArtifactLoader } from "../infrastructure/storage/memory-artifact-loader";
import { CopilotController } from "../presentation/controllers/copilot.controller";

class ScriptedModel implements LanguageModelPort {
  readonly id = "scripted";
  readonly label = "Scripted";
  readonly requests: GenerationRequest[] = [];

  constructor(private readonly replies: string[]) {}

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    this.requests.push(request);
    return { text: this.replies[this.requests.length - 1] ?? "", finish: "stop" };
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
  const result = await build({ embed: false, verifyExamples: false, write: false, quiet: true });
  loader = new MemoryArtifactLoader({
    manifest: result.manifest,
    entries: result.entries,
    chunks: result.chunks,
    symbols: result.symbols,
    routes: result.routes,
    lexical: result.lexical,
  });
  engine = await createKnowledgeEngine(loader);
}, 120_000);

describe("tool protocol", () => {
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

describe("bounded tool loop", () => {
  function service() {
    return new CopilotService({
      engine,
      context: new ContextService({ knowledge: engine.knowledge, routes: engine.routes, symbols: engine.symbols }),
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
});

describe("browser controller", () => {
  it("keeps retrieval useful without a loaded model", async () => {
    const controller = new CopilotController(loader);
    const response = await controller.ask({ question: "how do I validate a uuid?", currentPath: "/docs" });

    expect(response.kind).toBe("search");
    if (response.kind !== "search") return;
    expect(response.context.evidence.length).toBeGreaterThan(0);
    expect(response.report.exactSymbols.some((symbol) => symbol.path.includes("uuid"))).toBe(true);
    controller.dispose();
  });
});
