import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { AOT } from "../../packages/jit/src/index.js";

/** Generate and load the exact standalone module measured by an AOT benchmark. */
export async function loadAotArtifacts<TModule>(artifacts: Readonly<Record<string, object>>): Promise<TModule> {
  const outDir = mkdtempSync(join(tmpdir(), "jit-bench-aot-"));

  try {
    const result = AOT.generate({ artifacts, outDir });

    if (result.skipped.length !== 0) {
      throw new Error(`AOT benchmark generation skipped: ${result.skipped.map((item) => item.reason).join("; ")}`);
    }
    return (await import(pathToFileURL(join(outDir, "index.js")).href)) as TModule;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}
