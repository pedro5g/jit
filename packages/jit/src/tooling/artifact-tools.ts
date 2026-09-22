import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type ArtifactStatusResult,
  createArtifactManifestIndex,
  inspectArtifactStatus,
} from "../aot/artifact-manifest.js";
import { AgentToolCore, type JsonValue, TOOL_RESULT_SCHEMA, type ToolContract, type ToolPayload } from "./contracts.js";

/** Builds the shared artifact lookup tools used by MCP, WebMCP and Lab. */
export function createArtifactToolCore(): AgentToolCore {
  return new AgentToolCore([
    statusContract(),
    findContract(),
    describeContract(),
    dependenciesContract(),
    sourceReadContract(),
    materializeContract(),
  ]);
}

function statusContract(): ToolContract {
  return {
    name: "jit_artifact_status",
    description: "Check whether a managed artifact manifest still matches its files.",
    mode: "read",
    outputSchema: TOOL_RESULT_SCHEMA,
    inputSchema: artifactPathSchema(),
    execute: async (input, context) => statusTool(input, context.root),
  };
}

function findContract(): ToolContract {
  return {
    name: "jit_artifact_find",
    description: "Find a generated symbol by declaration, export name or capability without reading source.",
    mode: "read",
    outputSchema: TOOL_RESULT_SCHEMA,
    inputSchema: objectSchema({
      ...artifactPathProperties(),
      symbol: optionalString("Exact symbol name or id."),
      declaration: optionalString("Declaration name."),
      capability: optionalString("Capability such as parse, create or timestamps."),
    }),
    execute: async (input, context) => findTool(input, context.root),
  };
}

function describeContract(): ToolContract {
  return {
    name: "jit_artifact_describe",
    description: "Describe a clean generated symbol contract without returning implementation source.",
    mode: "read",
    outputSchema: TOOL_RESULT_SCHEMA,
    inputSchema: objectSchema({
      ...artifactPathProperties(),
      symbol: { type: "string", minLength: 1, description: "Symbol name or symbol id." },
    }),
    execute: async (input, context) => describeTool(input, context.root),
  };
}

function dependenciesContract(): ToolContract {
  return {
    name: "jit_artifact_dependencies",
    description: "List forward and reverse generated-symbol dependencies from the manifest index.",
    mode: "read",
    outputSchema: TOOL_RESULT_SCHEMA,
    inputSchema: objectSchema({
      ...artifactPathProperties(),
      symbol: { type: "string", minLength: 1, description: "Symbol name or symbol id." },
    }),
    execute: async (input, context) => dependenciesTool(input, context.root),
  };
}

function sourceReadContract(): ToolContract {
  return {
    name: "jit_source_read",
    description: "Explicitly read one generated file for debugging or manual review; semantic tools do not call this.",
    mode: "read",
    outputSchema: TOOL_RESULT_SCHEMA,
    inputSchema: objectSchema({
      outDir: optionalString("Generated output directory relative to the project root."),
      path: { type: "string", minLength: 1, description: "Relative generated file path." },
    }),
    execute: async (input, context) => sourceReadTool(input, context.root),
  };
}

function materializeContract(): ToolContract {
  return {
    name: "jit_artifact_materialize",
    description: "Copy a clean managed artifact and its metadata to a target without reading source into the response.",
    mode: "write",
    outputSchema: TOOL_RESULT_SCHEMA,
    inputSchema: objectSchema({
      ...artifactPathProperties(),
      targetDir: { type: "string", minLength: 1, description: "Target directory relative to the project root." },
    }),
    execute: async (input, context) => materializeTool(input, context.root),
  };
}

function artifactPathSchema(): JsonValue {
  return objectSchema(artifactPathProperties());
}

function artifactPathProperties(): Record<string, JsonValue> {
  return {
    outDir: optionalString("Generated output directory relative to the project root."),
    manifestPath: optionalString("Manifest path relative to the generated output directory."),
    receiptPath: optionalString("Receipt path relative to the generated output directory."),
  };
}

async function statusTool(input: JsonValue, root: string): Promise<ToolPayload> {
  const result = inspect(input, root);
  return {
    text: `artifact status: ${result.status}${result.reason ? ` (${result.reason})` : ""}`,
    data: statusData(result),
  };
}

async function findTool(input: JsonValue, root: string): Promise<ToolPayload> {
  const result = inspect(input, root);
  if (result.status !== "clean") return untrusted(result);
  const record = inputRecord(input);
  const symbols =
    result.manifest?.symbols.filter((symbol) => {
      const exact = readString(record, "symbol");
      const declaration = readString(record, "declaration");
      const capability = readString(record, "capability");
      return (
        (exact === undefined || symbol.name === exact || symbol.id === exact || symbol.exportName === exact) &&
        (declaration === undefined || symbol.declaration === declaration) &&
        (capability === undefined || symbol.capabilities.includes(capability))
      );
    }) ?? [];
  const matches = symbols.map((symbol) => ({ file: symbol.file, export: symbol.exportName, id: symbol.id }));
  return {
    text:
      matches.length > 0
        ? matches.map((match) => `${match.export}: ${match.file}`).join("\n")
        : "No generated symbol matched.",
    data: { status: result.status, matches },
  };
}

