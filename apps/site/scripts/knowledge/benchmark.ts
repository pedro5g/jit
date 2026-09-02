/**
 * `pnpm knowledge:benchmark` — the A/B/C comparison.
 *
 * The question this exists to answer, from §PART 5:
 *
 *   how much of the improvement came from the knowledge engine alone, and how
 *   much distance is left between a sub-1B model and a 1.7B?
 *
 * Three configurations, one dataset, one set of deterministic detectors:
 *
 *   A. the old assistant's retrieval and prompt, with the light model
 *   B. the new retrieval and context, with the same light model
 *   C. the new retrieval and context, with the balanced model
 *
 * A and B differ only in the pipeline; B and C differ only in the model. That
 * is what makes the two deltas separable, and it is why B must use the same
 * weights as A — a benchmark that changed both at once would produce one
 * number that explains nothing.
 *
 * Runs on CPU through `onnxruntime-node`, which imposes one substitution worth
 * stating plainly: the browser's light tier is Qwen3.5-0.8B, and that model
 * cannot load here — its ONNX graph uses an operator the Node runtime does not
 * register. The headless light tier is Qwen2.5-0.5B-Instruct instead. It is
 * *smaller* than the browser's, so its numbers are a lower bound on what the
 * 0.8B would do, not an estimate of it.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DocsRetriever } from "../../lib/assistant/retrieval";
import type { DocsIndex } from "../../lib/assistant/types";
import { ContextService } from "../../lib/copilot/application/context/context.service";
import { ARTIFACT_DIR } from "../../lib/copilot/config/artifacts";
import type { GenerationMessage } from "../../lib/copilot/core/ports/language-model";
import {
  type CaseRecord,
  CONTEXT_VERSION,
  type ContextRecord,
  DATASET_VERSION,
  PROMPT_VERSION,
  type ResponseRecord,
  type RunManifest,
  runId,
  toJsonl,
} from "../../lib/copilot/eval/artifacts";
import { type MeasuredCase, measureGeneration } from "../../lib/copilot/eval/detectors";
import { explanationCases, resolveExplanationFacets } from "../../lib/copilot/eval/explanation-cases";
import { generationCases } from "../../lib/copilot/eval/generation-cases";
import {
  fatalFlags,
  generateCase,
  MAX_TOKENS,
  type PromptForCase,
  pipelinePrompt,
} from "../../lib/copilot/eval/generation-run";
import { legacySystemPrompt, legacyUserTurn } from "../../lib/copilot/eval/legacy-prompt";
import { renderReport } from "../../lib/copilot/eval/report";
import type { EvalCase } from "../../lib/copilot/eval/types";
import { createKnowledgeEngine } from "../../lib/copilot/infrastructure/knowledge-engine";
import { NodeLanguageModel, type NodeModelSpec } from "../../lib/copilot/infrastructure/models/node-language-model";
import { NodeArtifactLoader } from "../../lib/copilot/infrastructure/storage/node-artifact-loader";

const siteDir = path.resolve(import.meta.dirname, "../..");

/**
 * The models, named here rather than in the application layer.
 *
 * §PART 4: nothing above infrastructure knows these strings exist. The
 * benchmark is infrastructure — it is the one place that gets to pick.
 */
const LIGHT: NodeModelSpec = {
  id: "qwen2.5-0.5b",
  label: "Qwen2.5 0.5B",
  repo: "onnx-community/Qwen2.5-0.5B-Instruct",
  dtype: "q4",
};

const BALANCED: NodeModelSpec = {
  id: "qwen3-1.7b",
  label: "Qwen3 1.7B",
  repo: "onnx-community/Qwen3-1.7B-ONNX",
  dtype: "q4",
};

interface Config {
  name: string;
  detail: string;
  spec: NodeModelSpec;
  model: NodeLanguageModel;
  prompt: PromptForCase;
}

