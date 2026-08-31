#!/usr/bin/env node
/**
 * jit CLI — Prisma-style code generation with declaration discovery.
 *
 * Usage:
 *   jit init [--force] [--out <dir>] [--format ts|js] [--entries <path-or-glob>]
 *   jit generate [files...] [--out <dir>] [--format ts|js] [--watch] [--pattern <glob>]
 *   jit doctor [files...] [--pattern <glob>]
 *   jit list [files...] [--pattern <glob>]
 *   jit inspect <export> [files...] [--stage source|plan]
 *   jit clean [--out <dir>]
 *
 * `init` writes a `jit.config.*` in the current project root.
 * `generate` resolves config first, then falls back to pattern discovery.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  collectDeclarations,
  DEFAULT_SCHEMA_PATTERNS,
  discoverSchemaFiles,
  expandSchemaEntries,
  findConfigFile,
  type JitConfig,
  loadModule,
} from "./aot/discover.js";
import { type AotOutputFormat, generate } from "./aot/generate.js";
import { getArtifact } from "./runtime/artifact-registry.js";

/** Generated output lands beside the config file, so no `src/` tree is assumed. */
const DEFAULT_OUT_DIR = "generated";

export interface CliRuntime {
  readonly cwd?: string;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}

interface GenerateArguments {
  readonly files: readonly string[];
  readonly outDir: string | undefined;
  readonly watch: boolean;
  readonly patterns: readonly string[] | undefined;
  readonly format: AotOutputFormat | undefined;
  readonly perFile: boolean | undefined;
}

interface ResolvedAotInputs extends Omit<GenerateArguments, "format"> {
  readonly format: AotOutputFormat;
  readonly configFile: string | undefined;
  readonly resolvedOut: string;
}

export interface InitArguments {
  readonly force: boolean;
  readonly entries: readonly string[] | undefined;
  readonly outDir: string;
  readonly format: AotOutputFormat | undefined;
  readonly perFile: boolean;
}

