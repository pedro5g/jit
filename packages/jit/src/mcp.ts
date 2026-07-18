#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  completeValue,
  doctorProject,
  generateAot,
  inspectAot,
  type JsonValue,
  listResources,
  previewAot,
  projectContext,
  readResource,
  resourceTemplates,
  searchDocs,
} from "./mcp-project.js";

/**
 * JIT MCP server.
 *
 * The server deliberately has no MCP SDK dependency: consumers that only use
 * the compiler do not pay for agent tooling. The protocol surface follows MCP
 * 2025-11-25 and uses newline-delimited JSON-RPC over stdio.
 */

const SERVER_NAME = "jit-mcp";
const SERVER_VERSION = "1.0.4";
const LATEST_PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([LATEST_PROTOCOL_VERSION]);

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
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonValue;
  readonly outputSchema: JsonValue;
  readonly annotations: JsonValue;
}

export interface McpRuntime {
  readonly cwd: string;
  readonly write: (message: JsonRpcResponse) => void;
  readonly log: (message: string) => void;
}

class JsonRpcError extends Error {
  readonly code: number;
  readonly data: JsonValue | undefined;

  constructor(code: number, message: string, data?: JsonValue) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

const RESULT_SCHEMA: JsonValue = {
  type: "object",
  additionalProperties: true,
};

const AOT_PROPERTIES = {
  root: optionalString("Project root below the MCP workspace. Defaults to the workspace root."),
  files: optionalStringArray("Explicit declaration files relative to the project root."),
  patterns: optionalStringArray("Discovery globs. Defaults to config or **/*.jit.ts."),
} as const;

const OUTPUT_PROPERTIES = {
  outDir: optionalString("Output directory relative to the project root."),
  packageName: optionalString("Package namespace used when output is below node_modules."),
  typesPackage: optionalString("Package specifier exporting JIT.Typeof and JIT.Strict."),
  outputFormat: {
    type: "string",
    enum: ["typescript", "javascript", "javascript-only"],
    description: "Generated source format. Defaults to config or typescript.",
  },
  clean: optionalBoolean("Remove known generated files before generation."),
  emit: {
    type: "object",
    additionalProperties: false,
    properties: {
      subpathModules: { type: "boolean" },
      manifest: { type: "boolean" },
      plans: { type: "boolean" },
    },
  },
} as const;

const TOOLS: readonly ToolDefinition[] = [
  tool(
    "jit_project_context",
    "Project context",
    "Summarize package metadata, Git state, useful pnpm commands, and key JIT documents.",
    objectSchema({
      root: AOT_PROPERTIES.root,
      includeDocs: optionalBoolean("Include short architecture and status excerpts. Defaults to true."),
    }),
    readOnlyAnnotations()
  ),
  tool(
    "jit_project_doctor",
    "AOT doctor",
    "Validate Node, config discovery, declaration loading, explicit compiled exports, and output settings.",
    objectSchema(AOT_PROPERTIES),
    readOnlyAnnotations()
  ),
  tool(
    "jit_docs_search",
    "Search JIT docs",
    "Search project and package Markdown documentation and return file/line matches.",
    objectSchema(
      {
        root: AOT_PROPERTIES.root,
        query: { type: "string", minLength: 1, description: "Case-insensitive text to find." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Maximum matches. Defaults to 10." },
      },
      ["query"]
    ),
    readOnlyAnnotations()
  ),
  tool(
    "jit_aot_inspect",
    "Inspect AOT declarations",
    "Discover declaration files and report grouped objects, standalone compiled functions, operations, and output config.",
    objectSchema(AOT_PROPERTIES),
    readOnlyAnnotations()
  ),
  tool(
    "jit_aot_preview",
    "Preview AOT output",
    "Compile into a temporary directory and inspect source, declarations, manifest, or plans without changing the project.",
    objectSchema({
      ...AOT_PROPERTIES,
      ...OUTPUT_PROPERTIES,
      stage: {
        type: "string",
        enum: ["summary", "source", "declaration", "manifest", "plan"],
        description: "Artifact to return. Defaults to summary.",
      },
      target: optionalString("Export name used to select a plan when stage is plan."),
    }),
    readOnlyAnnotations()
  ),
  tool(
    "jit_aot_generate",
    "Generate AOT package",
    "Write the explicit AOT exports selected by the project. Requires write=true; preview first for read-only inspection.",
    objectSchema(
      {
        ...AOT_PROPERTIES,
        ...OUTPUT_PROPERTIES,
        write: {
          type: "boolean",
          const: true,
          description: "Explicit confirmation that generated files may be written.",
        },
      },
      ["write"]
    ),
    {
      title: "Generate AOT package",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    }
  ),
];

const PROMPTS: readonly JsonValue[] = [
  {
    name: "jit_schema_design",
    title: "Design a JIT schema",
    description: "Design or review a typed schema and select only the operations the application needs.",
    arguments: [
      { name: "goal", description: "The data boundary or model to represent.", required: true },
      { name: "mode", description: "runtime, aot, or hybrid.", required: false },
    ],
  },
  {
    name: "jit_aot_workflow",
    title: "Prepare an AOT workflow",
    description: "Inspect declarations, preview generated output, and produce a tree-shakeable integration plan.",
    arguments: [{ name: "goal", description: "The build or migration goal.", required: false }],
  },
  {
    name: "jit_performance_review",
    title: "Review JIT performance",
    description: "Review an operation using JIT's compile-time, allocation, cache, and benchmark principles.",
    arguments: [
      { name: "operation", description: "Operation or pipeline to review.", required: true },
      { name: "dataShape", description: "Representative shape, cardinality, and reuse pattern.", required: false },
    ],
  },
];

export async function handleJsonRpc(request: JsonRpcRequest, runtime: McpRuntime): Promise<void> {
  if (request.id === undefined) {
    handleNotification(request, runtime);
    return;
  }

  try {
    const result = await dispatchRequest(request.method, request.params, runtime.cwd);
    runtime.write(response(request.id, result));
  } catch (error) {
    if (error instanceof JsonRpcError) {
      runtime.write(errorResponse(request.id, error.code, error.message, error.data));
      return;
    }
    runtime.write(errorResponse(request.id, -32603, error instanceof Error ? error.message : String(error)));
  }
}

export async function callTool(params: unknown, cwd: string): Promise<JsonValue> {
  const record = requireRecord(params, "tools/call params");
  const name = readRequiredString(record, "name");
  const args = readRecord(record.arguments) ?? {};

  try {
    if (name === "jit_project_context") return toolResult(projectContext(args, cwd));
    if (name === "jit_project_doctor") return toolResult(await doctorProject(args, cwd));
    if (name === "jit_docs_search") return toolResult(searchDocs(args, cwd));
    if (name === "jit_aot_inspect") return toolResult(await inspectAot(args, cwd));
    if (name === "jit_aot_preview") return toolResult(await previewAot(args, cwd));
    if (name === "jit_aot_generate") return toolResult(await generateAot(args, cwd));
    throw new JsonRpcError(-32602, `Unknown JIT tool "${name}".`);
  } catch (error) {
    if (error instanceof JsonRpcError) throw error;
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

export async function processJsonRpcLine(line: string, runtime: McpRuntime): Promise<void> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    runtime.write(errorResponse(null, -32700, "Parse error"));
    return;
  }

  if (isJsonRpcRequest(parsed)) {
    await handleJsonRpc(parsed, runtime);
    return;
  }

  if (isJsonRpcResponse(parsed)) return;
  const id = readRecord(parsed)?.id;
  runtime.write(errorResponse(isRequestId(id) ? id : null, -32600, "Invalid Request"));
}

async function dispatchRequest(method: string, params: unknown, cwd: string): Promise<JsonValue> {
  if (method === "initialize") return initializeResult(params);
  if (method === "ping") return {};
  if (method === "tools/list") return listResult("tools", TOOLS, params);
  if (method === "tools/call") return callTool(params, cwd);
  if (method === "resources/list") return listResult("resources", await listResources(cwd), params);
  if (method === "resources/templates/list") return listResult("resourceTemplates", resourceTemplates(), params);
  if (method === "resources/read") {
    const uri = readRequiredString(requireRecord(params, "resources/read params"), "uri");
    try {
      return await readResource(uri, cwd);
    } catch (error) {
      throw new JsonRpcError(-32002, error instanceof Error ? error.message : String(error));
    }
  }
  if (method === "prompts/list") return listResult("prompts", PROMPTS, params);
  if (method === "prompts/get") return getPrompt(params);
  if (method === "completion/complete") return complete(params, cwd);
  if (method === "logging/setLevel") {
    readRequiredString(requireRecord(params, "logging/setLevel params"), "level");
    return {};
  }
  throw new JsonRpcError(-32601, `Method not found: ${method}`);
}

function initializeResult(params: unknown): JsonValue {
  const record = requireRecord(params, "initialize params");
  const requested = readRequiredString(record, "protocolVersion");
  const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : LATEST_PROTOCOL_VERSION;

  return {
    protocolVersion,
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
      completions: {},
      logging: {},
    },
    serverInfo: {
      name: SERVER_NAME,
      title: "JIT compiler workspace server",
      version: SERVER_VERSION,
      description: "Project context, documentation, and safe JIT AOT workflows for coding agents",
      websiteUrl: "https://github.com/pedro5g/jit",
    },
    instructions:
      "Read jit://project/context and jit://project/architecture before architecture work. Preview AOT output before calling jit_aot_generate with write=true.",
  };
}

function getPrompt(params: unknown): JsonValue {
  const record = requireRecord(params, "prompts/get params");
  const name = readRequiredString(record, "name");
  const args = readRecord(record.arguments) ?? {};
  const prompt = PROMPTS.find((candidate) => readRecord(candidate)?.name === name);
  if (!prompt) throw new JsonRpcError(-32602, `Unknown JIT prompt "${name}".`);
  const text = promptText(name, args);

  return {
    description: readRecord(prompt)?.description as JsonValue,
    messages: [{ role: "user", content: { type: "text", text } }],
  };
}

function promptText(name: string, args: Readonly<Record<string, unknown>>): string {
  if (name === "jit_schema_design") {
    const goal = readRequiredString(args, "goal");
    const mode = readOptionalString(args, "mode") ?? "hybrid";
    return `Design a typed JIT schema for: ${goal}\nExecution mode: ${mode}\nUse project conventions, select only required compiled operations, and include runtime plus inference tests.`;
  }
  if (name === "jit_aot_workflow") {
    const goal = readOptionalString(args, "goal") ?? "prepare the project for import-free AOT output";
    return `Use the JIT project resources and read-only tools to ${goal}. Run doctor, inspect declarations, preview generated source/types, verify explicit exports and tree sharing, then describe any write step before generation.`;
  }
  const operation = readRequiredString(args, "operation");
  const dataShape = readOptionalString(args, "dataShape") ?? "not provided";
  return `Review JIT ${operation} performance. Representative data: ${dataShape}. Separate compile cost from execution cost, inspect generated source, allocations, cache lifetime, monomorphic shapes, and propose a reproducible benchmark before accepting complexity.`;
}

function complete(params: unknown, cwd: string): JsonValue {
  const record = requireRecord(params, "completion/complete params");
  const argument = requireRecord(record.argument, "completion argument");
  const name = readRequiredString(argument, "name");
  const value = readOptionalString(argument, "value", true) ?? "";
  const values = completeValue(name, value, cwd);
  return { completion: { values, total: values.length, hasMore: false } };
}

function listResult(key: string, values: readonly unknown[], params: unknown): JsonValue {
  const cursor = readRecord(params)?.cursor;
  if (cursor !== undefined) throw new JsonRpcError(-32602, "This list has no next page; cursor must be omitted.");
  return { [key]: values as JsonValue };
}

function handleNotification(request: JsonRpcRequest, runtime: McpRuntime): void {
  if (
    request.method === "notifications/initialized" ||
    request.method === "notifications/cancelled" ||
    request.method === "notifications/roots/list_changed"
  ) {
    return;
  }
  runtime.log(`ignored notification: ${request.method}`);
}

function tool(
  name: string,
  title: string,
  description: string,
  inputSchema: JsonValue,
  annotations: JsonValue
): ToolDefinition {
  return { name, title, description, inputSchema, outputSchema: RESULT_SCHEMA, annotations };
}

function readOnlyAnnotations(): JsonValue {
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
}

function toolResult(payload: { readonly text: string; readonly data: JsonValue }): JsonValue {
  return {
    content: [{ type: "text", text: payload.text }],
    structuredContent: payload.data,
  };
}

function toolError(message: string): JsonValue {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: message },
    isError: true,
  };
}

