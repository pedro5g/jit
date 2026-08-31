/**
 * Natural language in, a schema file out — §102's phase, end to end.
 *
 * The criterion the plan sets for this phase is one sentence: the model does
 * not write arbitrary jit API. Everything below enforces that structurally
 * rather than by instruction — the model emits JSON, the JSON is validated by
 * jit, every name in it is checked against the symbol index, the intent is
 * built as a real schema, and only then is any code written, by an emitter
 * that takes no strings from the model.
 *
 * The other rule is §58's: exactly one retry, and a refusal rather than a
 * guess. A schema that is nearly right is worse than no schema, because it is
 * the kind of wrong a reader pastes into a project and discovers later.
 */
import { schemaRetryTurn, schemaSystemPrompt, schemaUserTurn } from "../../config/schema-prompt";
import type { SchemaIntent } from "../../core/entities/schema-intent";
import type { GenerationMessage, LanguageModelPort } from "../../core/ports/language-model";
import { type LoggerPort, silentLogger } from "../../core/ports/logger";
import type { SymbolRepository } from "../../core/repositories";
import { buildSchema } from "./build-schema";
import { generateSchemaFile } from "./generate-code";
import { parseSchemaIntent } from "./intent-schema";
import { type IntentFinding, verifyIntent } from "./verify-intent";

/** Tokens a schema gets. A shape that needs more than this is not one request. */
const MAX_SCHEMA_TOKENS = 500;

export interface SchemaRequest {
  request: string;
  entrypoint?: "runtime" | "define";
  signal?: AbortSignal;
}

export interface SchemaSuccess {
  ok: true;
  intent: SchemaIntent;
  code: string;
  /** True when the first attempt was rejected and the second one passed. */
  retried: boolean;
}

export interface SchemaFailure {
  ok: false;
  /** Where it stopped, which is what a benchmark counts (§74). */
  stage: "json" | "shape" | "api" | "build";
  issues: string[];
  retried: boolean;
  /** The last intent that parsed, when one did. Useful for a debug panel. */
  intent?: SchemaIntent;
}

export type SchemaResult = SchemaSuccess | SchemaFailure;

export interface SchemaServiceDeps {
  symbols: SymbolRepository;
  logger?: LoggerPort;
}

export class SchemaService {
  private readonly logger: LoggerPort;

  constructor(private readonly deps: SchemaServiceDeps) {
    this.logger = deps.logger ?? silentLogger;
  }

  async generate(input: SchemaRequest, model: LanguageModelPort): Promise<SchemaResult> {
    const signal = input.signal ?? new AbortController().signal;
    const messages: GenerationMessage[] = [
      { role: "system", content: schemaSystemPrompt(this.deps.symbols) },
      { role: "user", content: schemaUserTurn(input.request) },
    ];

    this.logger.emit({ type: "generation.started", model: model.id });

    const first = await model.generate({ messages, maxTokens: MAX_SCHEMA_TOKENS, temperature: 0, signal });
    const attempt = this.attempt(first.text, input);
    if (attempt.ok) return { ...attempt, retried: false };

    if (signal.aborted) return { ...attempt, retried: false };

    const corrected: GenerationMessage[] = [
      ...messages,
      { role: "assistant", content: first.text },
      { role: "user", content: schemaRetryTurn(attempt.issues) },
    ];

    const second = await model.generate({
      messages: corrected,
      maxTokens: MAX_SCHEMA_TOKENS,
      temperature: 0,
      signal,
    });

    const retry = this.attempt(second.text, input);

    this.logger.emit({ type: "generation.finished", finish: second.finish, ms: 0 });

    // The first failure is reported when the second one is no better: it is
    // the one the reader's request actually produced, and the second is
    // usually the same JSON with a different comma.
    return retry.ok
      ? { ...retry, retried: true }
      : { ...(retry.issues.length <= attempt.issues.length ? retry : attempt), retried: true };
  }

  /**
   * One reply, taken as far as it goes.
   *
   * Public because the benchmark scores replies it already collected, and
   * because a test that has to run a model to check the parser is a test
   * nobody runs.
   */
  attempt(reply: string, input: Pick<SchemaRequest, "entrypoint"> = {}): SchemaResult {
    const parsed = parseSchemaIntent(reply);
    if (!parsed.ok) return { ok: false, stage: parsed.stage, issues: parsed.issues, retried: false };

    const findings = verifyIntent(parsed.intent, { symbols: this.deps.symbols });
    if (findings.length > 0) {
      return { ok: false, stage: "api", issues: findings.map(describe), retried: false, intent: parsed.intent };
    }

    // The library's own answer to "would this build". Cheap, and the only
    // check here that no amount of index drift can fool.
    const built = buildSchema(parsed.intent);
    if (!built.ok) {
      return {
        ok: false,
        stage: "build",
        issues: [`${built.path}: ${built.error}`],
        retried: false,
        intent: parsed.intent,
      };
    }

    return {
      ok: true,
      intent: parsed.intent,
      code: generateSchemaFile(parsed.intent, input.entrypoint ? { entrypoint: input.entrypoint } : {}),
      retried: false,
    };
  }
}

function describe(finding: IntentFinding): string {
  const suggestions = finding.suggestions?.length ? ` — try ${finding.suggestions.join(", ")}` : "";
  return `${finding.path}: ${finding.message}${suggestions}`;
}
