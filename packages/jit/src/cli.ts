#!/usr/bin/env node
/**
 * jit CLI — Prisma-style code generation with schema discovery.
 *
 * Usage:
 *   jit init [--force] [--format ts|mts|mjs|cjs] [--schemas <path>]
 *   jit generate [files...] [--out <dir>] [--name <package-name>] [--watch]
 *
 * `init` writes a typed `jit.config.*` in the current project root.
 * `generate` resolves config first, then falls back to `*.jit.*` discovery.
 */
import { existsSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { collectSchemas, discoverSchemaFiles, findConfigFile, type JitConfig, loadModule } from "./aot/discover.js";
import { AOT_OPERATIONS, type AotExportMode, type AotOperation, generate } from "./aot/generate.js";

const DEFAULT_OUT_DIR = "node_modules/@jit/generated";
const DEFAULT_PACKAGE_NAME = "@jit/generated";
const DEFAULT_SCHEMAS = ["src"] as const;
const DEFAULT_OPERATIONS = ["is", "parse", "safeParse"] as const satisfies readonly AotOperation[];
const CONFIG_FORMATS = ["ts", "mts", "mjs", "cjs"] as const;
const EXPORT_MODES = ["auto", "flat", "grouped", "both"] as const satisfies readonly AotExportMode[];

export interface CliRuntime {
  readonly cwd?: string;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}

interface GenerateArguments {
  readonly files: readonly string[];
  readonly outDir: string | undefined;
  readonly packageName: string | undefined;
  readonly watch: boolean;
  readonly operations: readonly AotOperation[] | undefined;
  readonly exportMode: AotExportMode | undefined;
  readonly clean: boolean | undefined;
  readonly emitPackageJson: boolean | undefined;
}

export interface InitArguments {
  readonly format: ConfigFormat;
  readonly force: boolean;
  readonly schemas: readonly string[];
  readonly outDir: string;
  readonly packageName: string;
  readonly operations: readonly AotOperation[];
  readonly exportMode: AotExportMode;
}

export type ConfigFormat = (typeof CONFIG_FORMATS)[number];

const USAGE = `Usage:
  jit init [--force] [--format ts|mts|mjs|cjs] [--schemas <path>] [--out <dir>] [--name <package>] [--ops is,parse] [--export auto|flat|grouped|both]
  jit generate [files...] [--out <dir>] [--name <package>] [--watch] [--ops is,parse] [--export auto|flat|grouped|both] [--no-clean] [--no-package-json]
`;

export async function main(argv: readonly string[], runtime: CliRuntime = {}): Promise<number> {
  const [command, ...rest] = argv;
  const cwd = runtime.cwd ?? process.cwd();
  const stdout = runtime.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = runtime.stderr ?? ((text: string) => process.stderr.write(text));

  try {
    if (command === "init") return runInit(parseInitArguments(rest), cwd, stdout, stderr);
    if (command === "generate") return runGenerate(parseGenerateArguments(rest, cwd), cwd, stdout, stderr);
    if (command === "--help" || command === "-h" || command === undefined) {
      stdout(USAGE);
      return command === undefined ? 1 : 0;
    }

    stderr(USAGE);
    return 1;
  } catch (error: unknown) {
    stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function runInit(
  parsed: InitArguments,
  cwd: string,
  stdout: (text: string) => void,
  stderr: (text: string) => void
): number {
  const configFile = join(cwd, `jit.config.${parsed.format}`);

  if (existsSync(configFile) && !parsed.force) {
    stderr(`jit config already exists at ${configFile}; pass --force to overwrite it\n`);
    return 1;
  }

  writeFileSync(configFile, createConfigSource(parsed));
  stdout(`created ${configFile}\n`);
  return 0;
}

async function runGenerate(
  parsed: GenerateArguments,
  cwd: string,
  stdout: (text: string) => void,
  stderr: (text: string) => void
): Promise<number> {
  let files = [...parsed.files];
  let outDir = parsed.outDir;
  let packageName = parsed.packageName;
  let operations = parsed.operations;
  let schemaOperations: JitConfig["schemaOperations"];
  let exportMode = parsed.exportMode;
  let clean = parsed.clean;
  let emitPackageJson = parsed.emitPackageJson;

  if (files.length === 0) {
    const configFile = findConfigFile(cwd);

    if (configFile) {
      const loaded = await loadModule(configFile);
      const config = (loaded.default ?? loaded) as JitConfig;
      const configDir = dirname(configFile);

      files = expandConfigSchemas(config.schemas, configDir);
      outDir = outDir ?? (config.outDir ? resolve(configDir, config.outDir) : undefined);
      packageName = packageName ?? config.packageName;
      operations = operations ?? config.operations;
      schemaOperations = config.schemaOperations;
      exportMode = exportMode ?? config.exportMode;
      clean = clean ?? config.clean;
      emitPackageJson = emitPackageJson ?? config.emitPackageJson;
      stdout(`using ${configFile}\n`);
    }

    if (files.length === 0) files = discoverSchemaFiles(cwd);
  }

  if (files.length === 0) {
    stderr("No schema files found: pass files, add jit.config.*, or create *.jit.ts modules\n");
    return 1;
  }

  const resolvedOut = outDir ?? resolve(cwd, DEFAULT_OUT_DIR);
  const runOnce = async (): Promise<number> => {
    const { schemas, sources } = await collectSchemas(files);

    if (Object.keys(schemas).length === 0) {
      stderr(`No exported schemas found in: ${files.join(", ")}\n`);
      return 1;
    }

    const result = generate({
      schemas,
      sources,
      outDir: resolvedOut,
      ...(packageName ? { packageName } : {}),
      ...(operations ? { operations } : {}),
      ...(schemaOperations ? { schemaOperations } : {}),
      ...(exportMode ? { exportMode } : {}),
      ...(clean !== undefined ? { clean } : {}),
      ...(emitPackageJson !== undefined ? { emitPackageJson } : {}),
    });

    for (const file of result.files) {
      stdout(`generated ${file}\n`);
    }

    for (const skip of result.skipped) {
      stdout(`skipped ${skip.schema}.${skip.operation}: ${skip.reason}\n`);
    }

    return 0;
  };

  const code = await runOnce();

  if (!parsed.watch) return code;

  stdout(`watching ${files.length} schema file(s) — ctrl+c to stop\n`);

  let timer: ReturnType<typeof setTimeout> | undefined;

  for (const file of files) {
    watch(file, () => {
      // Debounce editor double-writes into one regeneration.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        runOnce().catch((error: unknown) => {
          stderr(`${error instanceof Error ? error.message : String(error)}\n`);
        });
      }, 100);
    });
  }

  return new Promise<number>(() => {
    // watch mode runs until interrupted
  });
}

