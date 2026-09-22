import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type ArtifactManifestV1,
  type ArtifactStatusResult,
  inspectArtifactStatus,
  sha256,
} from "../aot/artifact-manifest.js";
import { type AotOutputFormat, generate } from "../aot/index.js";
import { AgentToolCore, type JsonValue, TOOL_RESULT_SCHEMA, type ToolContract, type ToolPayload } from "./contracts.js";
import {
  applyDeclarationPatch,
  createDeclarationProject,
  type DeclarationPatchV1,
  type DeclarationProjectV1,
  declarationProjectDigest,
  parseDeclarationPatch,
  validateDeclarationProject,
} from "./declaration-protocol.js";
import { materializeProject } from "./model-materializer.js";
import { diffDeclarationProjects, propagateDeclarationChanges } from "./semantic-diff.js";

const MODEL_FILE = [".jit", "declarations.v1.json"] as const;
const COMPILED_MODEL_FILE = [".jit", "compiled.v1.json"] as const;

/** Builds the model and compile tools shared by all agent transports. */
export function createModelToolCore(): AgentToolCore {
  const contracts: ToolContract[] = [
    {
      name: "jit_model_get",
      description: "Read a filtered Declaration Protocol V1 project model.",
      mode: "read",
      outputSchema: TOOL_RESULT_SCHEMA,
      inputSchema: objectSchema({ scope: optionalString("Declaration name to read, or omit for the model metadata.") }),
      execute: async (input, context) => modelGet(input, context.root),
    },
    {
      name: "jit_model_apply",
      description: "Apply a revision-checked structured declaration patch.",
      mode: "write",
      outputSchema: TOOL_RESULT_SCHEMA,
      inputSchema: objectSchema({
        baseRevision: { type: "string", minLength: 1, description: "Revision the patch was based on." },
        operations: { type: "array", minItems: 1, description: "Declaration Protocol V1 operations." },
      }),
      execute: async (input, context) => modelApply(input, context.root),
    },
    {
      name: "jit_compile_plan",
      description: "Preview affected declarations, files and semantic changes without writing source.",
      mode: "preview",
      outputSchema: TOOL_RESULT_SCHEMA,
      inputSchema: objectSchema({ outDir: optionalString("Generated output directory relative to the project root.") }),
      execute: async (input, context) => compilePlan(input, context.root),
    },
    {
      name: "jit_compile",
      description: "Compile the current declaration project into a managed standalone artifact tree.",
      mode: "write",
      outputSchema: TOOL_RESULT_SCHEMA,
      inputSchema: objectSchema({
        outDir: optionalString("Generated output directory relative to the project root."),
        format: { type: "string", enum: ["ts", "js"], description: "Generated source format." },
        naming: { type: "string", enum: ["compact", "semantic"], description: "Generated helper naming profile." },
        ownership: {
          type: "string",
          enum: ["managed", "detached"],
          description: "Whether the declaration project remains the source of truth after emission.",
        },
        overwriteModified: {
          type: "boolean",
          description: "Explicitly allow replacing modified managed generated files; defaults to false.",
        },
      }),
      execute: async (input, context) => compile(input, context.root),
    },
  ];
  return new AgentToolCore(contracts);
}

async function modelGet(input: JsonValue, root: string): Promise<ToolPayload> {
  const project = readProject(root);
  const scope = readString(inputRecord(input), "scope");
  const declarations =
    scope === undefined ? {} : project.declarations[scope] ? { [scope]: project.declarations[scope] } : {};
  const data = scope === undefined ? project : { ...project, declarations };
  return { text: `declaration model ${project.revision}`, data: toJsonValue(data) };
}

async function modelApply(input: JsonValue, root: string): Promise<ToolPayload> {
  const patch = parsePatch(input);
  const next = applyDeclarationPatch(readProject(root), patch);
  writeProject(root, next);
  return {
    text: `declaration model advanced to ${next.revision}`,
    data: { status: "success", revision: next.revision, declarations: Object.keys(next.declarations).sort() },
  };
}

