/**
 * The copilot's worker protocol.
 *
 * Narrower than the one it replaces, because the copilot no longer embeds the
 * documentation in the browser — the vectors ship precompiled. All that is
 * left on this side is one query embedding per question, which changes what
 * the protocol has to carry: no batching, no progress over thousands of
 * chunks, and a `vector` message instead of a `vectors` one.
 */

import type { GenerationMessage } from "../../core/ports/language-model.js";

export type CopilotWorkerRequest =
  | { id: number; type: "preload-generation"; repo: string; dtype: string }
  | { id: number; type: "preload-embedding"; repo: string; dtype: string }
  | {
      id: number;
      type: "generate";
      repo: string;
      dtype: string;
      maxTokens: number;
      /** 0 for anything the audit checks against a fixed surface. */
      temperature: number;
      topP?: number;
      topK?: number;
      presencePenalty?: number;
      repetitionPenalty?: number;
      decodingId?: string;
      messages: GenerationMessage[];
    }
  | { id: number; type: "abort" }
  | { id: number; type: "embed-query"; repo: string; dtype: string; text: string };

export type CopilotWorkerResponse =
  /** Bytes transferred so far; the client owns the total. */
  | { id: number; type: "progress"; loadedBytes: number }
  | { id: number; type: "delta"; text: string }
  /** Time to first token, so §76's latency numbers come from the real path. */
  | { id: number; type: "first-token"; ms: number }
  | { id: number; type: "vector"; data: Float32Array }
  | {
      id: number;
      type: "done";
      finish: "stop" | "length" | "aborted";
      tokens: number;
      ms: number;
      promptTokens?: number;
    }
  | { id: number; type: "result" }
  | { id: number; type: "error"; message: string };
