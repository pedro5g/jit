import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AOT, JIT, Tooling } from "../../packages/jit/src/index.js";

const root = mkdtempSync(join("/tmp", "jit-agent-eval-"));
const context = { root };
const UserId = JIT.string().uuid();
const User = JIT.object({ id: UserId, name: JIT.string().min(2), email: JIT.string().email() });
AOT.generate({
  artifacts: { parseUser: JIT.validate.parse(User), isUser: JIT.validate.is(User) },
  schemas: { UserId, User },
  outDir: join(root, "generated"),
  format: "ts",
  emitManifest: true,
});

const core = Tooling.createArtifactToolCore();
const source = readFileSync(join(root, "generated", "index.ts"), "utf8");
const tasks = [
  { tool: "jit_artifact_find", input: { declaration: "User" } },
  { tool: "jit_artifact_describe", input: { symbol: "parseUser" } },
  { tool: "jit_artifact_dependencies", input: { symbol: "UserId" } },
  { tool: "jit_artifact_find", input: { capability: "parse" } },
  { tool: "jit_artifact_status", input: {} },
] as const;

interface Evaluation {
  readonly mode: "source-driven" | "manifest-driven";
  readonly toolCalls: number;
  readonly generatedSourceReads: number;
  readonly sourceBytesRead: number;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
}

function estimateTokens(value: unknown): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4);
}

async function run(mode: Evaluation["mode"]): Promise<Evaluation> {
  let toolCalls = 0;
  let generatedSourceReads = 0;
  let sourceBytesRead = 0;
  let estimatedInputTokens = 0;
  let estimatedOutputTokens = 0;

  for (const task of tasks) {
    toolCalls++;
    estimatedInputTokens += estimateTokens(task.input);
    const result = await core.execute(task.tool, task.input, context);
    assertGoldenAnswer(task.tool, result.data);
    estimatedOutputTokens += estimateTokens(result.data);
    if (mode === "source-driven") {
      toolCalls++;
      generatedSourceReads++;
      sourceBytesRead += Buffer.byteLength(source);
      estimatedInputTokens += estimateTokens({ path: "index.ts", content: source });
      const read = await core.execute("jit_source_read", { path: "index.ts" }, context);
      estimatedOutputTokens += estimateTokens(read.data);
    }
  }

  return {
    mode,
    toolCalls,
    generatedSourceReads,
    sourceBytesRead,
    estimatedInputTokens,
    estimatedOutputTokens,
  };
}

function assertGoldenAnswer(tool: (typeof tasks)[number]["tool"], data: unknown): void {
  if (!isRecord(data) || data.status !== "clean") throw new Error(`${tool} did not return a clean artifact answer`);
  if (tool === "jit_artifact_find") {
    if (!Array.isArray(data.matches) || data.matches.length === 0) throw new Error(`${tool} returned no match`);
    return;
  }
  if (tool === "jit_artifact_describe") {
    if (!isRecord(data.symbol) || data.symbol === null) throw new Error(`${tool} returned no symbol`);
    return;
  }
  if (tool === "jit_artifact_dependencies") {
    if (!Array.isArray(data.dependencies) || !Array.isArray(data.consumers)) {
      throw new Error(`${tool} returned an incomplete dependency answer`);
    }
    return;
  }
  if (typeof data.artifactDigest !== "string" || typeof data.manifestDigest !== "string") {
    throw new Error(`${tool} returned an incomplete status answer`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

try {
  const evaluations = await Promise.all([run("source-driven"), run("manifest-driven")]);
  console.log(
    JSON.stringify(
      {
        benchmark: "agent-token-economy",
        tasks: tasks.map((task) => task.tool),
        generatedSourceBytes: Buffer.byteLength(source),
        evaluations,
      },
      null,
      2
    )
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
