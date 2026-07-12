import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AOT, JIT } from "@jit/compiler";

/**
 * Cold start: runtime JIT compile vs pregenerated AOT module, both measured
 * inside fresh `node` child processes against the built package — the exact
 * path a serverless/edge user pays on every cold invocation. The children
 * self-time (hrtime around import + first call) so process boot is excluded.
 */
const RUNS = 15;
const here = fileURLToPath(new URL("./", import.meta.url));
const resultsDir = fileURLToPath(new URL("../results/", import.meta.url));

const UserSchema = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2).max(64),
  email: JIT.string().email(),
  active: JIT.boolean(),
  tags: JIT.array(JIT.string()).max(8),
  profile: JIT.object({
    age: JIT.number().int().min(0).max(150),
    score: JIT.number(),
  }),
});

AOT.generate({ schemas: { User: UserSchema }, outDir: join(here, ".generated") });

interface ColdStats {
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly samples: readonly number[];
}

function measure(script: string): ColdStats {
  const samples: number[] = [];

  for (let run = 0; run < RUNS; run++) {
    const stdout = execFileSync(process.execPath, [join(here, script)], { encoding: "utf8" });
    const parsed = JSON.parse(stdout.trim()) as { ns: number };

    samples.push(parsed.ns);
  }

  const sorted = [...samples].sort((left, right) => left - right);

  return {
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    samples,
  };
}

function ms(ns: number): string {
  return `${(ns / 1e6).toFixed(2)}ms`;
}

const jit = measure("cold-jit.mjs");
const aot = measure("cold-aot.mjs");

console.log(`cold start (${RUNS} fresh node processes each, child-side hrtime)`);
console.log(`  jit runtime compile: median ${ms(jit.median)} (min ${ms(jit.min)}, max ${ms(jit.max)})`);
console.log(`  aot pregenerated:    median ${ms(aot.median)} (min ${ms(aot.min)}, max ${ms(aot.max)})`);
console.log(`  speedup: ${(jit.median / aot.median).toFixed(1)}x`);

mkdirSync(resultsDir, { recursive: true });
writeFileSync(
  join(resultsDir, "coldstart.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), runs: RUNS, jit, aot }, null, 2)}\n`
);
