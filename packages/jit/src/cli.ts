#!/usr/bin/env node
/**
 * jit CLI — Prisma-style code generation with declaration discovery.
 *
 * Usage:
 *   jit init [--force] [--format ts|mts|mjs|cjs] [--schemas <path-or-glob>] [--pattern <glob>]
 *   jit generate [files...] [--out <dir>] [--name <package-name>] [--watch] [--pattern <glob>]
 *   jit doctor [files...] [--pattern <glob>]
 *   jit explain [files...] [--pattern <glob>]
 *
 * `init` writes a typed `jit.config.*` in the current project root.
 * `generate` resolves config first, then falls back to pattern discovery.
 */
import { existsSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  collectSchemas,
  DEFAULT_SCHEMA_PATTERNS,
  discoverSchemaFiles,
  expandSchemaEntries,
  findConfigFile,
  type JitConfig,
  loadModule,
} from "./aot/discover.js";
import { generate } from "./aot/generate.js";
import { getArtifact } from "./runtime/artifact-registry.js";

const DEFAULT_OUT_DIR = "node_modules/@jit/generated";
const DEFAULT_PACKAGE_NAME = "@jit/generated";
const CONFIG_FORMATS = ["ts", "mts", "mjs", "cjs"] as const;

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
  readonly patterns: readonly string[] | undefined;
  readonly clean: boolean | undefined;
  readonly emitPackageJson: boolean | undefined;
}

interface ResolvedAotInputs extends GenerateArguments {
  readonly configFile: string | undefined;
  readonly resolvedOut: string;
}

export interface InitArguments {
  readonly format: ConfigFormat;
  readonly force: boolean;
  readonly schemas: readonly string[] | undefined;
  readonly outDir: string;
  readonly packageName: string;
  readonly patterns: readonly string[];
}

export type ConfigFormat = (typeof CONFIG_FORMATS)[number];

const USAGE = `Usage:
  jit init [--force] [--format ts|mts|mjs|cjs] [--schemas <path-or-glob>] [--out <dir>] [--name <package>] [--pattern <glob>]
  jit generate [files...] [--out <dir>] [--name <package>] [--watch] [--pattern <glob>] [--no-clean] [--no-package-json]
  jit doctor [files...] [--pattern <glob>]
  jit explain [files...] [--pattern <glob>]
`;