function response(id: string | number | null, result: JsonValue): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id: string | number | null, code: number, message: string, data?: JsonValue): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  const record = readRecord(value);
  if (!record) throw new JsonRpcError(-32602, `${label} must be an object`);
  return record;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function readRequiredString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new JsonRpcError(-32602, `${key} must be a non-empty string`);
  }
  return value;
}

function readOptionalString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  allowEmpty = false
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new JsonRpcError(-32602, `${key} must be ${allowEmpty ? "a string" : "a non-empty string"}`);
  }
  return value;
}

function objectSchema(properties: Readonly<Record<string, JsonValue>>, required?: readonly string[]): JsonValue {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties,
    ...(required && required.length > 0 ? { required } : {}),
  };
}

function optionalString(description: string): JsonValue {
  return { type: "string", description };
}

function optionalBoolean(description: string): JsonValue {
  return { type: "boolean", description };
}

function optionalStringArray(description: string): JsonValue {
  return { type: "array", description, items: { type: "string", minLength: 1 } };
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  const record = readRecord(value);
  return (
    record?.jsonrpc === "2.0" &&
    typeof record.method === "string" &&
    (record.id === undefined || isRequestId(record.id))
  );
}

function isJsonRpcResponse(value: unknown): boolean {
  const record = readRecord(value);
  return (
    record?.jsonrpc === "2.0" &&
    isRequestId(record.id) &&
    record.method === undefined &&
    (record.result !== undefined || record.error !== undefined)
  );
}

function isRequestId(value: unknown): value is string | number | null {
  return value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(realpathSync(resolve(entry))).href;
}

export function runStdioServer(cwd: string = process.env.JIT_MCP_ROOT ?? process.cwd()): void {
  const runtime: McpRuntime = {
    cwd,
    write: (message) => process.stdout.write(`${JSON.stringify(message)}\n`),
    log: (message) => process.stderr.write(`${message}\n`),
  };
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });

  reader.on("line", (line) => {
    if (line.trim().length === 0) return;
    processJsonRpcLine(line, runtime).catch((error: unknown) => {
      runtime.log(error instanceof Error ? error.message : String(error));
    });
  });
}

if (isDirectRun()) runStdioServer();
