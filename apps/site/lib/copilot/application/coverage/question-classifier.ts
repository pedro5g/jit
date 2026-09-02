import type { AnswerMode, QuestionScope } from "../../core/entities/coverage";
import type { RetrievalReport } from "../../core/entities/retrieval";

const NAVIGATE = /\b(?:open|show me|take me|go to|where is|find|abra|abre|mostre|onde fica|encontre)\b/i;
// A conceptual question can mention "generated code" without requesting a
// code block. Require an action/example cue instead of treating the noun
// itself as a code request.
const CODE =
  /\b(?:write|show|give|provide|generate|implement|create|snippet|example|sample|implemente|escreva|gere|exemplo|trecho)\b/i;
const BROAD_FORM =
  /\b(?:why|how|when|architecture|overview|internals?|difference|por que|porque|como|quando|arquitetura|vis[aã]o geral|internamente|diferen[cç]a)\b/i;
const CONCEPTUAL_WHAT =
  /\b(?:what does .{1,100} mean|what happens|what comes out|o que significa|o que acontece|o que sai)\b/i;
const FOCUSED_HOW_TO = /\b(?:how do i|how can i|como (?:eu )?(?:posso|fa[cç]o|uso|usar|valido|validar))\b/i;
const DEEP_FORM =
  /\b(?:how .*works?|architecture|overview|internals?|como .*funciona|arquitetura|vis[aã]o geral|internamente)\b/i;

/** Deterministic task classification; query subject names never appear here. */
export function classifyQuestion(
  question: string,
  report: RetrievalReport
): {
  scope: QuestionScope;
  answerMode: AnswerMode;
} {
  if (NAVIGATE.test(question))
    return { scope: report.exactSymbols.length > 0 ? "lookup" : "focused", answerMode: "navigate" };
  if (CODE.test(question)) return { scope: report.exactSymbols.length > 0 ? "lookup" : "focused", answerMode: "code" };

  const routes = new Set(report.results.slice(0, 10).map((result) => result.chunk.routeId)).size;
  const kinds = new Set(report.results.slice(0, 10).map((result) => result.chunk.kind)).size;
  const explicitSymbols = report.explicitSymbols?.length ?? report.exactSymbols.length;
  const broad =
    (BROAD_FORM.test(question) || CONCEPTUAL_WHAT.test(question)) &&
    !FOCUSED_HOW_TO.test(question) &&
    explicitSymbols === 0 &&
    report.results.length > 0 &&
    (routes >= 2 || kinds >= 2 || report.exactSymbols.length === 0);

  if (broad) return { scope: "broad", answerMode: DEEP_FORM.test(question) ? "deep-explain" : "explain" };
  if (report.exactSymbols.length > 0) return { scope: "lookup", answerMode: "lookup" };
  return { scope: "focused", answerMode: "explain" };
}
