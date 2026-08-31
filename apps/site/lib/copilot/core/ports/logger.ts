/**
 * Structured events, per §90 of the plan.
 *
 * Names rather than sentences, so the debug panel can filter and the eval
 * runner can assert. Deliberately carries no question text and no answer text:
 * §91 makes the questions local, and an event stream that quotes them is the
 * one place that promise would leak.
 */
export type CopilotEvent =
  | { type: "query.received"; locale: string; length: number }
  | { type: "retrieval.finished"; results: number; exactSymbols: number; ms: number }
  | { type: "context.built"; chunks: number; approximateTokens: number }
  | { type: "generation.started"; model: string }
  | { type: "generation.finished"; finish: string; ms: number; tokensPerSecond?: number }
  | { type: "audit.finished"; valid: boolean; findings: number }
  | { type: "tool.called"; tool: string; ok: boolean }
  | { type: "navigation.executed"; routeId: string };

export interface LoggerPort {
  emit(event: CopilotEvent): void;
}

/** The default. Events cost nothing when nobody is listening. */
export const silentLogger: LoggerPort = { emit: () => {} };
