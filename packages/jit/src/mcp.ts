#!/usr/bin/env node
/**
 * jit MCP server.
 *
 * A small stdio JSON-RPC server for agents working inside a jit project.
 * The transport is newline-delimited JSON as required by the MCP stdio spec.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  collectSchemas,
  discoverSchemaFiles,
  expandSchemaEntries,
  findConfigFile,
  type JitConfig,
  loadModule,
} from "./aot/discover.js";
import { generate } from "./aot/generate.js";

const SERVER_NAME = "jit-mcp";
const SERVER_VERSION = "0.1.0";
const DEFAULT_PACKAGE_NAME = "@jit/generated";
const DEFAULT_OUT_DIR = "node_modules/@jit/generated";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: JsonValue;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: JsonValue;
  };
}

interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonValue;
}

interface Runtime {
  readonly cwd: string;
  readonly write: (message: JsonRpcResponse) => void;
  readonly log: (message: string) => void;
}

const TOOLS: readonly ToolDefinition[] = [
  {
    name: "jit_project_context",
    description: "Summarize the local jit project: package metadata, branch, useful commands, and tracked docs.",
    inputSchema: objectSchema({
      root: optionalString("Project root. Defaults to the MCP server working directory."),
      includeDocs: optionalBoolean("Include short architecture/status document snippets. Defaults to true."),
    }),
  },
  {
    name: "jit_aot_inspect",
    description: "Discover jit AOT declaration files and report buildable grouped objects and standalone functions.",
    inputSchema: objectSchema({
      root: optionalString("Project root. Defaults to the MCP server working directory."),
      files: optionalStringArray("Explicit declaration files, relative to root."),
      patterns: optionalStringArray("Glob patterns for discovery. Defaults to jit config or **/*.jit.ts."),
    }),
  },
  {
    name: "jit_aot_generate",
    description: "Run jit AOT generation from explicit declaration exports, respecting config discovery when present.",
    inputSchema: objectSchema({
      root: optionalString("Project root. Defaults to the MCP server working directory."),
      files: optionalStringArray("Explicit declaration files, relative to root."),
      outDir: optionalString("Generated output directory. Defaults to config or node_modules/@jit/generated."),
      packageName: optionalString("Generated package name. Defaults to config or @jit/generated."),
      patterns: optionalStringArray("Glob patterns for discovery. Defaults to jit config or **/*.jit.ts."),
      clean: optionalBoolean("Delete known generated files before writing. Defaults to config or true."),
      emitPackageJson: optionalBoolean("Write package.json exports map. Defaults to config or true."),
    }),
  },
];

export async function handleJsonRpc(request: JsonRpcRequest, runtime: Runtime): Promise<void> {
  if (request.id === undefined) return;

  try {
    if (request.method === "initialize") {
      runtime.write(response(request.id, initializeResult(request.params)));
      return;
    }

    if (request.method === "ping") {
      runtime.write(response(request.id, {}));
      return;
    }

    if (request.method === "tools/list") {
      runtime.write(response(request.id, { tools: TOOLS as unknown as JsonValue }));
      return;
    }

    if (request.method === "tools/call") {
      runtime.write(response(request.id, await callTool(request.params, runtime.cwd)));
      return;
    }

    runtime.write(errorResponse(request.id, -32601, `unknown method "${request.method}"`));
  } catch (error) {
    runtime.write(errorResponse(request.id, -32603, error instanceof Error ? error.message : String(error)));
  }
}

export async function callTool(params: unknown, cwd: string): Promise<JsonValue> {
  const record = requireRecord(params, "tools/call params");
  const name = readRequiredString(record, "name");
  const args = readRecord(record.arguments, "arguments") ?? {};

  if (name === "jit_project_context") return toolResult(projectContext(args, cwd));
  if (name === "jit_aot_inspect") return toolResult(await inspectAot(args, cwd));
  if (name === "jit_aot_generate") return toolResult(await generateAot(args, cwd));

  return toolResult(`Unknown jit tool "${name}".`, true);
}

function initializeResult(params: unknown): JsonValue {
  const requestedVersion = readRecord(params, "initialize params")?.protocolVersion;
  const protocolVersion = typeof requestedVersion === "string" ? requestedVersion : "2025-11-25";

  return {
    protocolVersion,
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
  };
}

function projectContext(args: Readonly<Record<string, unknown>>, cwd: string): string {
  const root = resolveRoot(args, cwd);
  const includeDocs = readOptionalBoolean(args, "includeDocs") ?? true;
  const packageJson = readJsonFile(resolve(root, "package.json"));
  const branch = gitValue(root, ["branch", "--show-current"]) ?? "unknown";
  const head = gitValue(root, ["rev-parse", "--short", "HEAD"]) ?? "unknown";
  const scripts = readRecord(packageJson?.scripts, "package.json scripts") ?? {};
  const lines = [
    `jit project: ${typeof packageJson?.name === "string" ? packageJson.name : "workspace"}`,
    `root: ${root}`,
    `git: ${branch}@${head}`,
    "",
    "useful commands:",
    ...["format:check", "lint:check", "test", "build", "jit", "bench:validate", "bench:report"]
      .filter((script) => typeof scripts[script] === "string")
      .map((script) => `- pnpm ${script}`),
  ];

  if (includeDocs) {
    lines.push("", "docs:");
    for (const file of [
      "docs/architecture.md",
      "docs/internal/STATUS.md",
      "docs/internal/SCHEMA_FINALIZATION_PLAN.md",
    ]) {
      const path = resolve(root, file);

      if (existsSync(path)) lines.push(`- ${file}: ${excerpt(readFileSync(path, "utf8"))}`);
    }
  }

  return lines.join("\n");
}