function expandConfigSchemas(entries: readonly string[] | undefined, baseDir: string): string[] {
  if (!entries || entries.length === 0) return [];

  const files: string[] = [];

  for (const entry of entries) {
    const absolute = resolve(baseDir, entry);

    if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(absolute)) {
      files.push(absolute);
    } else {
      files.push(...discoverSchemaFiles(absolute));
    }
  }

  return files;
}

function parseGenerateArguments(rest: readonly string[], cwd: string): GenerateArguments {
  const files: string[] = [];
  let outDir: string | undefined;
  let packageName: string | undefined;
  let watchMode = false;
  let operations: readonly AotOperation[] | undefined;
  let exportMode: AotExportMode | undefined;
  let clean: boolean | undefined;
  let emitPackageJson: boolean | undefined;

  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];

    if (argument === "--out") {
      outDir = resolve(cwd, readValue(rest, ++index, "--out"));
      continue;
    }

    if (argument === "--name") {
      packageName = readValue(rest, ++index, "--name");
      continue;
    }

    if (argument === "--watch") {
      watchMode = true;
      continue;
    }

    if (argument === "--ops") {
      operations = parseOperations(readValue(rest, ++index, "--ops"));
      continue;
    }

    if (argument === "--export") {
      exportMode = parseExportMode(readValue(rest, ++index, "--export"));
      continue;
    }

    if (argument === "--clean") {
      clean = true;
      continue;
    }

    if (argument === "--no-clean") {
      clean = false;
      continue;
    }

    if (argument === "--package-json") {
      emitPackageJson = true;
      continue;
    }

    if (argument === "--no-package-json") {
      emitPackageJson = false;
      continue;
    }

    if (!argument.startsWith("--")) files.push(resolve(cwd, argument));
  }

  return { files, outDir, packageName, watch: watchMode, operations, exportMode, clean, emitPackageJson };
}

