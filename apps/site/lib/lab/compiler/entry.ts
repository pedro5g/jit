import { classifyDeclarations } from "../../../../../packages/jit/src/aot/classify.js";
import { type AotOutputFormat, generate } from "../../../../../packages/jit/src/aot/generate.js";
import { JIT } from "../../../../../packages/jit/src/define.js";
import { readVirtualFile, resetVirtualFiles } from "./virtual-fs.js";
import { basename } from "./virtual-path.js";

export { JIT };

export interface BrowserCompileOptions {
  readonly format: AotOutputFormat;
  readonly fileName: string;
}

export interface BrowserCompiledFile {
  readonly path: string;
  readonly source: string;
}

export interface BrowserCompileResult {
  readonly files: readonly BrowserCompiledFile[];
  readonly skipped: readonly { readonly operation: string; readonly reason: string; readonly schema: string }[];
}

export function compileBindings(
  bindings: Readonly<Record<string, unknown>>,
  options: BrowserCompileOptions
): BrowserCompileResult {
  resetVirtualFiles();

  // The editor buffer is a declaration file: the same classifier the CLI
  // uses decides what each top-level binding generates.
  const result = generate({
    ...classifyDeclarations(bindings),
    outDir: "/jit-lab",
    format: options.format,
  });

  return {
    files: result.files.map((path) => ({
      path: outputName(basename(path), options.fileName),
      source: readVirtualFile(path),
    })),
    skipped: result.skipped,
  };
}

function outputName(generated: string, requested: string): string {
  const base = requested.replace(/\.(?:d\.)?(?:ts|cts|mts|js|cjs|mjs)$/, "");
  const extension = generated.slice("index".length);
  return `${base}${extension}`;
}
