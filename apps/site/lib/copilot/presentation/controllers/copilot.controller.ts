/**
 * The browser-facing facade for the complete copilot.
 *
 * React gets one object with use-case-shaped methods. It never constructs a
 * repository, chooses a model implementation, knows an artifact URL, or calls
 * the schema emitter directly. That keeps the UI replaceable and makes this
 * controller usable by a component test without mounting the component.
 */
import { AuditService, StrictAuditPolicy } from "../../application/audit/audit.service";
import { ContextService } from "../../application/context/context.service";
import { type SchemaResult, SchemaService } from "../../application/schema/schema.service";
import { type AskInput, CopilotService } from "../../application/services/copilot.service";
import { detectEnvironment, ModelService } from "../../application/services/model.service";
import type { CopilotAnswer } from "../../core/entities/answer";
import type { ModelContext } from "../../core/entities/model-context";
import type { RetrievalReport } from "../../core/entities/retrieval";
import type { EmbeddingPort } from "../../core/ports/embedding";
import type { GenerationMessage } from "../../core/ports/language-model";
import type { RouteId } from "../../core/value-objects/ids";
import type { Locale } from "../../core/value-objects/locale";
import { BrowserSnippetVerifier } from "../../infrastructure/examples/browser-snippet-verifier";
import {
  createKnowledgeEngine,
  type KnowledgeEngine,
  type LexicalCapableLoader,
} from "../../infrastructure/knowledge-engine";
import { FetchArtifactLoader } from "../../infrastructure/storage/fetch-artifact-loader";
import { ghostActions, ghostSources } from "../adapters/ghost";

export type CopilotResponse =
  | { kind: "answer"; answer: CopilotAnswer }
  | { kind: "search"; report: RetrievalReport; context: ModelContext }
  | {
      kind: "schema";
      result: SchemaResult;
      report: RetrievalReport;
      context: ModelContext;
    };

export interface ControllerAskInput {
  question: string;
  currentPath?: string;
  selectedText?: string;
  history?: GenerationMessage[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

/**
 * A command to create a schema is routed to constrained generation.
 *
 * This classification does not decide any API fact. A false positive merely
 * asks the model for SchemaIntent instead of prose, and the reader can reword
 * the question; a false negative still goes through the audited answer path.
 */
export function asksForSchema(question: string): boolean {
  const mentionsSchema = /\b(?:schema|esquema)\b/i.test(question);
  const constructionIntent =
    /\b(?:create|make|write|generate|build|declare|define|model|crie|criar|gere|gerar|monte|montar|escreva|defina|definir|modele)\b/i.test(
      question
    );
  return mentionsSchema && constructionIntent;
}

export class CopilotController {
  private engine: KnowledgeEngine | null = null;
  private service: CopilotService | null = null;
  private schema: SchemaService | null = null;
  private embedder: EmbeddingPort | null = null;
  private initialization: Promise<void> | null = null;

  readonly models: ModelService;

  constructor(private readonly loader: LexicalCapableLoader = new FetchArtifactLoader()) {
    this.models = new ModelService(detectEnvironment(false));
  }

  initialize(): Promise<void> {
    this.initialization ??= this.assemble();
    return this.initialization;
  }

  private async assemble(): Promise<void> {
    const engine = await createKnowledgeEngine(this.loader);
    const context = new ContextService({
      knowledge: engine.knowledge,
      routes: engine.routes,
      symbols: engine.symbols,
    });

    this.engine = engine;
    this.models.setVectorAvailability(engine.hasSemanticSearch);
    this.service = new CopilotService({
      engine,
      context,
      audit: new AuditService(),
      // Production is fail-closed: validators detect, this policy decides.
      // Saved benchmark transcripts may still use ShadowAuditPolicy.
      policy: new StrictAuditPolicy(true),
      examples: new BrowserSnippetVerifier(),
    });
    this.schema = new SchemaService({ symbols: engine.symbols });
    await this.models.status();
  }

  private async ready() {
    await this.initialize();
    if (!this.engine || !this.service || !this.schema)
      throw new Error("The copilot knowledge engine did not initialize.");
    return { engine: this.engine, service: this.service, schema: this.schema };
  }

  async prepareEmbedding(onProgress?: (progress: number) => void): Promise<boolean> {
    await this.initialize();
    this.embedder = await this.models.prepareEmbedding(onProgress);
    return this.embedder !== null;
  }

  async ask(input: ControllerAskInput): Promise<CopilotResponse> {
    const { engine, service, schema } = await this.ready();
    const model = this.models.readyModel;
    const route = input.currentPath ? engine.routes.fromPath(input.currentPath) : undefined;
    const request: AskInput = {
      question: input.question,
      ...(route ? { routeId: route.id } : {}),
      ...(input.selectedText ? { selectedText: input.selectedText } : {}),
      ...(input.history ? { history: input.history } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onDelta ? { onDelta: input.onDelta } : {}),
    };

    if (!model) {
      const result = await service.search(request, this.embedder);
      return { kind: "search", ...result };
    }

    if (asksForSchema(input.question)) {
      const found = await service.search(request, this.embedder);
      return {
        kind: "schema",
        ...found,
        result: await schema.generate(
          {
            request: input.question,
            ...(input.signal ? { signal: input.signal } : {}),
          },
          model
        ),
      };
    }

    return {
      kind: "answer",
      answer: await service.ask(request, model, this.embedder),
    };
  }

  routeId(path: string): RouteId | undefined {
    return this.engine?.routes.fromPath(path)?.id;
  }

  present(evidence: ModelContext["evidence"], actions: CopilotAnswer["actions"], locale: Locale) {
    if (!this.engine) return { sources: [], actions: [] };
    return {
      sources: ghostSources(evidence, this.engine.routes, locale),
      actions: ghostActions(actions, this.engine.routes, locale),
    };
  }

  dispose() {
    this.models.dispose();
  }
}
