import type { CodeExampleVerification, CodeExampleVerifierPort } from "../../core/ports/code-example-verifier";
import { executableBlocks } from "./snippet-safety";

const TIMEOUT_MS = 2_500;

export class BrowserSnippetVerifier implements CodeExampleVerifierPort {
  async verify(answer: string, signal: AbortSignal): Promise<CodeExampleVerification> {
    const blocks = executableBlocks(answer);
    if (blocks.length === 0) return { ok: true };
    if (signal.aborted) return { ok: false, error: "Example verification was aborted." };

    let worker: Worker;
    try {
      worker = new Worker(new URL("./snippet.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "The example worker could not start.",
      };
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: CodeExampleVerification) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        worker.terminate();
        resolve(result);
      };
      const abort = () => finish({ ok: false, error: "Example verification was aborted." });
      const timeout = setTimeout(
        () =>
          finish({
            ok: false,
            error: "The example exceeded the 2.5 second execution limit.",
          }),
        TIMEOUT_MS
      );

      signal.addEventListener("abort", abort, { once: true });
      worker.onmessage = (event: MessageEvent<CodeExampleVerification>) => finish(event.data);
      worker.onerror = (event) =>
        finish({
          ok: false,
          error: event.message || "The example worker failed.",
        });
      worker.postMessage({ blocks });
    });
  }
}