async function main() {
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
  const limit = process.argv.includes("--limit")
    ? Number(process.argv[process.argv.indexOf("--limit") + 1])
    : Number.POSITIVE_INFINITY;

  const engine = await createKnowledgeEngine(new NodeArtifactLoader(path.join(siteDir, "public", ARTIFACT_DIR)));
  const contextService = new ContextService({
    knowledge: engine.knowledge,
    routes: engine.routes,
    symbols: engine.symbols,
  });

  /**
   * The old pipeline, loaded from the artifacts it still ships.
   *
   * Kept alive on purpose — §PART 8 — because a comparison against a system
   * that has been deleted is a comparison against a memory of it.
   */
  const oldIndex = JSON.parse(
    await fs.readFile(path.join(siteDir, "public/assistant/docs-index.json"), "utf8")
  ) as DocsIndex;
  const oldRetriever = new DocsRetriever(oldIndex);

  const newPrompt = pipelinePrompt(engine, contextService);

  /**
   * The old prompt, and the one concession the comparison makes.
   *
   * Its answer is still *measured* against the new context, because the
   * detectors need somewhere to check a claim against and the old pipeline has
   * no comparable object. That biases the grounding number in the old
   * pipeline's favour if anything — it is being checked against evidence it
   * did not see — so a bad result there is a real one.
   */
  const oldPromptFor = async (testCase: EvalCase) => {
    const sections = oldRetriever.search(testCase.question, { limit: 6 });
    const turn = legacyUserTurn(testCase.question, sections);

    const { context } = await newPrompt(testCase);
    const messages: GenerationMessage[] = [
      { role: "system", content: legacySystemPrompt(oldIndex.api) },
      { role: "user", content: turn },
    ];

    return { messages, context };
  };

  /**
   * One instance per set of weights, not one per configuration.
   *
   * A and B answer with the same model on purpose — that is what makes the
   * pipeline delta separable — and constructing two of them loaded the same
   * gigabyte twice. On a 7 GB machine that is the difference between a run
   * that finishes and one the kernel kills three hours in.
   */
  const loaded = new Map<string, NodeLanguageModel>();
  const modelFor = (spec: NodeModelSpec) => {
    const existing = loaded.get(spec.id);
    if (existing) return existing;
    const model = new NodeLanguageModel(spec);
    loaded.set(spec.id, model);
    return model;
  };

  const configs: Config[] = [
    { name: "A", detail: `old pipeline + ${LIGHT.label}`, spec: LIGHT, model: modelFor(LIGHT), prompt: oldPromptFor },
    { name: "B", detail: `new pipeline + ${LIGHT.label}`, spec: LIGHT, model: modelFor(LIGHT), prompt: newPrompt },
    {
      name: "C",
      detail: `new pipeline + ${BALANCED.label}`,
      spec: BALANCED,
      model: modelFor(BALANCED),
      prompt: newPrompt,
    },
  ].filter((config) => !only || config.name === only);

  const cases = (
    process.argv.includes("--explain")
      ? resolveExplanationFacets(explanationCases(), engine.knowledge, engine.graph)
      : generationCases()
  ).slice(0, limit);
  const results = new Map<string, MeasuredCase[]>();
  const manifests = new Map<string, RunManifest>();
  const records: Record<string, { cases: CaseRecord[]; contexts: ContextRecord[]; responses: ResponseRecord[] }> = {};

  for (const config of configs) {
    console.log(`\n=== ${config.name}: ${config.detail} ===`);
    await config.model.load();

    const measured: MeasuredCase[] = [];
    records[config.name] = { cases: [], contexts: [], responses: [] };

    for (const [index, testCase] of cases.entries()) {
      const { measured: outcome, records: row } = await generateCase({
        engine,
        model: config.model,
        prompt: config.prompt,
        case: testCase,
      });

      measured.push(outcome);
      records[config.name].cases.push(row.case);
      records[config.name].contexts.push(row.context);
      records[config.name].responses.push(row.response);

      // A run is long enough that a silent progress line teaches you nothing
      // until the table at the end.
      console.log(
        `  ${String(index + 1).padStart(2)}/${cases.length} ${(outcome.latencyMs / 1000).toFixed(1)}s ${fatalFlags(outcome) || "ok"}  ${testCase.question.slice(0, 52)}`
      );
    }

    results.set(config.name, measured);

    /**
     * Written here rather than after the last configuration — §PART 8.
     *
     * Three configurations are hours of generation, and the first version of
     * this script kept every transcript in memory until all of them finished:
     * one out-of-memory kill on the largest model, which is the one most
     * likely to be killed, and the two completed runs went with it. A run that
     * finished is an artifact, immediately.
     */
    manifests.set(config.name, await writeRun(config, measured));
  }

  // ------------------------------------------------------------------ report
  //
  // Rendered by the same code the re-score run uses, so a number printed while
  // the model answers and the same number rebuilt from the transcript a week
  // later cannot drift apart.
  console.log(
    `\n\n${renderReport(
      configs.map((config) => ({
        config: config.name,
        label: config.detail,
        manifest: manifests.get(config.name),
        cases: results.get(config.name) ?? [],
        metrics: measureGeneration(results.get(config.name) ?? []),
      })),
      { title: "Headless benchmark — A/B/C", cases: cases.length }
    )}`
  );

  console.log("");

  async function writeRun(config: Config, measured: MeasuredCase[]) {
    const id = runId(config.name, config.spec.id);
    const dir = path.join(siteDir, ".eval/copilot/runs", id);
    await fs.mkdir(dir, { recursive: true });

    const manifest: RunManifest = {
      runId: id,
      ranAt: new Date().toISOString(),
      model: {
        id: config.spec.id,
        label: config.spec.label,
        repo: config.spec.repo,
        dtype: config.spec.dtype,
      },
      runtime: { provider: "onnxruntime-node", device: "cpu", node: process.version },
      knowledge: {
        contentHash: engine.manifest.contentHash,
        embeddingModel: engine.manifest.embedding.model,
        chunks: engine.manifest.counts.chunks,
        symbols: engine.manifest.counts.symbols,
      },
      promptVersion: PROMPT_VERSION,
      contextVersion: CONTEXT_VERSION,
      datasetVersion: DATASET_VERSION,
      generation: { maxTokens: MAX_TOKENS, temperature: 0, greedy: true },
      config: config.name,
      configLabel: config.detail,
      cases: measured.length,
    };

    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    await fs.writeFile(path.join(dir, "cases.jsonl"), toJsonl(records[config.name].cases));
    await fs.writeFile(path.join(dir, "contexts.jsonl"), toJsonl(records[config.name].contexts));
    await fs.writeFile(path.join(dir, "responses.jsonl"), toJsonl(records[config.name].responses));

    console.log(`  ${config.name} -> ${path.relative(siteDir, dir)}`);
    return manifest;
  }
}

await main();
