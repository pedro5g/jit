/**
 * The six tools, each one a deterministic read — §46.
 *
 * Nothing here asks the model anything, and nothing here can fail in an
 * interesting way: every tool takes a string, looks it up in a repository, and
 * returns text or nothing. A tool that found nothing says so plainly, because
 * "no result" is information the model needs and an empty string is an
 * invitation to invent one.
 *
 * Output is written for a small model to read, not for a machine to parse:
 * short lines, real names, no JSON. The model's job at that point is to quote
 * it, and prose is what it quotes accurately.
 */
import type { ApiSymbol } from "../../core/entities/api-symbol";
import type { ToolCall, ToolName, ToolResult } from "../../core/entities/tool";
import type { KnowledgeRepository, RouteRepository, SymbolRepository } from "../../core/repositories";
import { parseRouteId } from "../../core/value-objects/ids";
import type { Locale } from "../../core/value-objects/locale";
import type { HybridRetriever } from "../retrieval/hybrid-retriever";

export interface ToolContext {
  symbols: SymbolRepository;
  knowledge: KnowledgeRepository;
  routes: RouteRepository;
  retriever: HybridRetriever;
  locale: Locale;
}

/** How much of a passage a tool may put back into the conversation. */
const EXCERPT = 320;

type Handler = (input: string, context: ToolContext) => Promise<string> | string;

function excerpt(text: string, limit = EXCERPT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit).trimEnd()}…`;
}

function describeSymbol(symbol: ApiSymbol): string {
  const signature = symbol.signatures[0] ? ` — ${symbol.signatures[0]}` : "";
  const purpose = symbol.purpose ? ` ${symbol.purpose}` : "";
  return `${symbol.path}${signature}${purpose}`.trim();
}

const HANDLERS: Record<ToolName, Handler> = {
  /**
   * The same retriever the answer path uses, without the embedder.
   *
   * A tool call happens mid-generation, and embedding a query there costs a
   * second of a reader's attention for a ranking improvement that lexical and
   * symbol retrieval mostly already have. The main retrieval, which does have
   * the vector, has already run.
   */
  async searchKnowledge(input, context) {
    const report = await context.retriever.retrieve(input, {
      context: { locale: context.locale },
      queryVector: null,
      limit: 4,
    });

    if (report.results.length === 0) return "";

    return report.results
      .slice(0, 3)
      .map((result) => `- ${result.chunk.breadcrumb} (${result.chunk.routeId}): ${excerpt(result.chunk.content, 200)}`)
      .join("\n");
  },

  lookupSymbol(input, context) {
    const exact = context.symbols.findByPath(input) ?? context.symbols.findExact(input);
    if (exact) return describeSymbol(exact);

    const near = context.symbols.search(input, 4);
    if (near.length === 0) return "";

    return `no API called ${input}. The closest real names are: ${near.map((match) => match.symbol.path).join(", ")}`;
  },

  getSymbolDocumentation(input, context) {
    const symbol = context.symbols.findByPath(input) ?? context.symbols.findExact(input);
    if (!symbol) return "";

    const entries = context.knowledge.bySymbol(symbol.id).slice(0, 2);
    if (entries.length === 0) return `${symbol.path} exists but is not documented.`;

    return entries.map((entry) => `${entry.title}: ${excerpt(entry.content)}`).join("\n");
  },

  getExamples(input, context) {
    const symbol = context.symbols.findByPath(input) ?? context.symbols.findExact(input);
    if (!symbol) return "";

    const entries = context.knowledge.findMany(symbol.examples.slice(0, 2));
    const blocks = entries
      .flatMap((entry) => [...entry.content.matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/g)].map((match) => match[1]))
      .filter((block): block is string => Boolean(block))
      .slice(0, 2);

    if (blocks.length === 0) return "";
    return blocks.map((block) => block.trim()).join("\n\n");
  },

  /**
   * Resolution, not navigation.
   *
   * The tool answers "is this route real, and what is it called" — the actual
   * move is a `CopilotAction` the UI performs after the answer is audited.
   * Nothing in the model's path is allowed to change the page mid-sentence.
   */
  navigate(input, context) {
    const routeId = parseRouteId(input);
    const entry = routeId ? context.routes.find(routeId) : undefined;
    if (!routeId || !entry) return "";

    const path = context.routes.resolve(routeId, context.locale);
    return `${routeId} is ${entry.title}${path ? ` at ${path}` : ""}. Offer it with [[go:${routeId}]].`;
  },

  openSection(input) {
    const heading = input.trim();
    if (!heading) return "";
    return `Point at it with [[show:${heading}]].`;
  },
};

export async function runTool(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const handler = HANDLERS[call.name];
  const output = await handler(call.input.trim(), context);
  return { call, output, hit: output.trim().length > 0 };
}