const USAGE = `Usage:
  jit init [--force] [--out <dir>] [--format ts|js] [--entries <path-or-glob>]
  jit generate [files...] [--out <dir>] [--format ts|js] [--per-file] [--watch] [--pattern <glob>]
  jit doctor [files...] [--pattern <glob>]
  jit list [files...] [--pattern <glob>]
  jit inspect <export> [files...] [--stage source|plan]
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
  // A TypeScript project gets a typed config and typed output; everything
  // else gets plain ESM it can run without a build step.
  const format = parsed.format ?? (existsSync(join(cwd, "tsconfig.json")) ? "ts" : "js");
  const configFile = join(cwd, `jit.config.${format}`);

  if (existsSync(configFile) && !parsed.force) {
    stderr(`jit config already exists at ${configFile}; pass --force to overwrite it\n`);
    return 1;
  }

  writeFileSync(configFile, createConfigSource({ ...parsed, format }));
  writeExampleDeclaration(cwd, format);
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
  const { files, resolvedOut } = resolved;

  if (resolved.configFile) stdout(`using ${resolved.configFile}\n`);

  if (files.length === 0) {
    stderr("No declaration files found: pass files, add jit.config.*, or create *.jit.ts modules\n");
    return 1;
  }

  const runOnce = async (): Promise<number> => {
    const declarations = await collectDeclarations(files);

    if (
      Object.keys(declarations.artifacts).length === 0 &&
      Object.keys(declarations.groups).length === 0 &&
      Object.keys(declarations.schemas).length === 0
    ) {
      stderr(
        `No exported AOT declarations found in: ${files.join(", ")}. Export compiled JIT artifacts or JIT.Typeof aliases.\n`
      );
      return 1;
    }

    const result = generate({
      ...declarations,
      outDir: resolvedOut,
      format: resolved.format,
      perFile: resolved.perFile === true,
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
  stdout(`format: ${resolved.format}\n`);
  stdout(`layout: ${resolved.perFile ? "one module per declaration file" : "single index module"}\n`);
  stdout(`patterns: ${(resolved.patterns ?? DEFAULT_SCHEMA_PATTERNS).join(", ")}\n`);
  stdout(`files: ${resolved.files.length}\n`);
  for (const file of resolved.files) stdout(`  - ${file}\n`);

  return resolved.files.length === 0 ? 1 : 0;
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

  const { artifacts, groups, schemas } = await collectDeclarations(resolved.files);

  stdout("jit list\n");
  stdout(`files: ${resolved.files.length}\n`);
  for (const name of Object.keys(schemas)) stdout(`  type ${name}\n`);
  for (const name of Object.keys(groups)) {
    const members = Object.keys(groups[name]).map(
      (prop) => `${prop} (${artifactLabel(getArtifact(groups[name][prop]))})`
    );

    stdout(`  ${name}: ${members.join(", ")}\n`);
  }
  for (const name of Object.keys(artifacts)) {
    stdout(`  ${name}: ${artifactLabel(getArtifact(artifacts[name]))}\n`);
  }

  if (Object.keys(artifacts).length === 0 && Object.keys(groups).length === 0) {
    stderr("No AOT artifacts found in declaration files\n");
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

  const declarations = await collectDeclarations(resolved.files);
  const group = declarations.groups[parsed.target];
  const artifact = declarations.artifacts[parsed.target];

  if (group === undefined && artifact === undefined) {
    stderr(`AOT declaration "${parsed.target}" was not found\n`);
    return 1;
  }

  const descriptor =
    group !== undefined
      ? {
          name: parsed.target,
          kind: "group",
          source: declarations.sources.get(parsed.target),
          operations: Object.keys(group).map((prop) => `${prop}: ${artifactLabel(getArtifact(group[prop]))}`),
        }
      : {
          name: parsed.target,
          kind: getArtifact(artifact)?.kind ?? "unknown",
          source: declarations.sources.get(parsed.target),
          operations: readArtifactOps(artifact),
        };

  stdout(`jit inspect ${parsed.target}\n`);

  if (parsed.stage === "source") {
    const tempDir = mkdtempSync(join(tmpdir(), "jit-inspect-"));

    try {
      generate({ ...declarations, outDir: tempDir, format: resolved.format });
      stdout(readFileSync(join(tempDir, `index.${resolved.format}`), "utf8"));
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
  let patterns = parsed.patterns;
  let format = parsed.format;
  let perFile = parsed.perFile;
  let configFile: string | undefined;
  let configDir = cwd;

  if (files.length === 0) {
    configFile = findConfigFile(cwd);

    if (configFile) {
      const loaded = await loadModule(configFile);
      const config = (loaded.default ?? loaded) as JitConfig;

      configDir = dirname(configFile);
      patterns = patterns ?? config.patterns;
      files = expandSchemaEntries(config.entries, configDir, patterns);
      outDir = outDir ?? (config.output?.directory ? resolve(configDir, config.output.directory) : undefined);
      format = format ?? config.output?.format;
      perFile = perFile ?? config.output?.perFile;
    }

    if (files.length === 0) files = discoverSchemaFiles(cwd, patterns);
  }

  return {
    ...parsed,
    files,
    outDir,
    patterns,
    perFile,
    format: validateOutputFormat(format ?? "ts"),
    configFile,
    resolvedOut: outDir ?? resolve(configDir, DEFAULT_OUT_DIR),
  };
}

function readArtifactOps(value: unknown): readonly string[] {
  const artifact = getArtifact(value);

  if (!artifact) return [];
  return artifactOps(artifact);
}

function artifactOps(artifact: Exclude<ReturnType<typeof getArtifact>, undefined>): readonly string[] {
  if ("op" in artifact) return [artifact.op];
  if (artifact.kind === "execution") {
    return artifact.plan.stages.map((stage) =>
      stage.kind === "validate" || stage.kind === "operation" ? stage.operation : stage.kind
    );
  }
  return [artifact.kind];
}

function artifactLabel(artifact: ReturnType<typeof getArtifact>): string {
  if (!artifact) return "unknown";
  if ("op" in artifact) return `${artifact.kind}:${artifact.op}`;
  if (artifact.kind === "execution") return `execution:${artifactOps(artifact).join(">")}`;
  return artifact.kind;
}

function parseGenerateArguments(rest: readonly string[], cwd: string): GenerateArguments {
  const files: string[] = [];
  let outDir: string | undefined;
  let watchMode = false;
  let patterns: string[] | undefined;
  let format: AotOutputFormat | undefined;
  let perFile: boolean | undefined;

  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];

    if (argument === "--out") {
      outDir = resolve(cwd, readValue(rest, ++index, "--out"));
      continue;
    }

    if (argument === "--per-file") {
      perFile = true;
      continue;
    }

    if (argument === "--format") {
      format = parseOutputFormat(readValue(rest, ++index, "--format"));
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

    if (!argument.startsWith("--")) files.push(resolve(cwd, argument));
  }

  return { files, outDir, watch: watchMode, patterns, format, perFile };
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

  if (stage !== "plan" && stage !== "source") {
    throw new Error(`unknown inspect stage "${stage}"; expected "plan" or "source"`);
  }

  return { target, stage, generate: parseGenerateArguments(forwarded, cwd) };
}

function parseInitArguments(rest: readonly string[]): InitArguments {
  let force = false;
  let entries: string[] | undefined;
  let outDir = DEFAULT_OUT_DIR;
  let format: AotOutputFormat | undefined;
  let perFile = false;

  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];

    if (argument === "--force" || argument === "-f") {
      force = true;
      continue;
    }

    if (argument === "--per-file") {
      perFile = true;
      continue;
    }

    if (argument === "--yes" || argument === "-y") continue;

    if (argument === "--entries") {
      entries = [...(entries ?? []), readValue(rest, ++index, "--entries")];
      continue;
    }

    if (argument === "--out") {
      outDir = readValue(rest, ++index, "--out");
      continue;
    }

    if (argument === "--format") {
      format = parseOutputFormat(readValue(rest, ++index, "--format"));
    }
  }

  return { force, entries, outDir, format, perFile };
}

export function createConfigSource(options: InitArguments & { readonly format: AotOutputFormat }): string {
  const extension = options.format === "ts" ? "ts" : "js";
  const lines = [
    "  /** Files, directories, or globs holding your JIT declarations. */",
    `  entries: ${formatStringArray(options.entries ?? [`./jit/**/*.jit.${extension}`])},`,
    "  output: {",
    "    /** Destination relative to this config file. */",
    `    directory: ${JSON.stringify(options.outDir)},`,
    '    /** "ts" emits typed source; "js" emits ready-to-run ESM. */',
    `    format: ${JSON.stringify(options.format)},`,
    ...(options.perFile
      ? ["    /** One module per declaration file instead of a single index. */", "    perFile: true,"]
      : []),
    "  },",
  ];

  if (options.format === "js") {
    return `/** @type {import("@jit-compiler/jit").AOT.JitConfig} */\nexport default {\n${lines.join("\n")}\n};\n`;
  }

  return `import { AOT } from "@jit-compiler/jit";\n\nexport default AOT.defineConfig({\n${lines.join("\n")}\n});\n`;
}

function writeExampleDeclaration(cwd: string, format: AotOutputFormat): void {
  const dir = join(cwd, "jit");
  const file = join(dir, `user.jit.${format === "ts" ? "ts" : "js"}`);

  if (existsSync(file)) return;

  mkdirSync(dir, { recursive: true });
  writeFileSync(
    file,
    [
      'import { JIT } from "@jit-compiler/jit/define";',
      "",
      "const User = JIT.object({",
      "  id: JIT.int(),",
      "  name: JIT.string().trim().min(1),",
      "});",
      "",
      ...(format === "ts" ? ["export type User = JIT.Typeof<typeof User>;", ""] : []),
      "export const isUser = JIT.validate.is(User);",
      "export const parseUser = JIT.validate.parse(User);",
      "export const stringifyUser = JIT.json.stringify(User);",
      "",
    ].join("\n")
  );
}

function readValue(values: readonly string[], index: number, flag: string): string {
  const value = values[index];

  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} expects a value`);
  return value;
}

function parseOutputFormat(value: string): AotOutputFormat {
  if (value === "js" || value === "javascript") return "js";
  if (value === "ts" || value === "typescript") return "ts";
  throw new Error(`unknown output format "${value}"; expected "ts" or "js"`);
}

function validateOutputFormat(value: unknown): AotOutputFormat {
  if (value === "ts" || value === "js") return value;
  throw new Error(`unknown output format ${JSON.stringify(value)}; expected "ts" or "js"`);
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
