import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AOT, Compiler, JIT } from "../packages/jit/src/index.js";
import { measureIsolatedRatio, measurePhases } from "./harness/measure.js";

async function main(): Promise<void> {
  const schema = JIT.array(JIT.string()).length(5);
  const input = ["a", "b", "c", "d", "e"];
  const artifact = JIT.validate.is(schema);
  const outDir = mkdtempSync(join(tmpdir(), "jit-perf-critical-"));
  const scenarioUrl = new URL("./scenarios/fixed-array.ts", import.meta.url).href;

  try {
    AOT.generate({
      artifacts: { isValues: artifact },
      outDir,
      format: "js",
      target: { profile: "portable-1" },
    });
    const measurements = {
      idiomatic: measureIsolatedRatio("array.fixed-length.idiomatic-vs-ceiling", scenarioUrl, "ceiling", "idiomatic"),
      runtimeJit: measureIsolatedRatio("array.fixed-length.runtime-vs-ceiling", scenarioUrl, "ceiling", "runtime-jit"),
      aot: measureIsolatedRatio("array.fixed-length.aot-vs-ceiling", scenarioUrl, "ceiling", "aot"),
    };
    const phases = measurePhases(
      "array.fixed-length.runtime-compile-phases",
      () => Compiler.compileValidator(JIT.array(JIT.string()).length(5).schema).is,
      (compiled) => (compiled as (value: unknown) => boolean)(input)
    );
    const result = {
      scenario: "array.validate.fixed-length",
      fingerprint: measurements.runtimeJit.fingerprint,
      measurements,
      phases,
      sourceBytes: {
        runtime: Compiler.emitValidatorSource(schema.schema, { ops: ["is"] }).length,
        aot: readFileSync(join(outDir, "index.js"), "utf8").length,
      },
      physical: artifact.explain({ physical: true }),
    };
    const major = process.version.match(/^v?(\d+)/)?.[1] ?? "unknown";
    mkdirSync("perf/results", { recursive: true });
    writeFileSync(`perf/results/critical.node-${major}.json`, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

await main();
