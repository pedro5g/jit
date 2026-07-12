// Collects the jit package's built .d.ts files into a JSON manifest served to
// the playground, where they are registered as Monaco extra libs so the editor
// gets full type inference for `import { JIT } from "jit/runtime"`.
// Run from apps/site (wired into the dev/build scripts). Output is gitignored.
import { promises as fs } from "node:fs";
import path from "node:path";

const siteDir = process.cwd();
const pkgDir = path.resolve(siteDir, "../../packages/jit");
const outFile = path.join(siteDir, "public/playground/jit-dts.json");

const skip = new Set(["node_modules", "src", ".turbo"]);

async function collect(dir, base, files) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) await collect(path.join(dir, entry.name), base, files);
    } else if (entry.name.endsWith(".d.ts")) {
      const abs = path.join(dir, entry.name);
      files[path.relative(base, abs).replaceAll(path.sep, "/")] = await fs.readFile(abs, "utf8");
    }
  }
}

const files = {};
await collect(pkgDir, pkgDir, files);

const count = Object.keys(files).length;
if (count === 0) {
  console.error("[jit-dts] no .d.ts files found — build the jit package first (pnpm --filter jit build)");
  process.exit(1);
}

await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), files }));
const bytes = (await fs.stat(outFile)).size;
console.log(`[jit-dts] wrote ${count} declaration files (${(bytes / 1024).toFixed(0)} kB) to public/playground/jit-dts.json`);
