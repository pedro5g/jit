import { demonstratesUsage, EXAMPLE_TIMEOUT_MS, type ExampleFailure } from "./example";
import type { ExampleRequest, ExampleResponse } from "./worker/example-protocol";

/**
 * The page's side of the example check.
 *
 * It owns one worker, runs one example at a time, and kills the thread when an
 * example does not come back — which is the only way to end a loop, and the
 * reason this is a worker at all. A verifier that cannot start is not an
 * error: the answer is still audited by every other check, so a browser
 * without workers loses this one and keeps the rest.
 */

export interface ExampleVerifier {
  /** Null when the example runs. */
  verify(code: string): Promise<ExampleFailure | null>;
  dispose(): void;
}

export function createExampleVerifier(): ExampleVerifier {
  let worker: Worker | null = null;
  let nextId = 1;

  const start = (): Worker | null => {
    if (worker) return worker;
    if (typeof Worker === "undefined") return null;

    try {
      worker = new Worker(new URL("./worker/example.worker.ts", import.meta.url));
    } catch {
      worker = null;
    }

    return worker;
  };

  const drop = () => {
    worker?.terminate();
    worker = null;
  };

  return {
    async verify(code) {
      // A block that never calls what it declares needs no thread to judge: it
      // demonstrates nothing whether or not it runs.
      if (!demonstratesUsage(code)) return { kind: "inert" };

      const active = start();
      if (!active) return null;

      const id = nextId++;

      return new Promise<ExampleFailure | null>((resolve) => {
        const timer = setTimeout(() => {
          finish({ kind: "timeout" });
          drop();
        }, EXAMPLE_TIMEOUT_MS);

        const onMessage = (event: MessageEvent<ExampleResponse>) => {
          if (event.data.id !== id) return;
          finish(event.data.failure);
        };
        // a worker that crashed proves nothing about the example
        const onError = () => {
          finish(null);
          drop();
        };

        const finish = (failure: ExampleFailure | null) => {
          clearTimeout(timer);
          active.removeEventListener("message", onMessage as EventListener);
          active.removeEventListener("error", onError);
          resolve(failure);
        };

        active.addEventListener("message", onMessage as EventListener);
        active.addEventListener("error", onError);
        active.postMessage({ id, code } satisfies ExampleRequest);
      });
    },
    dispose: drop,
  };
}