async function describeTool(input: JsonValue, root: string): Promise<ToolPayload> {
  const result = inspect(input, root);
  if (result.status !== "clean") return untrusted(result);
  const symbolName = readString(inputRecord(input), "symbol");
  const symbol = result.manifest?.symbols.find(
    (candidate) => candidate.name === symbolName || candidate.id === symbolName || candidate.exportName === symbolName
  );
  if (!symbol)
    return {
      text: `No generated symbol matched ${JSON.stringify(symbolName)}.`,
      data: { status: result.status, symbol: null },
    };
  return {
    text: `${symbol.name}: ${symbol.kind} at ${symbol.file}`,
    data: { status: result.status, symbol: toJsonValue(symbol) },
  };
}

async function dependenciesTool(input: JsonValue, root: string): Promise<ToolPayload> {
  const result = inspect(input, root);
  if (result.status !== "clean") return untrusted(result);
  const symbolName = readString(inputRecord(input), "symbol");
  const symbol = result.manifest?.symbols.find(
    (candidate) => candidate.name === symbolName || candidate.id === symbolName || candidate.exportName === symbolName
  );
  if (!symbol || !result.manifest)
    return {
      text: `No generated symbol matched ${JSON.stringify(symbolName)}.`,
      data: { status: result.status, symbol: null },
    };
  const index = createArtifactManifestIndex(result.manifest);
  const consumers = index.symbolConsumers[symbol.id] ?? [];
  return {
    text: `${symbol.name}: ${symbol.dependencies.length} dependency(ies), ${consumers.length} consumer(s)`,
    data: { status: result.status, symbol: symbol.id, dependencies: symbol.dependencies, consumers },
  };
}

async function sourceReadTool(input: JsonValue, root: string): Promise<ToolPayload> {
  const record = inputRecord(input);
  const directory = outputDirectory(record, root);
  const path = readString(record, "path");
  if (!path || path.startsWith("/") || path.includes(".."))
    throw new Error("path must stay inside the artifact directory.");
  const file = resolve(directory, path);
  if (!existsSync(file)) throw new Error(`Generated file does not exist: ${path}`);
  const content = readFileSync(file, "utf8");
  return { text: `${path} (${Buffer.byteLength(content, "utf8")} bytes)`, data: { path, content } };
}

async function materializeTool(input: JsonValue, root: string): Promise<ToolPayload> {
  const record = inputRecord(input);
  const result = inspect(input, root);
  if (result.status !== "clean") return untrusted(result);
  const sourceDirectory = outputDirectory(record, root);
  const targetName = readString(record, "targetDir");
  if (!targetName) throw new Error("targetDir is required for artifact materialization.");
  const targetDirectory = outputDirectory({ ...record, outDir: targetName }, root);
  const manifestName = readString(record, "manifestPath") ?? "jit.manifest.json";
  const receiptName = readString(record, "receiptPath") ?? "jit.receipt.json";
  const paths = [...(result.files ?? []), manifestName, receiptName];
  const counts = { created: 0, updated: 0, unchanged: 0 };

  for (const path of paths) {
    if (path.startsWith("/") || path.includes("..")) throw new Error("artifact file path must stay relative.");
    const source = resolve(sourceDirectory, path);
    const destination = resolve(targetDirectory, path);
    if (!existsSync(source)) throw new Error(`Generated file does not exist: ${path}`);
    const bytes = readFileSync(source);
    mkdirSync(dirname(destination), { recursive: true });
    if (!existsSync(destination)) {
      writeFileSync(destination, bytes);
      counts.created++;
    } else if (readFileSync(destination).equals(bytes)) {
      counts.unchanged++;
    } else {
      writeFileSync(destination, bytes);
      counts.updated++;
    }
  }

  return {
    text: `materialized ${paths.length} artifact file(s) to ${targetName}`,
    data: { status: "success", targetDir: targetName, ...counts, files: paths },
  };
}

function inspect(input: JsonValue, root: string): ArtifactStatusResult {
  const record = inputRecord(input);
  const directory = outputDirectory(record, root);
  if (!existsSync(directory)) return { status: "missing", reason: "output directory is missing" };
  return inspectArtifactStatus(
    directory,
    readString(record, "manifestPath") ?? "jit.manifest.json",
    readString(record, "receiptPath") ?? "jit.receipt.json"
  );
}

function outputDirectory(record: Readonly<Record<string, JsonValue>>, root: string): string {
  const outDir = readString(record, "outDir") ?? "generated";
  if (outDir.startsWith("/") || outDir.includes("..")) throw new Error("outDir must stay inside the project root.");
  return resolve(root, outDir);
}

function untrusted(result: ArtifactStatusResult): ToolPayload {
  return {
    text: `artifact metadata is ${result.status}; manifest semantics are not authoritative${result.reason ? ` (${result.reason})` : ""}`,
    data: statusData(result),
  };
}

function statusData(result: ArtifactStatusResult): JsonValue {
  return {
    status: result.status,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.files ? { files: result.files } : {}),
    ...(result.status === "clean" && result.manifest
      ? {
          revision: result.manifest.declarationDigest,
          artifactDigest: result.manifest.artifactDigest,
          manifestDigest: result.manifest.manifestDigest,
        }
      : {}),
  };
}

function objectSchema(properties: Record<string, JsonValue>): JsonValue {
  return { type: "object", properties, additionalProperties: false };
}

function optionalString(description: string): JsonValue {
  return { type: "string", minLength: 1, description };
}

function inputRecord(value: JsonValue): Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : {};
}

function readString(record: Readonly<Record<string, JsonValue>>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
