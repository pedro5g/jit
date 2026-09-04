/**
 * `pnpm knowledge:eval:capability` — prepare and inspect the browser run.
 *
 * Generation remains in the existing manual WebGPU page because the model is
 * not available to the Node provider. This command validates the frozen
 * oracle and prints the exact browser configurations to run; `--inspect`
 * provides the small, deterministic evidence pack without loading weights.
 */
import path from "node:path";
import { estimateTokens } from "../../lib/copilot/application/context/token-budget.js";
import { ARTIFACT_DIR } from "../../lib/copilot/config/artifacts.js";
import { QUALIFICATION_BENCHMARK_VERSION, QUALIFICATION_CANDIDATES } from "../../lib/copilot/config/models.js";
import { type CapabilityConfig, capabilityCases, humanReviewCases } from "../../lib/copilot/eval/capability.js";
import { minimalSynthesisMessages } from "../../lib/copilot/eval/capability-prompt.js";
import { resolveExplanationFacets } from "../../lib/copilot/eval/explanation-cases.js";
import { OracleContextBuilder } from "../../lib/copilot/eval/oracle-context.js";
import { createKnowledgeEngine } from "../../lib/copilot/infrastructure/knowledge-engine.js";
import { NodeArtifactLoader } from "../../lib/copilot/infrastructure/storage/node-artifact-loader.js";

const siteDir = path.resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const configIndex = args.indexOf("--config");
const config = (configIndex >= 0 ? args[configIndex + 1] : "P") as CapabilityConfig;
const casesIndex = args.indexOf("--cases");
const caseSet: "smoke" | "full" = args.includes("--full") || args[casesIndex + 1] === "full" ? "full" : "smoke";
const candidateIndex = args.indexOf("--candidate");
const selectedCandidateId = candidateIndex >= 0 ? args[candidateIndex + 1] : undefined;
const selectedCandidate = selectedCandidateId
  ? QUALIFICATION_CANDIDATES.find((candidate) => candidate.id === selectedCandidateId)
  : undefined;
const decodingIndex = args.indexOf("--decoding");
const decodingId = decodingIndex >= 0 ? args[decodingIndex + 1] : undefined;
const inspectIndex = args.indexOf("--inspect");
const optionValues = new Set(
  ["--config", "--candidate", "--decoding", "--cases"].flatMap((option) => {
    const index = args.indexOf(option);
    return index >= 0 && args[index + 1] ? [args[index + 1]] : [];
  })
);
const question = (inspectIndex >= 0 ? args.slice(inspectIndex + 1) : args)
  .filter((value) => !value.startsWith("--") && !optionValues.has(value))
  .join(" ");

if (!["P", "R", "X"].includes(config)) {
  console.error("--config must be P, R or X");
  process.exit(2);
}

if (selectedCandidateId && !selectedCandidate) {
  console.error(`unknown qualification candidate: ${selectedCandidateId}`);
  console.error(`choose one of: ${QUALIFICATION_CANDIDATES.map((candidate) => candidate.id).join(", ")}`);
  process.exit(2);
}

if (selectedCandidate && decodingId && !selectedCandidate.decodings.some((decoding) => decoding.id === decodingId)) {
  console.error(`decoding ${decodingId} is not registered for ${selectedCandidate.id}`);
  process.exit(2);
}

const engine = await createKnowledgeEngine(new NodeArtifactLoader(path.join(siteDir, "public", ARTIFACT_DIR)));
const cases = resolveExplanationFacets(capabilityCases(caseSet), engine.knowledge, engine.graph);
const builder = new OracleContextBuilder({
  knowledge: engine.knowledge,
  graph: engine.graph,
  chunks: engine.chunks,
});

if (question) {
  const testCase = cases.find((entry) => entry.question === question);
  if (!testCase) {
    console.error(`question is not one of the frozen explanation cases: ${question}`);
    process.exit(2);
  }
  const oracle = builder.build({ case: testCase });
  console.log(`question: ${oracle.question}`);
  console.log(`route: ${oracle.routeId}`);
  console.log(`anchor: ${oracle.anchor ?? "(none)"}`);
  console.log(
    `evidence tokens: ${oracle.evidenceTokens}/${oracle.evidenceLimit}${oracle.overBudget ? " (over budget)" : ""}`
  );
  console.log(`facets: ${oracle.facetPriorities.map((facet) => `${facet.priority}:${facet.id}`).join(", ")}`);
  console.log(
    `prompt tokens: ${estimateTokens(
      minimalSynthesisMessages(oracle)
        .map((message) => message.content)
        .join("\n")
    )}`
  );
  for (const evidence of oracle.evidence) {
    console.log(`\n[${evidence.priority}] ${evidence.knowledgeId} ${evidence.chunkId}`);
    console.log(`${evidence.routeId}${evidence.anchor ? `#${evidence.anchor}` : ""} · ${evidence.sourceFile}`);
    console.log(evidence.content);
  }
  process.exit(0);
}

for (const testCase of cases) builder.build({ case: testCase });
const human = humanReviewCases(cases);
console.log(`[capability] frozen preparation valid`);
console.log(`  config: ${config}`);
console.log(`  case set: ${caseSet} (${cases.length} cases)`);
console.log(`  benchmark version: ${QUALIFICATION_BENCHMARK_VERSION}`);
console.log(
  `  candidates: ${QUALIFICATION_CANDIDATES.map((candidate) => `${candidate.id} [${candidate.provider}]`).join(" · ")}`
);
if (selectedCandidate) {
  const decoding =
    selectedCandidate.decodings.find((entry) => entry.id === decodingId) ?? selectedCandidate.decodings[0];
  console.log(`  selected candidate: ${selectedCandidate.label}`);
  console.log(`  model family: ${selectedCandidate.modelFamily}`);
  console.log(
    `  parameters: ${selectedCandidate.parameterCount === undefined ? "unknown/not exposed" : selectedCandidate.parameterCount}`
  );
  console.log(`  dtype: ${selectedCandidate.dtype ?? "N/A"}`);
  console.log(`  decoding: ${decoding?.id ?? "N/A"} · ${decoding?.source ?? "N/A"}`);
}
console.log(`  development smoke: 8 fixed cases`);
console.log(`  holdout: ${Math.max(0, cases.length - 8)} cases`);
console.log(
  `  human review: ${human.filter((entry) => entry.locale === "pt-BR").length} PT-BR / ${human.filter((entry) => entry.locale === "en").length} EN`
);
console.log(`  knowledge hash: ${engine.manifest.contentHash}`);
console.log("  run in browser: /lab/benchmark → select candidate, decoding, config P, R, X and smoke/full");
console.log("  P does not preload embeddings; R and X do.");
