#!/usr/bin/env node
/**
 * jit CLI — Prisma-style code generation with declaration discovery.
 *
 * Usage:
 *   jit init [--force] [--format ts|mts|mjs|cjs] [--entries <path-or-glob>] [--pattern <glob>]
 *   jit generate [files...] [--out <dir>] [--output-format js|ts] [--watch] [--pattern <glob>]
 *   jit doctor [files...] [--pattern <glob>]
 *   jit explain [files...] [--pattern <glob>]
 *   jit list [files...] [--pattern <glob>]
 *   jit inspect <export> [files...] [--stage source|declaration|plan]
 *   jit clean [--out <dir>]
 *
 * `init` writes a typed `jit.config.*` in the current project root.
 * `generate` resolves config first, then falls back to pattern discovery.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
import { type AotOutputFormat, generate } from "./aot/generate.js";
import { getArtifact } from "./runtime/artifact-registry.js";

const DEFAULT_OUT_DIR = "generated/jit";
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
  readonly emit: JitConfig["emit"] | undefined;
  readonly outputFormat: AotOutputFormat | undefined;
}

interface ResolvedAotInputs extends Omit<GenerateArguments, "outputFormat"> {
  readonly outputFormat: AotOutputFormat;
  readonly configFile: string | undefined;
  readonly resolvedOut: string;
  readonly types: JitConfig["types"] | undefined;
}

interface LegacyJitConfig {
  readonly schemas?: readonly string[];
  readonly outDir?: string;
  readonly packageName?: string;
  readonly clean?: boolean;
  readonly compiler?: { readonly packageName?: string };
  readonly output?: {
    readonly directory?: string;
    readonly packageName?: string;
    readonly clean?: boolean;
  };
}

export interface InitArguments {
  readonly format: ConfigFormat;
  readonly force: boolean;
  readonly entries: readonly string[] | undefined;
  readonly outDir: string;
  readonly packageName: string | undefined;
  readonly patterns: readonly string[];
  readonly outputFormat?: AotOutputFormat;
}

export type ConfigFormat = (typeof CONFIG_FORMATS)[number];

const USAGE = `Usage:
  jit init [--force] [--format ts|mts|mjs|cjs] [--output-format ts|js|js-only] [--entries <path-or-glob>] [--out <dir>] [--name <package>] [--pattern <glob>]
  jit generate [files...] [--out <dir>] [--output-format ts|js|js-only] [--name <package>] [--watch] [--pattern <glob>] [--no-clean]
  jit doctor [files...] [--pattern <glob>]
  jit explain [files...] [--pattern <glob>]
  jit list [files...] [--pattern <glob>]
  jit inspect <export> [files...] [--stage source|declaration|plan]
  jit clean [--out <dir>]
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
    if (command === "list") return runList(parseGenerateArguments(rest, cwd), cwd, stdout, stderr);
    if (command === "inspect") return runInspect(parseInspectArguments(rest, cwd), cwd, stdout, stderr);
    if (command === "clean") return runClean(parseGenerateArguments(rest, cwd), cwd, stdout);
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
  writeExampleDeclaration(cwd);
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
  const { files, packageName, clean, emit, types, resolvedOut } = resolved;

  if (resolved.configFile) stdout(`using ${resolved.configFile}\n`);

  if (files.length === 0) {
    stderr("No declaration files found: pass files, add jit.config.*, or create *.jit.ts modules\n");
    return 1;
  }

  const runOnce = async (): Promise<number> => {
    const { schemas, typeSchemas, functions, sources } = await collectSchemas(files);

    if (Object.keys(schemas).length === 0 && Object.keys(functions).length === 0) {
      stderr(
        `No AOT functions found in: ${files.join(", ")}. Export standalone compiled functions or JIT.compile(schema, { ... }) objects.\n`
      );
      return 1;
    }

    const result = generate({
      schemas,
      typeSchemas,
      functions,
      sources,
      outDir: resolvedOut,
      ...(packageName ? { packageName } : {}),
      ...(clean !== undefined ? { clean } : {}),
      ...(emit !== undefined ? { emit } : {}),
      ...(types !== undefined ? { types } : {}),
      ...(resolved.outputFormat !== undefined ? { format: resolved.outputFormat } : {}),
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
  stdout(`format: ${resolved.outputFormat ?? "typescript"}\n`);
  const packageLayout = resolved.resolvedOut.split(/[\\/]+/).includes("node_modules");

  stdout(`layout: ${packageLayout ? "package" : "local"}\n`);
  if (packageLayout) stdout(`packageName: ${resolved.packageName ?? DEFAULT_PACKAGE_NAME}\n`);
  stdout(`patterns: ${(resolved.patterns ?? DEFAULT_SCHEMA_PATTERNS).join(", ")}\n`);
  stdout(
    `emit: subpathModules=${resolved.emit?.subpathModules ?? false}, manifest=${resolved.emit?.manifest ?? false}, plans=${resolved.emit?.plans ?? false}\n`
  );
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

async function runList(
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
  const schemaNames = Object.keys(schemas);
  const functionNames = Object.keys(functions);

  stdout("jit list\n");
  for (const name of schemaNames) stdout(`${name}: ${readOps(schemas[name]).join(", ") || "no selected operations"}\n`);
  for (const name of functionNames) {
    const artifact = getArtifact(functions[name]);

    stdout(
      `${name}: ${artifact ? artifact.kind : "unknown"}${artifact && "op" in artifact ? `:${artifact.op}` : ""}\n`
    );
  }

  if (schemaNames.length === 0 && functionNames.length === 0) {
    stderr("No AOT functions found in declaration files\n");
    return 1;
  }

  return 0;
}

interface InspectArguments {
  readonly target: string;
  readonly stage: string;
  readonly generate: GenerateArguments;
}

async function runInspect(
  parsed: InspectArguments,
  cwd: string,
  stdout: (text: string) => void,
  stderr: (text: string) => void
): Promise<number> {
  const resolved = await resolveAotInputs(parsed.generate, cwd);

  if (resolved.files.length === 0) {
    stderr("No declaration files found: pass files, add jit.config.*, or create *.jit.ts modules\n");
    return 1;
  }

  const { schemas, typeSchemas, functions, sources } = await collectSchemas(resolved.files);
  const schema = schemas[parsed.target];
  const fn = functions[parsed.target];

  if (schema === undefined && fn === undefined) {
    stderr(`AOT export "${parsed.target}" was not found\n`);
    return 1;
  }

  const descriptor =
    schema !== undefined
      ? {
          name: parsed.target,
          kind: "grouped",
          source: sources.get(parsed.target),
          operations: readOps(schema),
        }
      : {
          name: parsed.target,
          kind: getArtifact(fn)?.kind ?? "unknown",
          source: sources.get(parsed.target),
          operations: readFunctionOps(fn),
        };

  stdout(`jit inspect ${parsed.target}\n`);

  if (parsed.stage === "plan") {
    stdout(`${JSON.stringify(descriptor, null, 2)}\n`);
    return 0;
  }

  if (parsed.stage === "source" || parsed.stage === "declaration") {
    const tempDir = mkdtempSync(join(tmpdir(), "jit-inspect-"));

    try {
      generate({
        schemas,
        typeSchemas,
        functions,
        sources,
        outDir: tempDir,
        clean: true,
        format: resolved.outputFormat,
      });
      const file =
        resolved.outputFormat === "typescript"
          ? "index.ts"
          : parsed.stage === "source"
            ? "index.js"
            : resolved.outputFormat === "javascript"
              ? "index.d.ts"
              : undefined;

      if (!file) {
        stderr('output format "javascript-only" does not emit declarations\n');
        return 1;
      }
      stdout(readFileSync(join(tempDir, file), "utf8"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
    return 0;
  }

  stdout(`${JSON.stringify(descriptor, null, 2)}\n`);
  return 0;
}

async function runClean(parsed: GenerateArguments, cwd: string, stdout: (text: string) => void): Promise<number> {
  const resolved = await resolveAotInputs(parsed, cwd);

  rmSync(resolved.resolvedOut, { recursive: true, force: true });
  stdout(`removed ${resolved.resolvedOut}\n`);
  return 0;
}

async function resolveAotInputs(parsed: GenerateArguments, cwd: string): Promise<ResolvedAotInputs> {
  let files = [...parsed.files];
  let outDir = parsed.outDir;
  let packageName = parsed.packageName;
  let patterns = parsed.patterns;
  let clean = parsed.clean;
  let emit = parsed.emit;
  let outputFormat = parsed.outputFormat;
  let types: JitConfig["types"] | undefined;
  let configFile: string | undefined;

  if (files.length === 0) {
    configFile = findConfigFile(cwd);

    if (configFile) {
      const loaded = await loadModule(configFile);
      const config = (loaded.default ?? loaded) as JitConfig & LegacyJitConfig;
      const configDir = dirname(configFile);

      const entries = config.entries ?? config.schemas;
      const output = config.output;

      patterns = patterns ?? config.patterns;
      files = expandSchemaEntries(entries, configDir, patterns);
      outDir = outDir ?? (output?.directory ? resolve(configDir, output.directory) : undefined);
      outDir = outDir ?? (config.outDir ? resolve(configDir, config.outDir) : undefined);
      packageName = packageName ?? output?.packageName ?? config.packageName;
      clean = clean ?? output?.clean ?? config.clean;
      outputFormat = outputFormat ?? output?.format;
      emit = mergeEmit(config.emit, emit);
      types = config.types ?? (config.compiler?.packageName ? { package: config.compiler.packageName } : undefined);
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
    emit,
    outputFormat: outputFormat ?? "typescript",
    types,
    configFile,
    resolvedOut: outDir ?? resolve(cwd, DEFAULT_OUT_DIR),
  };
}

function readOps(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object") return [];

  const ops = (value as { readonly ops?: unknown }).ops;

  return Array.isArray(ops) ? ops.filter((op): op is string => typeof op === "string") : [];
}

function readFunctionOps(value: unknown): readonly string[] {
  const artifact = getArtifact(value);

  if (!artifact) return [];
  if ("op" in artifact) return [artifact.op];
  return [artifact.kind];
}

function mergeEmit(base: JitConfig["emit"], override: JitConfig["emit"]): JitConfig["emit"] | undefined {
  if (!base && !override) return undefined;
  return { ...base, ...override };
}

function parseGenerateArguments(rest: readonly string[], cwd: string): GenerateArguments {
  const files: string[] = [];
  let outDir: string | undefined;
  let packageName: string | undefined;
  let watchMode = false;
  let patterns: string[] | undefined;
  let clean: boolean | undefined;
  let emit: JitConfig["emit"] | undefined;
  let outputFormat: AotOutputFormat | undefined;

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

    if (argument === "--output-format") {
      outputFormat = parseOutputFormat(readValue(rest, ++index, "--output-format"));
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

    if (argument === "--subpath-modules") {
      emit = { ...emit, subpathModules: true };
      continue;
    }

    if (argument === "--no-subpath-modules") {
      emit = { ...emit, subpathModules: false };
      continue;
    }

    if (argument === "--manifest") {
      emit = { ...emit, manifest: true };
      continue;
    }

    if (argument === "--no-manifest") {
      emit = { ...emit, manifest: false };
      continue;
    }

    if (argument === "--plans") {
      emit = { ...emit, plans: true };
      continue;
    }

    if (argument === "--no-plans") {
      emit = { ...emit, plans: false };
      continue;
    }

    if (!argument.startsWith("--")) files.push(resolve(cwd, argument));
  }

  return { files, outDir, packageName, watch: watchMode, patterns, clean, emit, outputFormat };
}

function parseInspectArguments(rest: readonly string[], cwd: string): InspectArguments {
  const [target, ...tail] = rest;

  if (!target || target.startsWith("--")) throw new Error("jit inspect expects an export name");

  const forwarded: string[] = [];
  let stage = "plan";

  for (let index = 0; index < tail.length; index++) {
    const argument = tail[index];

    if (argument === "--stage") {
      stage = readValue(tail, ++index, "--stage");
      continue;
    }

    forwarded.push(argument);
  }

  return { target, stage, generate: parseGenerateArguments(forwarded, cwd) };
}

function parseInitArguments(rest: readonly string[]): InitArguments {
  let format: ConfigFormat = "ts";
  let force = false;
  let entries: string[] | undefined;
  let outDir = DEFAULT_OUT_DIR;
  let packageName: string | undefined;
  let patterns: string[] = [...DEFAULT_SCHEMA_PATTERNS];
  let outputFormat: AotOutputFormat | undefined;

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
      entries = [...(entries ?? []), readValue(rest, ++index, "--schemas")];
      continue;
    }

    if (argument === "--entries") {
      entries = [...(entries ?? []), readValue(rest, ++index, "--entries")];
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

    if (argument === "--output-format") {
      outputFormat = parseOutputFormat(readValue(rest, ++index, "--output-format"));
      continue;
    }

    if (argument === "--pattern") {
      patterns = [readValue(rest, ++index, "--pattern")];
    }
  }

  return {
    format,
    force,
    entries,
    outDir,
    packageName,
    patterns,
    ...(outputFormat !== undefined ? { outputFormat } : {}),
  };
}

export function createConfigSource(options: InitArguments): string {
  const lines = [
    "  /** Files, directories, or globs containing explicit compiled AOT exports. */",
    `  entries: ${formatStringArray(options.entries ?? ["./jit/**/*.jit.ts"])},`,
    "  /** Patterns used when an entry is a directory or discovery starts at the project root. */",
    `  patterns: ${formatStringArray(options.patterns)},`,
    "  output: {",
    "    /** Destination relative to this config file. */",
    `    directory: ${JSON.stringify(options.outDir)},`,
    '    /** "typescript" is safest; "javascript" adds .d.ts; "javascript-only" omits declarations. */',
    `    format: ${JSON.stringify(options.outputFormat ?? "typescript")},`,
    ...(options.packageName && options.outDir.split(/[\\/]+/).includes("node_modules")
      ? [
          "    /** Namespace override for this generated node_modules package. */",
          `    packageName: ${JSON.stringify(options.packageName)},`,
        ]
      : []),
    "    /** Delete only JIT-owned artifacts before each generation. */",
    "    clean: true,",
    "  },",
    "  emit: {",
    "    /** Add one tree-shakable entry point per declaration file. */",
    "    subpathModules: true,",
    "    /** Describe generated imports and selected operations. */",
    "    manifest: true,",
    "    /** Persist deterministic operation plans for inspection and tooling. */",
    "    plans: true,",
    "  },",
    "  types: {",
    "    /** Package that exports JIT.Typeof and JIT.Strict for generated declarations. */",
    '    package: "@jit-compiler/jit",',
    "  },",
  ];

  if (options.format === "cjs") {
    return `/** @type {import("@jit-compiler/jit").AOT.JitConfig} */\nmodule.exports = {\n${lines.join("\n")}\n};\n`;
  }

  return `import { AOT } from "@jit-compiler/jit";\n\nexport default AOT.defineConfig({\n${lines.join("\n")}\n});\n`;
}

function writeExampleDeclaration(cwd: string): void {
  const dir = join(cwd, "jit");
  const file = join(dir, "user.jit.ts");

  if (existsSync(file)) return;

  mkdirSync(dir, { recursive: true });
  writeFileSync(
    file,
    [
      'import { JIT } from "@jit-compiler/jit/define";',
      "",
      "export const User = JIT.object({",
      "  id: JIT.int(),",
      "  name: JIT.string().trim().min(1),",
      "});",
      "",
      "export const isUser = JIT.validate(User).is().compile();",
      "export const parseUser = JIT.validate(User).parse().compile();",
      "export const stringifyUser = JIT.json(User).stringify().compile();",
      "",
    ].join("\n")
  );
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

function parseOutputFormat(value: string): AotOutputFormat {
  if (value === "js" || value === "javascript") return "javascript";
  if (value === "js-only" || value === "javascript-only") return "javascript-only";
  if (value === "ts" || value === "typescript") return "typescript";
  throw new Error(`unknown output format "${value}"`);
}

function formatStringArray(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];

  return entry !== undefined && import.meta.url === pathToFileURL(realpathSync(resolve(entry))).href;
}

if (isDirectRun()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