export async function main(argv: readonly string[], runtime: CliRuntime = {}): Promise<number> {
  const [command, ...rest] = argv;
  const cwd = runtime.cwd ?? process.cwd();
  const stdout = runtime.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = runtime.stderr ?? ((text: string) => process.stderr.write(text));

  try {
    if (command === "init") return runInit(parseInitArguments(rest), cwd, stdout, stderr);
    if (command === "generate") return runGenerate(parseGenerateArguments(rest, cwd), cwd, stdout, stderr);
    if (command === "doctor") return runDoctor(parseGenerateArguments(rest, cwd), cwd, stdout);
    if (command === "explain") return runExplain(parseGenerateArguments(rest, cwd), cwd, stdout, stderr);
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
  const resolved = await resolveAotInputs(parsed, cwd);
  const { files, packageName, clean, emitPackageJson, resolvedOut } = resolved;

  if (resolved.configFile) stdout(`using ${resolved.configFile}\n`);

  if (files.length === 0) {
    stderr("No declaration files found: pass files, add jit.config.*, or create *.jit.ts modules\n");
    return 1;
  }

  const runOnce = async (): Promise<number> => {
    const { schemas, functions, sources } = await collectSchemas(files);

    if (Object.keys(schemas).length === 0 && Object.keys(functions).length === 0) {
      stderr(
        `No AOT functions found in: ${files.join(", ")}. Export standalone compiled functions or JIT.compile(schema, { ... }) objects.\n`
      );
      return 1;
    }

    const result = generate({
      schemas,
      functions,
      sources,
      outDir: resolvedOut,
      ...(packageName ? { packageName } : {}),
      ...(clean !== undefined ? { clean } : {}),
      ...(emitPackageJson !== undefined ? { emitPackageJson } : {}),
    });

    for (const skip of result.skipped) {
      stdout(`skipped ${skip.schema}.${skip.operation}: ${skip.reason}\n`);
    }

    if (result.files.length === 0) {
      stderr("No AOT functions could be generated. Check skipped entries above for details.\n");
      return 1;
    }

    for (const file of result.files) {
      stdout(`generated ${file}\n`);
    }

    return 0;
  };

  const code = await runOnce();

  if (!parsed.watch) return code;

  stdout(`watching ${files.length} declaration file(s) — ctrl+c to stop\n`);

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

async function runDoctor(parsed: GenerateArguments, cwd: string, stdout: (text: string) => void): Promise<number> {
  const resolved = await resolveAotInputs(parsed, cwd);

  stdout("jit doctor\n");
  stdout(`cwd: ${cwd}\n`);
  stdout(`config: ${resolved.configFile ?? "not found"}\n`);
  stdout(`outDir: ${resolved.resolvedOut}\n`);
  stdout(`packageName: ${resolved.packageName ?? DEFAULT_PACKAGE_NAME}\n`);
  stdout(`patterns: ${(resolved.patterns ?? DEFAULT_SCHEMA_PATTERNS).join(", ")}\n`);
  stdout(`files: ${resolved.files.length}\n`);
  for (const file of resolved.files) stdout(`  - ${file}\n`);

  return resolved.files.length === 0 ? 1 : 0;
}

async function runExplain(
  parsed: GenerateArguments,
  cwd: string,
  stdout: (text: string) => void,
  stderr: (text: string) => void
): Promise<number> {
  const resolved = await resolveAotInputs(parsed, cwd);

  if (resolved.files.length === 0) {
    stderr("No declaration files found: pass files, add jit.config.*, or create *.jit.ts modules\n");
    return 1;
  }

  const { schemas, functions } = await collectSchemas(resolved.files);

  stdout("jit explain\n");
  stdout(`files: ${resolved.files.length}\n`);
  stdout(`grouped objects: ${Object.keys(schemas).length}\n`);
  for (const [name, value] of Object.entries(schemas)) {
    stdout(`  - ${name}: ${readOps(value).join(", ") || "no selected operations"}\n`);
  }
  stdout(`standalone functions: ${Object.keys(functions).length}\n`);
  for (const [name, value] of Object.entries(functions)) {
    const artifact = getArtifact(value);

    stdout(
      `  - ${name}: ${artifact ? artifact.kind : "unknown"}${artifact && "op" in artifact ? `:${artifact.op}` : ""}\n`
    );
  }

  if (Object.keys(schemas).length === 0 && Object.keys(functions).length === 0) {
    stderr("No AOT functions found in declaration files\n");
    return 1;
  }

  return 0;
}

async function resolveAotInputs(parsed: GenerateArguments, cwd: string): Promise<ResolvedAotInputs> {
  let files = [...parsed.files];
  let outDir = parsed.outDir;
  let packageName = parsed.packageName;
  let patterns = parsed.patterns;
  let clean = parsed.clean;
  let emitPackageJson = parsed.emitPackageJson;
  let configFile: string | undefined;

  if (files.length === 0) {
    configFile = findConfigFile(cwd);

    if (configFile) {
      const loaded = await loadModule(configFile);
      const config = (loaded.default ?? loaded) as JitConfig;
      const configDir = dirname(configFile);

      patterns = patterns ?? config.patterns;
      files = expandSchemaEntries(config.schemas, configDir, patterns);
      outDir = outDir ?? (config.outDir ? resolve(configDir, config.outDir) : undefined);
      packageName = packageName ?? config.packageName;
      clean = clean ?? config.clean;
      emitPackageJson = emitPackageJson ?? config.emitPackageJson;
    }

    if (files.length === 0) files = discoverSchemaFiles(cwd, patterns);
  }

  return {
    ...parsed,
    files,
    outDir,
    packageName,
    patterns,
    clean,
    emitPackageJson,
    configFile,
    resolvedOut: outDir ?? resolve(cwd, DEFAULT_OUT_DIR),
  };
}

function readOps(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object") return [];

  const ops = (value as { readonly ops?: unknown }).ops;

  return Array.isArray(ops) ? ops.filter((op): op is string => typeof op === "string") : [];
}

function parseGenerateArguments(rest: readonly string[], cwd: string): GenerateArguments {
  const files: string[] = [];
  let outDir: string | undefined;
  let packageName: string | undefined;
  let watchMode = false;
  let patterns: string[] | undefined;
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

    if (argument === "--pattern") {
      patterns = [...(patterns ?? []), readValue(rest, ++index, "--pattern")];
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

  return { files, outDir, packageName, watch: watchMode, patterns, clean, emitPackageJson };
}

function parseInitArguments(rest: readonly string[]): InitArguments {
  let format: ConfigFormat = "ts";
  let force = false;
  let schemas: string[] | undefined;
  let outDir = DEFAULT_OUT_DIR;
  let packageName = DEFAULT_PACKAGE_NAME;
  let patterns: string[] = [...DEFAULT_SCHEMA_PATTERNS];

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

    if (argument === "--pattern") {
      patterns = [readValue(rest, ++index, "--pattern")];
    }
  }

  return { format, force, schemas, outDir, packageName, patterns };
}

export function createConfigSource(options: InitArguments): string {
  const lines = [
    "  // Omit schemas to scan from the project root. Entries can be files, directories, or globs.",
    ...(options.schemas
      ? [`  schemas: ${formatStringArray(options.schemas)},`]
      : ['  // schemas: ["src/schemas/**/*.ts"],']),
    "  // Default discovery is **/*.jit.ts; change or add patterns when your declarations use another shape.",
    `  patterns: ${formatStringArray(options.patterns)},`,
    "  // Generated files are importable directly from your app.",
    `  outDir: ${JSON.stringify(options.outDir)},`,
    `  packageName: ${JSON.stringify(options.packageName)},`,
    "  // Use false when generating into a project source folder instead of node_modules/@jit/generated.",
    "  emitPackageJson: true,",
    "  // Delete only jit's known generated files before writing fresh output.",
    "  clean: true,",
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
