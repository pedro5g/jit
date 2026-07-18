import { build } from "esbuild";
import { resolve } from "node:path";

const site = resolve(import.meta.dirname, "..");

await build({
  entryPoints: [resolve(site, "lib/lab/compiler/entry.ts")],
  outfile: resolve(site, "lib/lab/generated/jit_compiler.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  legalComments: "none",
  alias: {
    "node:fs": resolve(site, "lib/lab/compiler/virtual-fs.ts"),
    "node:path": resolve(site, "lib/lab/compiler/virtual-path.ts"),
  },
});
