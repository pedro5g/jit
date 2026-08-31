/**
 * Text generation, behind one interface.
 *
 * The plan's criterion for this layer is that swapping the model changes no
 * use case (§100). That is only true if the port hides three things models
 * disagree about: how a conversation is framed, how a schema-constrained reply
 * is requested, and how streaming is delivered. All three are here.
 */

export interface GenerationMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerationRequest {
  messages: GenerationMessage[];
  maxTokens: number;
  /** 0 for anything the audit will check against a fixed surface. */
  temperature: number;
  /**
   * A JSON shape the reply must match.
   *
   * Advisory: a backend that can constrain decoding does, and one that cannot
   * puts the shape in the prompt. Either way the caller parses and validates
   * the result with JIT — the port never promises the model obeyed.
   */
  responseSchema?: unknown;
  signal: AbortSignal;
}

export interface GenerationResult {
  text: string;
  /** Why generation ended — `length` is the one that needs a retry. */
  finish: "stop" | "length" | "aborted";
  usage?: { promptTokens?: number; completionTokens?: number };
  timings?: { ttftMs: number; totalMs: number; tokensPerSecond: number };
}

export interface LanguageModelPort {
  readonly id: string;
  readonly label: string;
  generate(request: GenerationRequest): Promise<GenerationResult>;
  /** Deltas, for the streaming UI. Resolves to the same result as `generate`. */
  stream(request: GenerationRequest, onDelta: (delta: string) => void): Promise<GenerationResult>;
}
