/**
 * `pnpm knowledge:bench:vector`.
 *
 * Measures the exact repository against the two tempting baselines this
 * feature is allowed to replace: nested arrays and scoring every document
 * followed by a full sort. It is deliberately separate from generation so a
 * model load cannot hide the cost of the vector scan.
 */
import path from "node:path";
import { performance } from "node:perf_hooks";
import { ARTIFACT_DIR } from "../../lib/copilot/config/artifacts";
import { createKnowledgeEngine } from "../../lib/copilot/infrastructure/knowledge-engine";
import { NodeArtifactLoader } from "../../lib/copilot/infrastructure/storage/node-artifact-loader";

const siteDir = path.resolve(import.meta.dirname, "../..");
const engine = await createKnowledgeEngine(new NodeArtifactLoader(path.join(siteDir, "public", ARTIFACT_DIR)));
const loader = new NodeArtifactLoader(path.join(siteDir, "public", ARTIFACT_DIR));
const packed = await loader.loadVectors(engine.manifest);
if (!packed) throw new Error("the knowledge build has no vectors");

const count = engine.manifest.counts.vectors;
const dimensions = engine.manifest.embedding.dimensions;
const limit = 8;
const query = packed.slice(0, dimensions);
const iterations = 200;

const nested: Float32Array[] = new Array(count);
for (let index = 0; index < count; index += 1)
  nested[index] = packed.slice(index * dimensions, (index + 1) * dimensions);

const exact = () => engine.vectors.search(query, limit);
const nestedFullSort = () => {
  const scores = nested.map((vector, index) => {
    let score = 0;
    for (let dimension = 0; dimension < dimensions; dimension += 1) score += vector[dimension] * query[dimension];
    return { index, score };
  });
  scores.sort((left, right) => right.score - left.score || left.index - right.index);
  return scores.slice(0, limit);
};
const flatFullSort = () => {
  const scores: { index: number; score: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = index * dimensions;
    let score = 0;
    for (let dimension = 0; dimension < dimensions; dimension += 1)
      score += packed[offset + dimension] * query[dimension];
    scores.push({ index, score });
  }
  scores.sort((left, right) => right.score - left.score || left.index - right.index);
  return scores.slice(0, limit);
};

function time(operation: () => unknown): { averageMs: number; p50Ms: number; p95Ms: number } {
  for (let index = 0; index < 20; index += 1) operation();
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    operation();
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  return {
    averageMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p50Ms: samples[Math.floor(samples.length * 0.5)] ?? 0,
    p95Ms: samples[Math.floor(samples.length * 0.95)] ?? 0,
  };
}

const bounded = time(exact);
const nestedSort = time(nestedFullSort);
const flatSort = time(flatFullSort);
const expected = flatFullSort().map((match) => match.index);
const chunkIds = engine.chunks.all().map((chunk) => chunk.id);
const expectedIds = expected.map((index) => chunkIds[index]);
const actual = exact().map((match) => match.chunkId);
if (JSON.stringify(actual) !== JSON.stringify(expectedIds)) {
  throw new Error("bounded top-K result differs from the full-sort reference");
}

console.log(
  `[vector] Node ${process.version} · ${count} vectors × ${dimensions} · top-${limit} · ${iterations} iterations`
);
console.log(
  `  bounded flat heap      avg ${bounded.averageMs.toFixed(3)}ms · p50 ${bounded.p50Ms.toFixed(3)}ms · p95 ${bounded.p95Ms.toFixed(3)}ms`
);
console.log(
  `  flat score + full sort avg ${flatSort.averageMs.toFixed(3)}ms · p50 ${flatSort.p50Ms.toFixed(3)}ms · p95 ${flatSort.p95Ms.toFixed(3)}ms`
);
console.log(
  `  nested score + sort    avg ${nestedSort.averageMs.toFixed(3)}ms · p50 ${nestedSort.p50Ms.toFixed(3)}ms · p95 ${nestedSort.p95Ms.toFixed(3)}ms`
);
console.log(`  exact result count    ${actual.length} · full-sort reference count ${expected.length}`);
