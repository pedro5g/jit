import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChromeLanguageModel, chromeLanguageModelStatus } from "../infrastructure/models/chrome-language-model.js";

interface FakeSession {
  promptStreaming: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

const originalLanguageModel = Object.getOwnPropertyDescriptor(globalThis, "LanguageModel");

function install(api: unknown) {
  Object.defineProperty(globalThis, "LanguageModel", { configurable: true, value: api });
}

function restore() {
  if (originalLanguageModel) Object.defineProperty(globalThis, "LanguageModel", originalLanguageModel);
  else Reflect.deleteProperty(globalThis, "LanguageModel");
}

function session(chunks: string[] = ["first", " second"]): FakeSession {
  const stream = new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return {
    promptStreaming: vi.fn(() => stream),
    destroy: vi.fn(),
  };
}

describe("Chrome LanguageModel provider", () => {
  beforeEach(() => restore());
  afterEach(() => restore());

  it.each([
    ["unavailable", "unavailable"],
    ["downloadable", "needs-download"],
    ["downloading", "downloading"],
    ["available", "ready"],
  ] as const)("maps API availability %s to %s", async (availability, expected) => {
    install({ availability: vi.fn(async () => availability) });
    await expect(chromeLanguageModelStatus()).resolves.toBe(expected);
  });

  it("prepares a downloadable model and reports the API's progress fraction", async () => {
    const prepared = session([]);
    let downloadListener: ((event: { loaded: number }) => void) | undefined;
    install({
      availability: vi.fn(async () => "downloadable"),
      create: vi.fn(
        async (options: {
          monitor?: (monitor: {
            addEventListener: (type: "downloadprogress", listener: (event: { loaded: number }) => void) => void;
          }) => void;
        }) => {
          options.monitor?.({
            addEventListener: (_type: "downloadprogress", listener: (event: { loaded: number }) => void) => {
              downloadListener = listener;
            },
          });
          downloadListener?.({ loaded: 0.25 });
          return prepared;
        }
      ),
    });

    const progress: number[] = [];
    await expect(new ChromeLanguageModel().initialize((fraction) => progress.push(fraction))).resolves.toBe(
      "available"
    );
    expect(progress).toEqual([0.25]);
    expect(prepared.destroy).toHaveBeenCalledOnce();
  });

  it("records API creation rejection as runtime unavailability", async () => {
    install({
      availability: vi.fn(async () => "downloadable"),
      create: vi.fn(async () => {
        throw new Error("hardware requirements not met");
      }),
    });

    const provider = new ChromeLanguageModel();
    await expect(provider.initialize()).resolves.toBe("unavailable");
    expect(provider.lastAvailabilityDetail).toBe("hardware requirements not met");
  });

  it("uses initial prompts, streams the answer and destroys the session", async () => {
    const prepared = session();
    const create = vi.fn(async () => prepared);
    install({ availability: vi.fn(async () => "available"), create });

    const deltas: string[] = [];
    const result = await new ChromeLanguageModel().stream(
      {
        messages: [
          { role: "system", content: "Answer from evidence." },
          { role: "user", content: "Why is JIT fast?" },
        ],
        maxTokens: 512,
        temperature: 0,
        signal: new AbortController().signal,
      },
      (delta) => deltas.push(delta)
    );

    expect(create).toHaveBeenCalledWith({
      initialPrompts: [{ role: "system", content: "Answer from evidence." }],
      signal: expect.any(AbortSignal),
    });
    expect(prepared.promptStreaming).toHaveBeenCalledWith("Why is JIT fast?", { signal: expect.any(AbortSignal) });
    expect(deltas.join("")).toBe("first second");
    expect(result).toMatchObject({ text: "first second", finish: "stop" });
    expect(result.timings?.totalMs).toBeGreaterThanOrEqual(0);
    expect(prepared.destroy).toHaveBeenCalledOnce();
  });

  it("turns an explicit provider abort into an aborted result", async () => {
    let controller: ReadableStreamDefaultController<string> | undefined;
    const active = {
      promptStreaming: vi.fn(
        () =>
          new ReadableStream<string>({
            start(value) {
              controller = value;
            },
          })
      ),
      destroy: vi.fn(() => controller?.error(new Error("destroyed"))),
    };
    install({ availability: vi.fn(async () => "available"), create: vi.fn(async () => active) });

    const provider = new ChromeLanguageModel();
    const pending = provider.stream(
      {
        messages: [{ role: "user", content: "Explain JIT." }],
        maxTokens: 512,
        temperature: 0,
        signal: new AbortController().signal,
      },
      () => {}
    );
    await Promise.resolve();
    await Promise.resolve();
    provider.abort();

    await expect(pending).resolves.toMatchObject({ text: "", finish: "aborted" });
    expect(active.destroy).toHaveBeenCalled();
  });
});
