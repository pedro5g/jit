import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { AOT, JIT } from "../packages/jit/src/index.js";

const sample = "User profile_name 2026";
const expected = "userProfileName2026";
const iterations = 200_000;
const rounds = 3;
const schema = JIT.string().toCamelCase();
const runtime = JIT.validate.parse(schema);

type Transform = (value: string) => string;

interface Result {
  readonly implementation: "idiomatic" | "handwritten" | "runtime-jit" | "aot";
  readonly hotNs: number;
  readonly heapDeltaBytes: number;
  readonly sourceBytes?: number;
  readonly generationMs?: number;
  readonly moduleCompileMs?: number;
}

function idiomatic(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word, index) => {
      const lower = word.toLowerCase();
      return index === 0 ? lower : `${lower[0]?.toUpperCase() ?? ""}${lower.slice(1)}`;
    })
    .join("");
}

function handwritten(value: string): string {
  let output = "";
  let capitalize = false;
  let hasWord = false;

  for (const character of value) {
    const code = character.charCodeAt(0);
    const isAlphaNumeric = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (!isAlphaNumeric) {
      if (hasWord) capitalize = true;
      continue;
    }
    const isUpper = code >= 65 && code <= 90;
    const lowerCode = isUpper ? code + 32 : code;
    const outputCode = capitalize && lowerCode >= 97 && lowerCode <= 122 ? lowerCode - 32 : lowerCode;
    output += String.fromCharCode(outputCode);
    capitalize = false;
    hasWord = true;
  }

  return output;
}

function measure(implementation: Result["implementation"], transform: Transform, extras = {}): Result {
  if (transform(sample) !== expected) throw new Error(`${implementation} produced an unexpected result`);
  for (let index = 0; index < 10_000; index++) transform(sample);

  const measurements: number[] = [];
  let heapDeltaBytes = 0;
  for (let round = 0; round < rounds; round++) {
    const before = process.memoryUsage().heapUsed;
    const start = performance.now();
    for (let index = 0; index < iterations; index++) transform(sample);
    const elapsed = performance.now() - start;
    heapDeltaBytes = process.memoryUsage().heapUsed - before;
    measurements.push((elapsed * 1_000_000) / iterations);
  }
  measurements.sort((left, right) => left - right);
  return {
    implementation,
    hotNs: Number((measurements[Math.floor(measurements.length / 2)] ?? 0).toFixed(3)),
    heapDeltaBytes,
    ...extras,
  };
}

const results: Result[] = [
  measure("idiomatic", idiomatic),
  measure("handwritten", handwritten),
  measure("runtime-jit", runtime),
];
const outDir = mkdtempSync(join("/tmp", "jit-case-transform-"));
try {
  const generationStart = performance.now();
  AOT.generate({ artifacts: { toCamelCase: runtime }, outDir, format: "js" });
  const generationMs = performance.now() - generationStart;
  const sourcePath = join(outDir, "index.js");
  const sourceBytes = readFileSync(sourcePath).byteLength;
  const moduleUrl = pathToFileURL(sourcePath).href;
  await import(moduleUrl);
  const compileStart = performance.now();
  const generated = (await import(`${moduleUrl}?case-transform-${Date.now()}`)) as {
    readonly toCamelCase: Transform;
  };
  const moduleCompileMs = performance.now() - compileStart;
  results.push(
    measure("aot", generated.toCamelCase, {
      sourceBytes,
      generationMs: Number(generationMs.toFixed(3)),
      moduleCompileMs: Number(moduleCompileMs.toFixed(3)),
    })
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(
  JSON.stringify(
    {
      benchmark: "case-transform-camel",
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      sample,
      expected,
      iterations,
      rounds,
      results,
    },
    null,
    2
  )
);