function parseInitArguments(rest: readonly string[]): InitArguments {
  let format: ConfigFormat = "ts";
  let force = false;
  let schemas: string[] | undefined;
  let outDir = DEFAULT_OUT_DIR;
  let packageName = DEFAULT_PACKAGE_NAME;
  let operations: readonly AotOperation[] = DEFAULT_OPERATIONS;
  let exportMode: AotExportMode = "auto";

  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];

    if (argument === "--format") {
      format = parseFormat(readValue(rest, ++index, "--format"));
      continue;
    }

    if (argument === "--force" || argument === "-f") {
      force = true;
      continue;
    }

    if (argument === "--yes" || argument === "-y") continue;

    if (argument === "--schemas") {
      schemas = [...(schemas ?? []), readValue(rest, ++index, "--schemas")];
      continue;
    }

    if (argument === "--out") {
      outDir = readValue(rest, ++index, "--out");
      continue;
    }

    if (argument === "--name") {
      packageName = readValue(rest, ++index, "--name");
      continue;
    }

    if (argument === "--ops") {
      operations = parseOperations(readValue(rest, ++index, "--ops"));
      continue;
    }

    if (argument === "--export") {
      exportMode = parseExportMode(readValue(rest, ++index, "--export"));
    }
  }

  return {
    format,
    force,
    schemas: schemas ?? DEFAULT_SCHEMAS,
    outDir,
    packageName,
    operations,
    exportMode,
  };
}

export function createConfigSource(options: InitArguments): string {
  const lines = [
    "  // Files or directories scanned for *.jit.{ts,mts,cts,js,mjs,cjs}.",
    `  schemas: ${formatStringArray(options.schemas)},`,
    "  // Generated files are importable directly from your app.",
    `  outDir: ${JSON.stringify(options.outDir)},`,
    `  packageName: ${JSON.stringify(options.packageName)},`,
    "  // Raw schemas use this allowlist; JIT.compile markers stay explicit per schema.",
    `  operations: ${formatStringArray(options.operations)},`,
    "  // auto: JIT.compile(schema, { ... }) => User object; raw schemas => User_is flats.",
    `  exportMode: ${JSON.stringify(options.exportMode)},`,
    "  // Delete only jit's known generated files before writing fresh output.",
    "  clean: true,",
    "  emitPackageJson: true,",
  ];

  if (options.format === "cjs") {
    return `/** @type {import("jit").AOT.JitConfig} */\nmodule.exports = {\n${lines.join("\n")}\n};\n`;
  }

  return `import { AOT } from "jit";\n\nexport default AOT.defineConfig({\n${lines.join("\n")}\n});\n`;
}

function readValue(values: readonly string[], index: number, flag: string): string {
  const value = values[index];

  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} expects a value`);
  return value;
}

function parseFormat(value: string): ConfigFormat {
  if ((CONFIG_FORMATS as readonly string[]).includes(value)) return value as ConfigFormat;
  throw new Error(`unknown config format "${value}"`);
}

function parseExportMode(value: string): AotExportMode {
  if ((EXPORT_MODES as readonly string[]).includes(value)) return value as AotExportMode;
  throw new Error(`unknown export mode "${value}"`);
}

function parseOperations(value: string): readonly AotOperation[] {
  const operations = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const operation of operations) {
    if (!(AOT_OPERATIONS as readonly string[]).includes(operation)) {
      throw new Error(`unknown AOT operation "${operation}"`);
    }
  }

  return operations as readonly AotOperation[];
}

function formatStringArray(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];

  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
