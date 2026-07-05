#!/usr/bin/env node
/**
 * jit CLI — Prisma-style code generation with schema discovery.
 *
 * Usage:
 *   jit generate [files...] [--out <dir>] [--name <package-name>] [--watch]
 *
 * With no files, resolution order is:
 *   1. `jit.config.{ts,mts,js,mjs,cjs}` in the current directory
 *      (`schemas`, `outDir`, `packageName`);
 *   2. convention scan — every `*.jit.{ts,mts,js,mjs,cjs}` under the
 *      current directory (node_modules and dot-dirs excluded).
 *
 * Output is a self-contained dual-format package (`index.mjs` +
 * `index.cjs` + `.d.ts`/`.d.cts`), default `node_modules/@jit/generated`.
 * TypeScript schema files load natively on runtimes that strip types, or
 * through `jiti` when installed. `--watch` regenerates on file change.
 */
import { watch } from "node:fs";
import { resolve } from "node:path";
import { collectSchemas, discoverSchemaFiles, findConfigFile, type JitConfig, loadModule } from "./aot/discover.js";
import { generate } from "./aot/generate.js";

interface CliArguments {
  readonly files: readonly string[];
  readonly outDir: string | undefined;
  readonly packageName: string | undefined;
  readonly watch: boolean;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command !== "generate") {
    process.stderr.write("Usage: jit generate [files...] [--out <dir>] [--name <package-name>] [--watch]\n");
    return 1;
  }

  const parsed = parseArguments(rest);
  let files = parsed.files;
  let outDir = parsed.outDir;
  let packageName = parsed.packageName;

  if (files.length === 0) {
    const configFile = findConfigFile(process.cwd());

    if (configFile) {
      const loaded = await loadModule(configFile);
      const config = (loaded.default ?? loaded) as JitConfig;

      files = expandConfigSchemas(config.schemas);
      outDir = outDir ?? (config.outDir ? resolve(config.outDir) : undefined);
      packageName = packageName ?? config.packageName;
      process.stdout.write(`using ${configFile}\n`);
    }

    if (files.length === 0) files = discoverSchemaFiles(process.cwd());
  }

  if (files.length === 0) {
    process.stderr.write("No schema files found: pass files, add jit.config.*, or create *.jit.ts modules\n");
    return 1;
  }

  const resolvedOut = outDir ?? resolve("node_modules/@jit/generated");
  const runOnce = async (): Promise<number> => {
    const { schemas } = await collectSchemas(files);

    if (Object.keys(schemas).length === 0) {
      process.stderr.write(`No exported schemas found in: ${files.join(", ")}\n`);
      return 1;
    }

    const result = generate({
      schemas,
      outDir: resolvedOut,
      ...(packageName ? { packageName } : {}),
    });

    for (const file of result.files) {
      process.stdout.write(`generated ${file}\n`);
    }

    for (const skip of result.skipped) {
      process.stdout.write(`skipped ${skip.schema}.${skip.operation}: ${skip.reason}\n`);
    }

    return 0;
  };

  const code = await runOnce();

  if (!parsed.watch) return code;

  process.stdout.write(`watching ${files.length} schema file(s) — ctrl+c to stop\n`);

  let timer: ReturnType<typeof setTimeout> | undefined;

  for (const file of files) {
    watch(file, () => {
      // Debounce editor double-writes into one regeneration.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        runOnce().catch((error: unknown) => {
          process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        });
      }, 100);
    });
  }

  return new Promise<number>(() => {
    // watch mode runs until interrupted
  });
}

function expandConfigSchemas(entries: readonly string[] | undefined): string[] {
  if (!entries || entries.length === 0) return [];

  const files: string[] = [];

  for (const entry of entries) {
    const absolute = resolve(entry);

    if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(absolute)) {
      files.push(absolute);
    } else {
      files.push(...discoverSchemaFiles(absolute));
    }
  }

  return files;
}

function parseArguments(rest: readonly string[]): CliArguments {
  const files: string[] = [];
  let outDir: string | undefined;
  let packageName: string | undefined;
  let watchMode = false;

  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];

    if (argument === "--out") {
      const value = rest[++index];

      if (value) outDir = resolve(value);
      continue;
    }

    if (argument === "--name") {
      packageName = rest[++index];
      continue;
    }

    if (argument === "--watch") {
      watchMode = true;
      continue;
    }

    if (!argument.startsWith("--")) files.push(resolve(argument));
  }

  return { files, outDir, packageName, watch: watchMode };
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
