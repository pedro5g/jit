#!/usr/bin/env node
/**
 * jit CLI — Prisma-style code generation.
 *
 * Usage:
 *   jit generate <schemas-file> [--out <dir>] [--name <package-name>]
 *
 * Loads the given module, collects every exported schema/builder, and
 * writes plain optimized `.js` + `.d.ts` (default: `node_modules/@jit/generated`).
 * Point `<schemas-file>` at a `.js`/`.mjs` module (or run through a TS
 * loader such as tsx for `.ts` files).
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generate } from "./aot/generate.js";
import type { SchemaInput } from "./core/builder/index.js";

interface CliArguments {
  readonly file: string;
  readonly outDir: string;
  readonly packageName: string | undefined;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command !== "generate" || rest.length === 0) {
    process.stderr.write("Usage: jit generate <schemas-file> [--out <dir>] [--name <package-name>]\n");
    return 1;
  }

  const parsed = parseArguments(rest);
  const moduleUrl = pathToFileURL(resolve(parsed.file)).href;
  const loaded = (await import(moduleUrl)) as Record<string, unknown>;
  const schemas: Record<string, SchemaInput> = {};

  for (const name of Object.keys(loaded)) {
    if (isSchemaInput(loaded[name])) schemas[name] = loaded[name] as SchemaInput;
  }

  if (Object.keys(schemas).length === 0) {
    process.stderr.write(`No exported schemas found in ${parsed.file}\n`);
    return 1;
  }

  const result = generate({
    schemas,
    outDir: parsed.outDir,
    ...(parsed.packageName ? { packageName: parsed.packageName } : {}),
  });

  for (const file of result.files) {
    process.stdout.write(`generated ${file}\n`);
  }

  for (const skip of result.skipped) {
    process.stdout.write(`skipped ${skip.schema}.${skip.operation}: ${skip.reason}\n`);
  }

  return 0;
}

function parseArguments(rest: readonly string[]): CliArguments {
  let file = "";
  let outDir = resolve("node_modules/@jit/generated");
  let packageName: string | undefined;

  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];

    if (argument === "--out") {
      outDir = resolve(rest[++index] ?? outDir);
      continue;
    }

    if (argument === "--name") {
      packageName = rest[++index];
      continue;
    }

    if (!argument.startsWith("--")) file = argument;
  }

  return { file, outDir, packageName };
}

function isSchemaInput(candidate: unknown): boolean {
  if (candidate === null || typeof candidate !== "object") return false;

  const value = candidate as { schema?: { type?: unknown }; type?: unknown; def?: unknown };

  if (value.schema && typeof value.schema === "object" && typeof value.schema.type === "string") return true;
  return typeof value.type === "string" && value.def !== undefined;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
);
