import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AOT, Compiler, JIT } from "../packages/jit/src/index.js";
import { measurePhases, measureRatio } from "./harness/measure.js";

interface GeneratedModule {
  readonly isValues: (value: unknown) => boolean;
}

async function main(): Promise<void> {
  const schema = JIT.array(JIT.string()).length(5);
  const input = ["a", "b", "c", "d", "e"];
  const runtime = Compiler.compileValidator(schema.schema).is as (value: unknown) => boolean;
  const artifact = JIT.validate.is(schema);
  const outDir = mkdtempSync(join(tmpdir(), "jit-perf-critical-"));

  try {
    AOT.generate({
      artifacts: { isValues: artifact },
      outDir,
      format: "js",
      target: { profile: "portable-1" },
    });
    const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as GeneratedModule;
    const idiomatic = (): boolean =>
      Array.isArray(input) && input.length === 5 && input.every((value) => typeof value === "string");
    const ceiling = (): boolean => {
      if (!Array.isArray(input) || input.length !== 5) return false;
      for (let index = 0; index < input.length; index++) if (typeof input[index] !== "string") return false;
      return true;
    };
    const runtimeJit = (): boolean => runtime(input);
    const aot = (): boolean => generated.isValues(input);

    const measurements = {
      idiomatic: measureRatio("array.fixed-length.idiomatic-vs-ceiling", ceiling, idiomatic),
      runtimeJit: measureRatio("array.fixed-length.runtime-vs-ceiling", ceiling, runtimeJit),
      aot: measureRatio("array.fixed-length.aot-vs-ceiling", ceiling, aot),
    };
    const phases = measurePhases(
      "array.fixed-length.runtime-compile-phases",
      () => Compiler.compileValidator(JIT.array(JIT.string()).length(5).schema).is,
      (compiled) => (compiled as (value: unknown) => boolean)(input)
    );

    console.log(
      JSON.stringify(
        {
          scenario: "array.validate.fixed-length",
          measurements,
          phases,
          sourceBytes: {
            runtime: Compiler.emitValidatorSource(schema.schema, { ops: ["is"] }).length,
            aot: readFileSync(join(outDir, "index.js"), "utf8").length,
          },
          physical: artifact.explain({ physical: true }),
        },
        null,
        2
      )
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

await main();
