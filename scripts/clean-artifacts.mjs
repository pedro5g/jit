import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const generatedDirectories = [
  "target",
  "packages/jit/ATS",
  "packages/jit/aot",
  "packages/jit/compiler",
  "packages/jit/core",
  "packages/jit/errors",
  "packages/jit/factories",
  "packages/jit/runtime",
  "packages/jit/shared",
  "packages/jit/transforms",
  "packages/jit-cli-darwin-arm64/bin",
  "packages/jit-cli-darwin-x64/bin",
  "packages/jit-cli-linux-arm64/bin",
  "packages/jit-cli-linux-x64/bin",
  "packages/jit-cli-win32-x64/bin",
];
const generatedRootPattern = /\.(?:js|cjs|d\.ts|d\.cts|d\.mts)$/;

for (const directory of generatedDirectories) {
  rmSync(join(root, directory), { recursive: true, force: true });
}

for (const entry of readdirSync(join(root, "packages/jit"))) {
  if (generatedRootPattern.test(entry)) rmSync(join(root, "packages/jit", entry), { force: true });
}

removeSideBySideEmits(join(root, "packages/jit/src"));

function removeSideBySideEmits(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      removeSideBySideEmits(path);
      continue;
    }

    const source = sourceCounterpart(path);
    if (source && existsSync(source)) rmSync(path, { force: true });
  }
}

function sourceCounterpart(path) {
  if (path.endsWith(".d.cts") || path.endsWith(".d.mts") || path.endsWith(".d.ts")) {
    return path.replace(/\.d\.(?:c|m)?ts$/, ".ts");
  }
  if (path.endsWith(".cjs") || path.endsWith(".js")) {
    return path.replace(/\.(?:cjs|js)$/, ".ts");
  }
  return undefined;
}
