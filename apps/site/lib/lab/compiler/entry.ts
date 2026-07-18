import { type AotOutputFormat, generate } from "../../../../../packages/jit/src/aot/generate.js";
import type { SchemaInput } from "../../../../../packages/jit/src/core/builder/index.js";
import { JIT } from "../../../../../packages/jit/src/define.js";
import { getArtifact } from "../../../../../packages/jit/src/runtime/artifact-registry.js";
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
  const schemas: Record<string, SchemaInput> = {};
  const typeSchemas: Record<string, SchemaInput> = {};
  const functions: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(bindings)) {
    if (isSchema(value)) {
      if ((value as { readonly __jitAot?: unknown }).__jitAot === "grouped") schemas[name] = value;
      else typeSchemas[name] = value;
    } else if (getArtifact(value) !== undefined) {
      functions[name] = value;
    }
  }

  const result = generate({
    schemas,
    typeSchemas,
    functions,
    outDir: "/jit-lab",
    clean: true,
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

function isSchema(value: unknown): value is SchemaInput {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { readonly schema?: { readonly type?: unknown }; readonly type?: unknown };
  return typeof candidate.schema?.type === "string" || typeof candidate.type === "string";
}

function outputName(generated: string, requested: string): string {
  const base = requested.replace(/\.(?:d\.)?(?:ts|cts|mts|js|cjs|mjs)$/, "");
  if (generated === "index.d.ts") return `${base}.d.ts`;
  if (generated === "index.d.cts") return `${base}.d.cts`;
  const extension = generated.slice("index".length);
  return `${base}${extension}`;
}
