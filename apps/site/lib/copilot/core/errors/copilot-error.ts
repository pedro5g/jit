/**
 * Failures the engine can name.
 *
 * The old assistant threw bare `Error`s with prose messages, so the UI could
 * only ever show the message. Half of these are recoverable in a specific way
 * — a stale artifact wants a reload, a missing model wants the download
 * prompt, an insufficient-evidence result wants the honest answer rather than
 * an error at all — and the code that decides needs a tag, not a sentence.
 */

export type CopilotErrorCode =
  | "artifact-unavailable"
  | "artifact-stale"
  | "artifact-corrupt"
  | "model-unavailable"
  | "generation-failed"
  | "generation-aborted"
  | "invalid-id"
  | "insufficient-evidence";

export class CopilotError extends Error {
  constructor(
    readonly code: CopilotErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "CopilotError";
  }

  /** Whether retrying the same request could plausibly succeed. */
  get recoverable(): boolean {
    return this.code === "artifact-unavailable" || this.code === "generation-failed";
  }
}

export function artifactUnavailable(what: string, cause?: unknown): CopilotError {
  return new CopilotError("artifact-unavailable", `The ${what} could not be loaded.`, { cause });
}

export function artifactStale(expected: string, found: string): CopilotError {
  return new CopilotError(
    "artifact-stale",
    `The knowledge artifacts are from a different build (${found} ≠ ${expected}).`,
    {
      expected,
      found,
    }
  );
}
