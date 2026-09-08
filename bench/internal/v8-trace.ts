import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const probe = fileURLToPath(new URL("./v8-probe.ts", import.meta.url));
const output = spawnSync(
  process.execPath,
  ["--trace-opt", "--trace-deopt", "--import", "tsx/esm", "--conditions", "@jit/source", probe],
  { encoding: "utf8" }
);

const trace = `${output.stdout}${output.stderr}`;
const reportPath = fileURLToPath(new URL("../results/internal/v8-trace.latest.json", import.meta.url));
const logPath = fileURLToPath(new URL("../results/internal/v8-trace.latest.log", import.meta.url));
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(logPath, trace);
writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      node: process.version,
      v8: process.versions.v8,
      optimizedFunctions: trace.match(/completed optimizing/g)?.length ?? 0,
      deoptimizations: trace.match(/\bdeopt-eager, reason/g)?.length ?? 0,
      bailoutLines: trace.split("\n").filter((line) => line.includes("bailout")),
      log: "bench/results/internal/v8-trace.latest.log",
      exitCode: output.status,
    },
    null,
    2
  )}\n`
);

if (output.status !== 0) {
  process.stderr.write(trace);
  process.exit(output.status ?? 1);
}

console.log(`V8 trace written to ${logPath}`);
