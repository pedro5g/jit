import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  collectSchemas,
  DEFAULT_SCHEMA_PATTERNS,
  discoverSchemaFiles,
  expandSchemaEntries,
  findConfigFile,
  type JitConfig,
  loadModule,
} from "./aot/discover.js";
import { type GenerateEmitOptions, generate } from "./aot/generate.js";
import { getArtifact } from "./runtime/artifact-registry.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface McpPayload {
  readonly text: string;
  readonly data: JsonValue;
}

interface ResolvedAotProject {
  readonly root: string;
  readonly configFile?: string;
  readonly config: JitConfig;
  readonly files: readonly string[];
  readonly outDir: string;
  readonly packageName: string;
  readonly patterns: readonly string[];
  readonly clean: boolean;
  readonly typesPackage: string;
  readonly emit?: GenerateEmitOptions;
}

interface LegacyJitConfig {
  readonly schemas?: readonly string[];
  readonly outDir?: string;
  readonly packageName?: string;
  readonly clean?: boolean;
  readonly compiler?: { readonly packageName?: string };
}

const DEFAULT_PACKAGE_NAME = "@jit/generated";
const DEFAULT_OUT_DIR = "generated/jit";
const MAX_RESOURCE_BYTES = 512 * 1024;
const DOC_FILES = ["README.md", "packages/jit/README.md"] as const;
const GENERATED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".cts", ".json"]);

export function projectContext(args: Readonly<Record<string, unknown>>, workspace: string): McpPayload {
  const root = resolveProjectRoot(args, workspace);
  const includeDocs = readOptionalBoolean(args, "includeDocs") ?? true;
  const packageJson = readJsonFile(resolve(root, "package.json"));
  const branch = gitValue(root, ["branch", "--show-current"]) ?? "unknown";
  const head = gitValue(root, ["rev-parse", "--short", "HEAD"]) ?? "unknown";
  const scripts = readRecord(packageJson?.scripts) ?? {};
  const commands = ["format:check", "lint:check", "test", "build", "jit", "bench:validate", "bench:report"]
    .filter((script) => typeof scripts[script] === "string")
    .map((script) => `pnpm ${script}`);
  const docs = includeDocs
    ? ["docs/architecture.md", "docs/internal/STATUS.md", "docs/internal/SCHEMA_FINALIZATION_PLAN.md"]
        .filter((file) => existsSync(resolve(root, file)))
        .map((file) => ({
          file,
          excerpt: excerpt(readFileSync(resolveInside(root, file, "documentation file"), "utf8")),
        }))
    : [];
  const name = typeof packageJson?.name === "string" ? packageJson.name : "workspace";
  const data = { name, root, git: { branch, head }, commands, docs } as JsonValue;
  const text = [
    `jit project: ${name}`,
    `root: ${root}`,
    `git: ${branch}@${head}`,
    "",
    "useful commands:",
    ...commands.map((command) => `- ${command}`),
    ...(docs.length > 0 ? ["", "docs:", ...docs.map(({ file, excerpt: summary }) => `- ${file}: ${summary}`)] : []),
  ].join("\n");

  return { text, data };
}

export async function inspectAot(args: Readonly<Record<string, unknown>>, workspace: string): Promise<McpPayload> {
  const resolved = await resolveAotProject(args, workspace);
  const collected = await collectSchemas(resolved.files);
  const grouped = Object.keys(collected.schemas).map((name) => ({
    name,
    operations: readOps(collected.schemas[name]),
    source: relativePath(resolved.root, collected.sources.get(name)),
  }));
  const standalone = Object.keys(collected.functions).map((name) => {
    const artifact = getArtifact(collected.functions[name]);

    return {
      name,
      kind: artifact?.kind ?? "unknown",
      operations: artifact && "op" in artifact ? [artifact.op] : artifact ? [artifact.kind] : [],
      source: relativePath(resolved.root, collected.sources.get(name)),
    };
  });
  const files = resolved.files.map((file) => relativePath(resolved.root, file));
  const data = {
    root: resolved.root,
    configFile: relativePath(resolved.root, resolved.configFile),
    files,
    output: outputDescriptor(resolved),
    grouped,
    standalone,
  } as JsonValue;
  const text = [
    `root: ${resolved.root}`,
    `config: ${relativePath(resolved.root, resolved.configFile) ?? "none"}`,
    `declaration files: ${files.length}`,
    ...files.map((file) => `- ${file}`),
    `grouped exports: ${grouped.map(({ name }) => name).join(", ") || "none"}`,
    `standalone functions: ${standalone.map(({ name }) => name).join(", ") || "none"}`,
  ].join("\n");

  return { text, data };
}

