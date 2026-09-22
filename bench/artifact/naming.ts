import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { AOT, JIT } from "../../packages/jit/src/index.js";

const User = JIT.object({
  id: JIT.number().int(),
  firstName: JIT.string(),
  lastName: JIT.string(),
  emailAddress: JIT.string().email(),
  accountStatus: JIT.union(JIT.literal("active"), JIT.literal("disabled")),
});
const sample = {
  id: 42,
  firstName: "Ada",
  lastName: "Lovelace",
  emailAddress: "ada@example.com",
  accountStatus: "active" as const,
};
const iterations = 200_000;
const hotRounds = 3;

interface NamingResult {
  readonly naming: "compact" | "semantic";
  readonly generatedBytes: number;
  readonly generationMs: number;
  readonly moduleCompileMs: number;
  readonly hotNs: number;
  readonly heapDeltaBytes: number | undefined;
}

const results: NamingResult[] = [];
for (const naming of ["compact", "semantic"] as const) {
  const outDir = mkdtempSync(join("/tmp", `jit-naming-${naming}-`));
  try {
    const generationStart = performance.now();
    AOT.generate({
      groups: {
        User: {
          is: JIT.validate.is(User),
          parse: JIT.validate.parse(User),
        },
      },
      outDir,
      format: "js",
      naming,
    });
    const generationMs = performance.now() - generationStart;
    const sourcePath = join(outDir, "index.js");
    const generatedBytes = Buffer.byteLength(readFileSync(sourcePath));
    const compileStart = performance.now();
    const moduleUrl = pathToFileURL(sourcePath).href;
    await import(moduleUrl);
    const generated = (await import(`${moduleUrl}?${naming}-${Date.now()}`)) as {
      readonly User: { readonly is: (value: unknown) => boolean };
    };
    const moduleCompileMs = performance.now() - compileStart;
    for (let index = 0; index < 10_000; index++) generated.User.is(sample);
    const hotMeasurements: number[] = [];
    let heapDeltaBytes: number | undefined;
    for (let round = 0; round < hotRounds; round++) {
      const before = process.memoryUsage().heapUsed;
      const hotStart = performance.now();
      let accepted = 0;
      for (let index = 0; index < iterations; index++) if (generated.User.is(sample)) accepted++;
      const elapsed = performance.now() - hotStart;
      const after = process.memoryUsage().heapUsed;
      heapDeltaBytes = after - before;
      if (accepted !== iterations) throw new Error(`naming=${naming} rejected the valid sample`);
      hotMeasurements.push((elapsed * 1_000_000) / iterations);
    }
    hotMeasurements.sort((left, right) => left - right);
    results.push({
      naming,
      generatedBytes,
      generationMs: Number(generationMs.toFixed(3)),
      moduleCompileMs: Number(moduleCompileMs.toFixed(3)),
      hotNs: Number((hotMeasurements[Math.floor(hotMeasurements.length / 2)] ?? 0).toFixed(3)),
      heapDeltaBytes,
    });
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

console.log(
  JSON.stringify(
    {
      benchmark: "aot-naming",
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      iterations,
      results,
    },
    null,
    2
  )
);