async function compilePlan(input: JsonValue, root: string): Promise<ToolPayload> {
  const project = readProject(root);
  const record = inputRecord(input);
  const outDir = readString(record, "outDir") ?? "generated";
  const declarations = Object.keys(project.declarations).sort();
  const artifactDirectory = safeRelative(root, outDir);
  const previous = inspectArtifactStatus(artifactDirectory);
  const currentDigest = declarationProjectDigest(project);
  const unchanged = previous.status === "clean" && previous.manifest?.declarationDigest === currentDigest;
  const previousDeclarations = new Set(
    previous.manifest?.semanticMap.declarations.map((item) => item.declaration) ?? []
  );
  const allDeclarations = [...new Set([...declarations, ...previousDeclarations])].sort();
  const previousProject = readCompiledProject(root);
  const semanticChanges =
    unchanged || previousProject === undefined
      ? []
      : propagateDeclarationChanges(project, diffDeclarationProjects(previousProject, project));
  const completeSemanticChanges = unchanged
    ? []
    : semanticChanges.length > 0
      ? semanticChanges
      : allDeclarations.map((declaration) => ({
          symbol: declaration,
          change: declarations.includes(declaration)
            ? previousDeclarations.has(declaration)
              ? "declaration-changed"
              : "declared"
            : "removed",
          path: [],
        }));
  const affectedDeclarations = unchanged
    ? []
    : [...new Set(completeSemanticChanges.map((change) => change.symbol))].sort(compareText);
  const affectedModules = unchanged ? [] : modulesForChanges(project, previousProject, completeSemanticChanges);
  const format = readFormat(record);
  const expectedModuleFiles = [
    ...new Set(
      Object.entries(project.declarations).map(
        ([name, declaration]) => `${declaration.module === undefined ? "" : `${declaration.module}/`}${name}.${format}`
      )
    ),
  ].sort(compareText);
  return {
    text: `compile plan for ${project.revision}: ${affectedDeclarations.length} affected declaration(s)`,
    data: {
      revision: project.revision,
      artifactStatus: previous.status,
      affectedDeclarations,
      affectedModules,
      expectedWrites: unchanged
        ? []
        : [
            ...expectedModuleFiles.map((file) => join(outDir, file)),
            join(outDir, "jit.manifest.json"),
            join(outDir, "jit.receipt.json"),
          ],
      protocolChanges: [],
      semanticChanges: toJsonValue(completeSemanticChanges),
    },
  };
}

function modulesForChanges(
  current: DeclarationProjectV1,
  previous: DeclarationProjectV1 | undefined,
  changes: readonly { readonly symbol: string }[]
): readonly string[] {
  const modules = new Set<string>();
  for (const { symbol } of changes) {
    const currentModule = current.declarations[symbol]?.module;
    const previousModule = previous?.declarations[symbol]?.module;
    modules.add(currentModule ?? previousModule ?? "index");
    if (currentModule !== undefined && previousModule !== undefined) modules.add(previousModule);
  }
  return [...modules].sort(compareText);
}

async function compile(input: JsonValue, root: string): Promise<ToolPayload> {
  const project = readProject(root);
  const record = inputRecord(input);
  const outDirName = readString(record, "outDir") ?? "generated";
  const outDir = safeRelative(root, outDirName);
  const format = readFormat(record);
  const naming = readNaming(record);
  const ownership = readOwnership(record);
  const overwriteModified = readOptionalBoolean(record, "overwriteModified") ?? false;
  const currentDigest = declarationProjectDigest(project);
  const existing = inspectArtifactStatus(outDir);
  const previousMetadata = metadataHashes(outDir);
  if (existing.status === "modified" && ownership === "managed" && !overwriteModified) {
    return blockedCompilation(existing.files ?? []);
  }
  if (isUnchangedArtifact(existing, currentDigest, format, naming, ownership)) {
    writeCompiledProject(root, project);
    return unchangedCompilation(project, existing, ownership);
  }
  return compileGenerated(project, root, {
    outDir,
    format,
    naming,
    ownership,
    overwriteModified,
    previousMetadata,
    existing,
  });
}

function blockedCompilation(files: readonly string[]): ToolPayload {
  return {
    text: "managed artifact is modified; compilation requires overwriteModified=true",
    data: {
      status: "blocked",
      artifactStatus: "modified",
      files,
      reason: "managed generated files are not overwritten implicitly",
    },
  };
}

function isUnchangedArtifact(
  existing: ArtifactStatusResult,
  declarationDigest: string,
  format: AotOutputFormat,
  naming: "compact" | "semantic",
  ownership: "managed" | "detached"
): existing is ArtifactStatusResult & { readonly status: "clean"; readonly manifest: ArtifactManifestV1 } {
  return (
    existing.status === "clean" &&
    existing.manifest?.declarationDigest === declarationDigest &&
    existing.manifest.emission.format === format &&
    existing.manifest.emission.naming === naming &&
    existing.manifest.ownership === ownership
  );
}

function unchangedCompilation(
  project: DeclarationProjectV1,
  existing: ArtifactStatusResult & { readonly status: "clean"; readonly manifest: ArtifactManifestV1 },
  ownership: "managed" | "detached"
): ToolPayload {
  const manifest = existing.manifest;
  return {
    text: `compiled ${project.revision} with no artifact changes`,
    data: {
      status: "success",
      revision: project.revision,
      artifactDigest: manifest.artifactDigest,
      manifestDigest: manifest.manifestDigest,
      files: manifest.files.length,
      metadataFiles: 2,
      created: 0,
      updated: 0,
      unchanged: manifest.files.length + 2,
      symbols: manifest.symbols.length,
      ownership,
    },
  };
}

interface CompileGeneratedOptions {
  readonly outDir: string;
  readonly format: AotOutputFormat;
  readonly naming: "compact" | "semantic";
  readonly ownership: "managed" | "detached";
  readonly overwriteModified: boolean;
  readonly previousMetadata: ReadonlyMap<string, string>;
  readonly existing: ReturnType<typeof inspectArtifactStatus>;
}