export async function previewAot(args: Readonly<Record<string, unknown>>, workspace: string): Promise<McpPayload> {
  const resolved = await resolveAotProject(args, workspace);
  const collected = await collectSchemas(resolved.files);
  assertBuildable(collected.schemas, collected.functions, resolved.files);
  const stage = readEnum(args, "stage", ["summary", "source", "declaration", "manifest", "plan"] as const) ?? "summary";
  const target = readOptionalString(args, "target");
  const tempDir = mkdtempSync(join(tmpdir(), "jit-mcp-preview-"));

  try {
    const result = generate({
      schemas: collected.schemas,
      functions: collected.functions,
      sources: collected.sources,
      outDir: tempDir,
      packageName: resolved.packageName,
      types: { package: resolved.typesPackage },
      clean: true,
      emit: {
        ...resolved.emit,
        ...(stage === "manifest" ? { manifest: true } : {}),
        ...(stage === "plan" ? { plans: true } : {}),
      },
    });
    const selected = selectPreviewFile(tempDir, stage, target);
    const content = selected ? readLimitedFile(selected) : undefined;
    const files = result.files.map((file) => relativePath(tempDir, file));
    const data = {
      stage,
      ...(target ? { target } : {}),
      files,
      skipped: jsonSkipped(result.skipped),
      ...(selected ? { selectedFile: relativePath(tempDir, selected), content: content ?? "" } : {}),
    } as JsonValue;
    const text = [
      `AOT preview: ${result.files.length} file(s), ${result.skipped.length} skipped operation(s)`,
      ...files.map((file) => `- ${file}`),
      ...(selected && content ? ["", `--- ${relativePath(tempDir, selected)} ---`, content] : []),
    ].join("\n");

    return { text, data };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function generateAot(args: Readonly<Record<string, unknown>>, workspace: string): Promise<McpPayload> {
  if (readOptionalBoolean(args, "write") !== true) {
    throw new Error('jit_aot_generate requires "write": true; use jit_aot_preview for a read-only build');
  }

  const resolved = await resolveAotProject(args, workspace);
  const collected = await collectSchemas(resolved.files);
  assertBuildable(collected.schemas, collected.functions, resolved.files);
  const result = generate({
    schemas: collected.schemas,
    functions: collected.functions,
    sources: collected.sources,
    outDir: resolved.outDir,
    packageName: resolved.packageName,
    types: { package: resolved.typesPackage },
    clean: resolved.clean,
    ...(resolved.emit ? { emit: resolved.emit } : {}),
  });
  const files = result.files.map((file) => relativePath(resolved.root, file));
  const data = {
    outDir: relativePath(resolved.root, resolved.outDir),
    packageName: resolved.packageName,
    typesPackage: resolved.typesPackage,
    files,
    skipped: jsonSkipped(result.skipped),
  } as JsonValue;
  const text = [
    files.length > 0 ? `generated files:\n${files.map((file) => `- ${file}`).join("\n")}` : "generated files: none",
    result.skipped.length > 0
      ? `skipped:\n${result.skipped.map((skip) => `- ${skip.schema}.${skip.operation}: ${skip.reason}`).join("\n")}`
      : "skipped: none",
  ].join("\n\n");

  return { text, data };
}

export async function doctorProject(args: Readonly<Record<string, unknown>>, workspace: string): Promise<McpPayload> {
  const resolved = await resolveAotProject(args, workspace);
  const errors: string[] = [];
  const warnings: string[] = [];
  let grouped = 0;
  let standalone = 0;

  if (!resolved.configFile) warnings.push("No jit.config.* found; discovery is using patterns from the project root.");
  if (resolved.files.length === 0) errors.push("No AOT declaration files were found.");

  if (resolved.files.length > 0) {
    try {
      const collected = await collectSchemas(resolved.files);
      grouped = Object.keys(collected.schemas).length;
      standalone = Object.keys(collected.functions).length;
      if (grouped + standalone === 0) {
        errors.push("Declaration files export no compiled functions or grouped JIT.compile objects.");
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (nodeMajor < 20)
    errors.push(`Node ${process.versions.node} is unsupported; @jit-compiler/jit requires Node >=20.`);

  const data = {
    ok: errors.length === 0,
    node: process.versions.node,
    configFile: relativePath(resolved.root, resolved.configFile),
    files: resolved.files.map((file) => relativePath(resolved.root, file)),
    grouped,
    standalone,
    output: outputDescriptor(resolved),
    errors,
    warnings,
  } as JsonValue;
  const text = [
    `jit doctor: ${errors.length === 0 ? "ok" : "failed"}`,
    `node: ${process.versions.node}`,
    `config: ${relativePath(resolved.root, resolved.configFile) ?? "not found"}`,
    `declaration files: ${resolved.files.length}`,
    `AOT exports: ${grouped} grouped, ${standalone} standalone`,
    `output: ${relativePath(resolved.root, resolved.outDir)}`,
    ...errors.map((message) => `error: ${message}`),
    ...warnings.map((message) => `warning: ${message}`),
  ].join("\n");

  return { text, data };
}

export function searchDocs(args: Readonly<Record<string, unknown>>, workspace: string): McpPayload {
  const root = resolveProjectRoot(args, workspace);
  const query = readRequiredString(args, "query").toLowerCase();
  const limit = Math.min(Math.max(readOptionalInteger(args, "limit") ?? 10, 1), 50);
  const files = [
    ...DOC_FILES.filter((file) => existsSync(resolve(root, file))).map((file) =>
      resolveInside(root, file, "documentation file", root, true)
    ),
    ...listMarkdownFiles(resolve(root, "docs")),
  ];
  const matches: { file: string; line: number; text: string }[] = [];

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);

    for (let index = 0; index < lines.length && matches.length < limit; index++) {
      const line = lines[index] ?? "";
      if (line.toLowerCase().includes(query)) {
        matches.push({ file: relativePath(root, file) ?? file, line: index + 1, text: line.trim() });
      }
    }
    if (matches.length >= limit) break;
  }

  const data = { query, matches } as JsonValue;
  const text = matches.length
    ? matches.map((match) => `${match.file}:${match.line}: ${match.text}`).join("\n")
    : `No documentation matches for "${query}".`;

  return { text, data };
}

export async function listResources(workspace: string): Promise<readonly JsonValue[]> {
  const root = canonicalWorkspace(workspace);
  const resources: JsonValue[] = [
    resource(
      "jit://project/context",
      "project-context",
      "JIT project metadata, commands, branch, and docs",
      "text/plain"
    ),
    resource(
      "jit://aot/inventory",
      "aot-inventory",
      "Discovered declarations and explicit AOT exports",
      "application/json"
    ),
  ];
  const fixed = [
    ["README.md", "jit://project/readme", "project-readme"],
    ["packages/jit/README.md", "jit://project/package-guide", "package-guide"],
    ["docs/architecture.md", "jit://project/architecture", "architecture"],
    ["docs/internal/STATUS.md", "jit://project/status", "project-status"],
  ] as const;

  for (const [file, uri, name] of fixed) {
    const path = resolve(root, file);
    if (existsSync(path)) resources.push(fileResource(root, path, uri, name));
  }

  const configFile = findConfigFile(root);
  if (configFile) {
    resources.push(
      fileResource(root, resolveInside(root, configFile, "JIT config", root, true), "jit://aot/config", "aot-config")
    );
  }
  return resources;
}

export function resourceTemplates(): readonly JsonValue[] {
  return [
    {
      uriTemplate: "jit://docs/{path}",
      name: "jit-doc",
      title: "JIT documentation file",
      description: "A Markdown file below the project docs directory",
      mimeType: "text/markdown",
    },
    {
      uriTemplate: "jit://generated/{path}",
      name: "jit-generated-artifact",
      title: "Generated JIT artifact",
      description: "A source, declaration, manifest, or plan from the configured AOT output",
      mimeType: "text/plain",
    },
  ];
}

export async function readResource(uri: string, workspace: string): Promise<JsonValue> {
  const root = canonicalWorkspace(workspace);

  if (uri === "jit://project/context") return textResource(uri, projectContext({}, root).text, "text/plain");
  if (uri === "jit://aot/inventory") {
    return textResource(uri, JSON.stringify((await inspectAot({}, root)).data, null, 2), "application/json");
  }

  const fixed = new Map([
    ["jit://project/readme", "README.md"],
    ["jit://project/package-guide", "packages/jit/README.md"],
    ["jit://project/architecture", "docs/architecture.md"],
    ["jit://project/status", "docs/internal/STATUS.md"],
  ]);
  const fixedPath = fixed.get(uri);
  if (fixedPath) return fileContents(uri, resolveInside(root, fixedPath, "resource"), "text/markdown");
  if (uri === "jit://aot/config") {
    const configFile = findConfigFile(root);
    if (!configFile) throw new Error("No jit.config.* exists in this workspace.");
    return fileContents(uri, resolveInside(root, configFile, "JIT config", root, true), "text/plain");
  }

  const parsed = parseJitUri(uri);
  if (parsed.host === "docs") {
    const file = resolveInside(resolve(root, "docs"), parsed.path, "documentation resource");
    if (!file.endsWith(".md")) throw new Error("Documentation resources must be Markdown files.");
    return fileContents(uri, file, "text/markdown");
  }
  if (parsed.host === "generated") {
    const resolved = await resolveAotProject({}, root);
    const file = resolveInside(resolved.outDir, parsed.path, "generated resource");
    const extension = file.slice(file.lastIndexOf("."));
    if (!GENERATED_EXTENSIONS.has(extension))
      throw new Error(`Unsupported generated resource extension "${extension}".`);
    return fileContents(uri, file, extension === ".json" ? "application/json" : "text/plain");
  }

  throw new Error(`Unknown JIT resource "${uri}".`);
}

export function completeValue(name: string, value: string, workspace: string): readonly string[] {
  const candidates =
    name === "mode"
      ? ["runtime", "aot", "hybrid"]
      : name === "operation"
        ? ["validate", "equal", "clone", "diff", "hash", "query", "mapper", "json", "codec", "binary"]
        : name === "path"
          ? listMarkdownFiles(resolve(canonicalWorkspace(workspace), "docs")).map(
              (file) => relativePath(resolve(canonicalWorkspace(workspace), "docs"), file) ?? file
            )
          : [];

  return candidates.filter((candidate) => candidate.toLowerCase().startsWith(value.toLowerCase())).slice(0, 50);
}

function outputDescriptor(resolved: ResolvedAotProject): JsonValue {
  return {
    directory: relativePath(resolved.root, resolved.outDir) ?? resolved.outDir,
    packageName: resolved.packageName,
    typesPackage: resolved.typesPackage,
    layout: resolved.outDir.split(sep).includes("node_modules") ? "package" : "local",
    clean: resolved.clean,
    emit: (resolved.emit ?? {}) as JsonValue,
  };
}

function jsonSkipped(
  skipped: readonly { readonly schema: string; readonly operation: string; readonly reason: string }[]
): JsonValue {
  return skipped.map(({ schema, operation, reason }) => ({ schema, operation, reason }));
}

async function resolveAotProject(
  args: Readonly<Record<string, unknown>>,
  workspace: string
): Promise<ResolvedAotProject> {
  const root = resolveProjectRoot(args, workspace);
  const explicitFiles = readOptionalStringArray(args, "files");
  const explicitPatterns = readOptionalStringArray(args, "patterns");
  const emitOverride = readEmit(args.emit);
  let config: JitConfig & LegacyJitConfig = {};
  let configFile: string | undefined;
  let files = explicitFiles?.map((file) => resolveInside(root, file, "declaration file")) ?? [];
  let patterns = explicitPatterns;
  let configDir = root;

  if (files.length === 0) {
    const discoveredConfig = findConfigFile(root);
    configFile = discoveredConfig ? resolveInside(root, discoveredConfig, "JIT config", root, true) : undefined;
    if (configFile) {
      const loaded = await loadModule(configFile);
      config = (loaded.default ?? loaded) as JitConfig & LegacyJitConfig;
      configDir = dirname(configFile);
      patterns = patterns ?? config.patterns;
      files = expandSchemaEntries(config.entries ?? config.schemas, configDir, patterns);
    }
    if (files.length === 0) files = discoverSchemaFiles(root, patterns);
  }

  files = files.map((file) => resolveInside(root, file, "declaration file", root, true));
  const output = config.output;
  const outArg = readOptionalString(args, "outDir");
  const configuredOut = output?.directory ?? config.outDir ?? DEFAULT_OUT_DIR;
  const outDir = outArg
    ? resolveInside(root, outArg, "AOT output directory")
    : resolveInside(configDir, configuredOut, "AOT output directory", root);
  const packageName =
    readOptionalString(args, "packageName") ?? output?.packageName ?? config.packageName ?? DEFAULT_PACKAGE_NAME;
  const typesPackage =
    readOptionalString(args, "typesPackage") ??
    config.types?.package ??
    config.compiler?.packageName ??
    "@jit-compiler/jit";
  const clean = readOptionalBoolean(args, "clean") ?? output?.clean ?? config.clean ?? true;
  const emit = config.emit || emitOverride ? { ...config.emit, ...emitOverride } : undefined;

  return {
    root,
    ...(configFile ? { configFile } : {}),
    config,
    files,
    outDir,
    packageName,
    typesPackage,
    patterns: patterns ?? DEFAULT_SCHEMA_PATTERNS,
    clean,
    ...(emit ? { emit } : {}),
  };
}

function resolveProjectRoot(args: Readonly<Record<string, unknown>>, workspace: string): string {
  const canonical = canonicalWorkspace(workspace);
  const requested = readOptionalString(args, "root") ?? ".";
  return resolveInside(canonical, requested, "project root", canonical, true);
}

function canonicalWorkspace(workspace: string): string {
  return realpathSync(resolve(workspace));
}

function resolveInside(base: string, path: string, label: string, boundary = base, mustExist = false): string {
  const target = resolve(base, path);
  assertInside(boundary, target, label);
  if (mustExist && !existsSync(target)) throw new Error(`${label} does not exist: ${target}`);
  const canonical = canonicalizeAvailablePath(target);
  assertInside(boundary, canonical, label);
  return canonical;
}

function canonicalizeAvailablePath(path: string): string {
  let cursor = path;
  const missing: string[] = [];

  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return path;
    missing.unshift(basename(cursor));
    cursor = parent;
  }

  return resolve(realpathSync(cursor), ...missing);
}

function assertInside(boundary: string, target: string, label: string): void {
  const rel = relative(resolve(boundary), resolve(target));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${label} must stay inside the MCP workspace`);
  }
}

function assertBuildable(
  schemas: Readonly<Record<string, unknown>>,
  functions: Readonly<Record<string, unknown>>,
  files: readonly string[]
): void {
  if (Object.keys(schemas).length + Object.keys(functions).length === 0) {
    throw new Error(
      `No AOT functions found in ${files.join(", ") || "the selected files"}. Export standalone compiled functions or JIT.compile(schema, { ... }) objects.`
    );
  }
}

function selectPreviewFile(tempDir: string, stage: string, target: string | undefined): string | undefined {
  if (stage === "summary") return undefined;
  if (stage === "source") return resolve(tempDir, "index.js");
  if (stage === "declaration") return resolve(tempDir, "index.d.ts");
  if (stage === "manifest") return resolve(tempDir, "manifest.json");
  if (stage === "plan") {
    const plansDir = resolve(tempDir, "plans");
    const plans = existsSync(plansDir)
      ? readdirSync(plansDir)
          .filter((file) => file.endsWith(".json"))
          .sort()
      : [];
    const selected = target ? plans.find((file) => planContainsExport(resolve(plansDir, file), target)) : plans[0];
    if (!selected)
      throw new Error(target ? `No generated plan found for "${target}".` : "No generated AOT plans found.");
    return resolve(plansDir, selected);
  }
  return undefined;
}

function planContainsExport(path: string, target: string): boolean {
  try {
    const plan = JSON.parse(readFileSync(path, "utf8")) as {
      readonly artifacts?: readonly { readonly name?: unknown }[];
    };
    return plan.artifacts?.some((artifact) => artifact.name === target) === true;
  } catch {
    return false;
  }
}

function readLimitedFile(path: string): string {
  const stat = statSync(path);
  if (stat.size > MAX_RESOURCE_BYTES) throw new Error(`Resource is larger than ${MAX_RESOURCE_BYTES} bytes: ${path}`);
  return readFileSync(path, "utf8");
}

function listMarkdownFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".md")) found.push(path);
    }
  };
  walk(root);
  return found.sort();
}

function fileResource(root: string, path: string, uri: string, name: string): JsonValue {
  const stat = statSync(path);
  return {
    uri,
    name,
    title: relativePath(root, path) ?? name,
    mimeType: path.endsWith(".md") ? "text/markdown" : "text/plain",
    size: stat.size,
    annotations: { audience: ["user", "assistant"], priority: 0.8, lastModified: stat.mtime.toISOString() },
  };
}

function resource(uri: string, name: string, description: string, mimeType: string): JsonValue {
  return { uri, name, description, mimeType, annotations: { audience: ["assistant"], priority: 0.9 } };
}

function fileContents(uri: string, path: string, mimeType: string): JsonValue {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Resource does not exist: ${path}`);
  return textResource(uri, readLimitedFile(path), mimeType);
}

function textResource(uri: string, text: string, mimeType: string): JsonValue {
  return { contents: [{ uri, mimeType, text }] };
}

function parseJitUri(uri: string): { readonly host: string; readonly path: string } {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`Invalid resource URI "${uri}".`);
  }
  if (parsed.protocol !== "jit:") throw new Error(`Unsupported resource protocol "${parsed.protocol}".`);
  return { host: parsed.hostname, path: decodeURIComponent(parsed.pathname.replace(/^\//, "")) };
}

function readOps(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object") return [];
  const ops = (value as { readonly ops?: unknown }).ops;
  return Array.isArray(ops) ? ops.filter((op): op is string => typeof op === "string") : [];
}

function readEmit(value: unknown): GenerateEmitOptions | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const keys = ["subpathModules", "manifest", "plans"] as const;
  const emit: Record<string, boolean> = {};
  for (const key of keys) {
    const item = record[key];
    if (item !== undefined && typeof item !== "boolean") throw new Error(`emit.${key} must be a boolean`);
    if (typeof item === "boolean") emit[key] = item;
  }
  return emit;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function readRequiredString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function readOptionalString(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function readOptionalBoolean(record: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
  return value;
}

function readOptionalInteger(record: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) throw new Error(`${key} must be an integer`);
  return value as number;
}

function readOptionalStringArray(
  record: Readonly<Record<string, unknown>>,
  key: string
): readonly string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error(`${key} must be an array of non-empty strings`);
  }
  return value;
}

function readEnum<const TValues extends readonly string[]>(
  record: Readonly<Record<string, unknown>>,
  key: string,
  values: TValues
): TValues[number] | undefined {
  const value = readOptionalString(record, key);
  if (value === undefined) return undefined;
  if (!values.includes(value)) throw new Error(`${key} must be one of: ${values.join(", ")}`);
  return value as TValues[number];
}

function readJsonFile(path: string): Readonly<Record<string, unknown>> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Readonly<Record<string, unknown>>;
  } catch {
    return undefined;
  }
}

function gitValue(cwd: string, args: readonly string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

function excerpt(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .slice(0, 2)
    .join(" ");
}

function relativePath(root: string, path: string | undefined): string | null {
  if (!path) return null;
  const result = relative(root, path).split(sep).join("/");
  return result.length === 0 ? "." : result;
}