async function inspectAot(args: Readonly<Record<string, unknown>>, cwd: string): Promise<string> {
  const resolved = await resolveAotInputs(args, cwd);
  const collected = await collectSchemas(resolved.files);

  return [
    `root: ${resolved.root}`,
    resolved.configFile ? `config: ${resolved.configFile}` : "config: none",
    `declaration files: ${resolved.files.length}`,
    ...resolved.files.map((file) => `- ${file}`),
    `grouped exports: ${Object.keys(collected.schemas).join(", ") || "none"}`,
    `standalone functions: ${Object.keys(collected.functions).join(", ") || "none"}`,
  ].join("\n");
}

async function generateAot(args: Readonly<Record<string, unknown>>, cwd: string): Promise<string> {
  const resolved = await resolveAotInputs(args, cwd);
  const collected = await collectSchemas(resolved.files);
  const clean = readOptionalBoolean(args, "clean") ?? resolved.config.clean;
  const emitPackageJson = readOptionalBoolean(args, "emitPackageJson") ?? resolved.config.emitPackageJson;

  if (Object.keys(collected.schemas).length === 0 && Object.keys(collected.functions).length === 0) {
    return [
      "No AOT functions found.",
      "Export standalone compiled functions or JIT.compile(schema, { ... }) objects from declaration files.",
      `files: ${resolved.files.join(", ") || "none"}`,
    ].join("\n");
  }

  const result = generate({
    schemas: collected.schemas,
    functions: collected.functions,
    sources: collected.sources,
    outDir: resolve(resolved.root, readOptionalString(args, "outDir") ?? resolved.config.outDir ?? DEFAULT_OUT_DIR),
    packageName: readOptionalString(args, "packageName") ?? resolved.config.packageName ?? DEFAULT_PACKAGE_NAME,
    ...(clean !== undefined ? { clean } : {}),
    ...(emitPackageJson !== undefined ? { emitPackageJson } : {}),
  });

  return [
    result.files.length > 0
      ? `generated files:\n${result.files.map((file) => `- ${file}`).join("\n")}`
      : "generated files: none",
    result.skipped.length > 0
      ? `skipped:\n${result.skipped.map((skip) => `- ${skip.schema}.${skip.operation}: ${skip.reason}`).join("\n")}`
      : "skipped: none",
  ].join("\n\n");
}

async function resolveAotInputs(
  args: Readonly<Record<string, unknown>>,
  cwd: string
): Promise<{
  readonly root: string;
  readonly configFile?: string;
  readonly config: JitConfig;
  readonly files: readonly string[];
}> {
  const root = resolveRoot(args, cwd);
  const explicitFiles = readOptionalStringArray(args, "files");
  const explicitPatterns = readOptionalStringArray(args, "patterns");
  let config: JitConfig = {};
  let configFile: string | undefined;
  let files = explicitFiles?.map((file) => resolve(root, file)) ?? [];
  let patterns = explicitPatterns;

  if (files.length === 0) {
    configFile = findConfigFile(root);

    if (configFile) {
      const loaded = await loadModule(configFile);

      config = (loaded.default ?? loaded) as JitConfig;
      patterns = patterns ?? config.patterns;
      files = expandSchemaEntries(config.schemas, dirname(configFile), patterns);
    }

    if (files.length === 0) files = discoverSchemaFiles(root, patterns);
  }

  return { root, ...(configFile ? { configFile } : {}), config, files };
}

function response(id: string | number | null, result: JsonValue): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolResult(text: string, isError = false): JsonValue {
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

function resolveRoot(args: Readonly<Record<string, unknown>>, cwd: string): string {
  return resolve(cwd, readOptionalString(args, "root") ?? ".");
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

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  const record = readRecord(value, label);

  if (!record) throw new Error(`${label} must be an object`);
  return record;
}

function readRecord(value: unknown, _label: string): Readonly<Record<string, unknown>> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return undefined;
}

function readRequiredString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];

  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function readOptionalString(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];

  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

function readOptionalBoolean(record: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  const value = record[key];

  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
  return value;
}

function readOptionalStringArray(
  record: Readonly<Record<string, unknown>>,
  key: string
): readonly string[] | undefined {
  const value = record[key];

  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${key} must be an array of strings`);
  }
  return value;
}

function objectSchema(properties: Readonly<Record<string, JsonValue>>): JsonValue {
  return {
    type: "object",
    additionalProperties: false,
    properties,
  };
}

function optionalString(description: string): JsonValue {
  return { type: "string", description };
}

function optionalBoolean(description: string): JsonValue {
  return { type: "boolean", description };
}

function optionalStringArray(description: string): JsonValue {
  return { type: "array", description, items: { type: "string" } };
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  const record = readRecord(value, "JSON-RPC message");

  return record?.jsonrpc === "2.0" && typeof record.method === "string";
}

function isDirectRun(): boolean {
  const entry = process.argv[1];

  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;
}

export function runStdioServer(cwd = process.cwd()): void {
  const runtime: Runtime = {
    cwd,
    write: (message) => process.stdout.write(`${JSON.stringify(message)}\n`),
    log: (message) => process.stderr.write(`${message}\n`),
  };
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });

  reader.on("line", (line) => {
    if (line.trim().length === 0) return;

    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch (error) {
      runtime.log(`invalid JSON-RPC message: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    if (!isJsonRpcRequest(parsed)) {
      runtime.log("ignored non-request JSON-RPC message");
      return;
    }

    handleJsonRpc(parsed, runtime).catch((error: unknown) => {
      runtime.log(error instanceof Error ? error.message : String(error));
    });
  });
}

if (isDirectRun()) runStdioServer();