function compileGenerated(project: DeclarationProjectV1, root: string, options: CompileGeneratedOptions): ToolPayload {
  const materialized = materializeProject(project);
  const result = generate({
    artifacts: materialized.artifacts,
    schemas: materialized.schemas,
    modulePaths: materialized.modulePaths,
    outDir: options.outDir,
    format: options.format,
    perFile: true,
    naming: options.naming,
    declarationDigest: declarationProjectDigest(project),
    emitManifest: true,
    ownership: options.ownership,
    overwriteModified: options.overwriteModified,
  });
  if (!result.manifest || !result.receipt) throw new Error("Compilation did not produce a manifest and receipt.");
  writeCompiledProject(root, project);
  const changes = countArtifactChanges(
    options.outDir,
    options.existing.manifest,
    result.manifest,
    options.previousMetadata
  );
  return {
    text: `compiled ${project.revision} into ${result.manifest.artifactDigest}`,
    data: {
      status: "success",
      revision: project.revision,
      artifactDigest: result.manifest.artifactDigest,
      manifestDigest: result.manifest.manifestDigest,
      files: result.manifest.files.length,
      metadataFiles: result.files.length - result.manifest.files.length,
      created: changes.created,
      updated: changes.updated,
      unchanged: changes.unchanged,
      symbols: result.manifest.symbols.length,
      ownership: options.ownership,
    },
  };
}

interface ArtifactChangeCounts {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
}

function metadataHashes(directory: string): ReadonlyMap<string, string> {
  const hashes = new Map<string, string>();
  for (const name of ["jit.manifest.json", "jit.receipt.json"]) {
    const path = join(directory, name);
    if (existsSync(path)) hashes.set(name, sha256(readFileSync(path)));
  }
  return hashes;
}

function countArtifactChanges(
  directory: string,
  previous: ArtifactManifestV1 | undefined,
  current: ArtifactManifestV1,
  previousMetadata: ReadonlyMap<string, string>
): ArtifactChangeCounts {
  const previousFiles = new Map(previous?.files.map((file) => [file.path, file]));
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const file of current.files) {
    const old = previousFiles.get(file.path);
    if (!old) created++;
    else if (old.hash === file.hash && old.bytes === file.bytes) unchanged++;
    else updated++;
  }
  const currentMetadata = new Map(
    ["jit.manifest.json", "jit.receipt.json"].map(
      (name) => [name, sha256(readFileSync(join(directory, name)))] as const
    )
  );
  for (const [name, hash] of currentMetadata) {
    const old = previousMetadata.get(name);
    if (!old) created++;
    else if (old === hash) unchanged++;
    else updated++;
  }
  return { created, updated, unchanged };
}

function parsePatch(input: JsonValue): DeclarationPatchV1 {
  return parseDeclarationPatch(input);
}

function readProject(root: string): DeclarationProjectV1 {
  const path = join(root, ...MODEL_FILE);
  try {
    const project = JSON.parse(readFileSync(path, "utf8")) as DeclarationProjectV1;
    validateDeclarationProject(project);
    return project;
  } catch (error) {
    if (existsSync(path))
      throw new Error(`Invalid declaration project ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return createDeclarationProject();
  }
}

function writeProject(root: string, project: DeclarationProjectV1): void {
  const directory = join(root, MODEL_FILE[0]);
  const path = join(root, ...MODEL_FILE);
  mkdirSync(directory, { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(project, null, 2)}\n`);
  renameSync(temporary, path);
}

function readCompiledProject(root: string): DeclarationProjectV1 | undefined {
  const path = join(root, ...COMPILED_MODEL_FILE);
  if (!existsSync(path)) return undefined;
  try {
    const project = JSON.parse(readFileSync(path, "utf8")) as DeclarationProjectV1;
    validateDeclarationProject(project);
    return project;
  } catch {
    return undefined;
  }
}

function writeCompiledProject(root: string, project: DeclarationProjectV1): void {
  const directory = join(root, COMPILED_MODEL_FILE[0]);
  const path = join(root, ...COMPILED_MODEL_FILE);
  mkdirSync(directory, { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(project, null, 2)}\n`);
  renameSync(temporary, path);
}

function safeRelative(root: string, path: string): string {
  if (path.startsWith("/") || path.includes("..")) throw new Error("path must stay inside the project root.");
  return resolve(root, path);
}

function readFormat(record: Readonly<Record<string, JsonValue>>): AotOutputFormat {
  const format = readString(record, "format");
  if (format === "js" || format === "ts" || format === undefined) return format ?? "ts";
  throw new Error('format must be "ts" or "js".');
}

function readNaming(record: Readonly<Record<string, JsonValue>>): "compact" | "semantic" {
  const naming = readString(record, "naming");
  if (naming === "semantic" || naming === "compact" || naming === undefined) return naming ?? "compact";
  throw new Error('naming must be "compact" or "semantic".');
}

function readOwnership(record: Readonly<Record<string, JsonValue>>): "managed" | "detached" {
  const ownership = readString(record, "ownership");
  if (ownership === "managed" || ownership === "detached" || ownership === undefined) return ownership ?? "managed";
  throw new Error('ownership must be "managed" or "detached".');
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

function readOptionalBoolean(record: Readonly<Record<string, JsonValue>>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
