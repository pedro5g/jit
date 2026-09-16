import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JIT } from "../../index.js";

export const itWithOriginalFunctionSource = process.env.JIT_MUTATION_RUN === "1" ? it.skip : it;

export function registerAotTestHooks(assign: (outDir: string) => void): void {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "jit-aot-"));
    assign(outDir);
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });
}

export function verifyGeneratedTypes(outDir: string, consumer: string): void {
  writeFileSync(join(outDir, "consumer.ts"), consumer);
  writeFileSync(
    join(outDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        exactOptionalPropertyTypes: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        strict: true,
        target: "ES2022",
      },
      include: ["index.ts", "consumer.ts"],
    })
  );
  writeFileSync(join(outDir, "package.json"), '{"type":"module"}\n');
  execFileSync(process.execPath, [join(process.cwd(), "node_modules", "typescript", "bin", "tsc")], {
    cwd: outDir,
    stdio: "pipe",
  });
}

export function createPriorityRules() {
  const Transaction = JIT.object({
    amount: JIT.number(),
    country: JIT.string(),
  });

  return JIT.rules(Transaction)
    .inputs({ risk: JIT.number() })
    .rule("review", {
      when: (query, input) => query.or(query.gte("amount", 10_000), query.gte(input.field("risk"), 80)),
    })
    .rule("block", {
      priority: 100,
      when: (query, input) => query.and(query.eq("country", "BR"), query.gte(input.field("risk"), 95)),
    });
}
