import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { stableJson as stableJsonImpl } from "./artifact-json.js";
import type { ArtifactModule, ArtifactProgram, ArtifactSymbol, ProtocolCapability } from "./artifact-program.js";
import { inspectArtifactStatus as inspectArtifactStatusImpl } from "./artifact-status.js";
import { sha256 as sha256Impl } from "./hash.js";

/** Serializes JSON-compatible values with stable key ordering for artifact digests. */
export const stableJson = stableJsonImpl;

/** Computes the SHA-256 digest used by portable artifact metadata. */
export const sha256 = sha256Impl;

/** Current version of the portable JIT artifact manifest. */
export const ARTIFACT_MANIFEST_VERSION = 1 as const;

/** Ownership controls whether generated files remain regenerable. */
export type ArtifactOwnership = "managed" | "detached";

/** Emitted artifact status used by agents before trusting manifest semantics. */
export type ArtifactStatus = "clean" | "stale" | "modified" | "missing" | "detached";

/** Compiler identity recorded in every manifest and receipt. */
export interface CompilerIdentity {
  /** Stable compiler or tool name. */
  readonly name: string;
  /** Compiler version recorded for reproducibility checks. */
  readonly version: string;
}

/** Hash and module-export information for one generated file. */
export interface ManifestFile {
  /** Relative path of the generated file inside the artifact directory. */
  readonly path: string;
  /** SHA-256 digest of the generated file bytes. */
  readonly hash: string;
  /** File size in bytes at the time the manifest was created. */
  readonly bytes: number;
  /** Symbol ids exported by the generated file. */
  readonly exports: readonly string[];
  /** Module imports and the symbol ids each import consumes. */
  readonly imports: readonly {
    /** Imported module id or path. */
    readonly module: string;
    /** Symbol ids imported from the module. */
    readonly symbols: readonly string[];
  }[];
}

/** Public symbol information exposed to agents. */
export interface ManifestSymbol extends ArtifactSymbol {
  /** Relative generated file containing the symbol. */
  readonly file: string;
}

/** Public generated type information. */
export interface ManifestType {
  /** Stable type name used by agent queries. */
  readonly name: string;
  /** Relative generated file containing the type. */
  readonly file: string;
  /** Export name used by the generated module. */
  readonly exportName: string;
  /** Declaration identity from the source model. */
  readonly declaration: string;
}

/** Protocol metadata grouped by generated symbol. */
export interface ManifestProtocol extends ProtocolCapability {
  /** Symbol ids implementing this protocol capability. */
  readonly symbols: readonly string[];
}

/** Declaration-to-artifact traceability without generated source. */
export interface SemanticMap {
  /** Declaration identities and the generated symbols they produced. */
  readonly declarations: readonly {
    /** Stable source declaration identity. */
    readonly declaration: string;
    /** Generated symbol ids attributed to the declaration. */
    readonly symbols: readonly string[];
  }[];
}

/** Versioned metadata sidecar for one generated artifact tree. */
export interface ArtifactManifestV1 {
  /** Wire version of this manifest shape. */
  readonly manifestVersion: typeof ARTIFACT_MANIFEST_VERSION;
  /** Compiler identity used to produce the artifact. */
  readonly compiler: CompilerIdentity;
  /** Digest of the declarations that entered compilation. */
  readonly declarationDigest: string;
  /** Digest of the lowered artifact program. */
  readonly programDigest: string;
  /** Digest of the declared generated files. */
  readonly artifactDigest: string;
  /** Digest of this manifest with its own digest field cleared. */
  readonly manifestDigest: string;
  /** Whether the artifact is managed or detached from regeneration. */
  readonly ownership: ArtifactOwnership;
  /** Format and naming policy used during emission. */
  readonly emission: {
    /** Generated source format. */
    readonly format: "ts" | "js";
    /** Generated file naming policy. */
    readonly naming: "compact" | "semantic";
  };
  /** Hash-bound files included in the artifact. */
  readonly files: readonly ManifestFile[];
  /** Public symbols emitted by the artifact. */
  readonly symbols: readonly ManifestSymbol[];
  /** Public structural types emitted by the artifact. */
  readonly types: readonly ManifestType[];
  /** Protocol capabilities implemented by generated symbols. */
  readonly protocols: readonly ManifestProtocol[];
  /** Traceability map from declarations to generated symbols. */
  readonly semanticMap: SemanticMap;
}

/** One verifiable compiler check in a compilation receipt. */
export interface CompilationCheck {
  /** Stable check name used in diagnostics. */
  readonly name: string;
  /** Outcome of the check. */
  readonly status: "passed" | "warning" | "skipped";
  /** Optional human-readable context for a warning or skip. */
  readonly detail?: string;
}

/** Verifiable link between declarations, metadata and emitted bytes. */
export interface CompilationReceipt {
  /** Compiler version that produced the artifact. */
  readonly compilerVersion: string;
  /** Digest of the input declarations. */
  readonly declarationDigest: string;
  /** Digest of the lowered artifact program. */
  readonly programDigest: string;
  /** Digest of the associated manifest. */
  readonly manifestDigest: string;
  /** Digest of the emitted files. */
  readonly artifactDigest: string;
  /** Number of generated files covered by the receipt. */
  readonly files: number;
  /** Number of generated symbols covered by the receipt. */
  readonly symbols: number;
  /** Individual compiler checks performed for the artifact. */
  readonly checks: readonly CompilationCheck[];
}

/** Result of checking a managed artifact tree against its metadata. */
export interface ArtifactStatusResult {
  /** Trust status derived from the sidecars and generated files. */
  readonly status: ArtifactStatus;
  /** Parsed manifest when one was available. */
  readonly manifest?: ArtifactManifestV1;
  /** Parsed receipt when one was available. */
  readonly receipt?: CompilationReceipt;
  /** Files that are missing, modified or otherwise relevant to the status. */
  readonly files?: readonly string[];
  /** Stable explanation when the artifact is not clean. */
  readonly reason?: string;
}

/** Deterministic lookup tables derived from a trusted manifest for agent queries. */
export interface ArtifactManifestIndex {
  /** Maps source declarations to generated symbol ids. */
  readonly declarationToSymbols: Readonly<Record<string, readonly string[]>>;
  /** Maps generated symbol ids to their files. */
  readonly symbolToFile: Readonly<Record<string, string>>;
  /** Maps generated symbol ids to their dependencies. */
  readonly symbolToDependencies: Readonly<Record<string, readonly string[]>>;
  /** Maps capability names to implementing symbol ids. */
  readonly capabilityToSymbols: Readonly<Record<string, readonly string[]>>;
  /** Maps protocol names to implementing symbol ids. */
  readonly protocolToSymbols: Readonly<Record<string, readonly string[]>>;
  /** Maps generated type names to symbols that consume them. */
  readonly typeToUsers: Readonly<Record<string, readonly string[]>>;
  /** Maps dependency symbol ids to symbols that consume them. */
  readonly symbolConsumers: Readonly<Record<string, readonly string[]>>;
}

/** Input needed to create a manifest after source files have been written. */
export interface ArtifactManifestInput {
  /** Compiler identity recorded in the manifest. */
  readonly compiler: CompilerIdentity;
  /** Digest of the declarations used for compilation. */
  readonly declarationDigest: string;
  /** Lowered program represented by the emitted files. */
  readonly program: ArtifactProgram;
  /** Hash and export metadata for the emitted files. */
  readonly fileHashes: readonly ManifestFile[];
  /** Regeneration ownership of the artifact. */
  readonly ownership: ArtifactOwnership;
  /** Generated source format. */
  readonly format: "ts" | "js";
  /** Generated file naming policy. */
  readonly naming: "compact" | "semantic";
}

/** Computes a declaration digest without storing compiler internals in metadata. */
export function declarationDigest(input: Readonly<Record<string, unknown>>): string {
  return sha256(stableJson(input));
}

/** Creates a deterministic v1 manifest and its integrity digest. */
export function createArtifactManifest(input: ArtifactManifestInput): ArtifactManifestV1 {
  const files = [...input.fileHashes].sort((left, right) => compareText(left.path, right.path));
  const artifactDigest = sha256(stableJson(files.map(({ path, hash, bytes }) => ({ path, hash, bytes }))));
  const base = {
    manifestVersion: ARTIFACT_MANIFEST_VERSION,
    compiler: input.compiler,
    declarationDigest: input.declarationDigest,
    programDigest: sha256(stableJson(input.program)),
    artifactDigest,
    manifestDigest: "",
    ownership: input.ownership,
    emission: { format: input.format, naming: input.naming },
    files,
    symbols: [...input.program.symbols]
      .map((symbol) => ({
        ...symbol,
        file: input.program.modules.find((module) => module.id === symbol.module)?.path ?? symbol.module,
      }))
      .sort((left, right) => compareText(left.name, right.name) || compareText(left.id, right.id)),
    types: collectTypes(input.program),
    protocols: collectProtocols(input.program),
    semanticMap: collectSemanticMap(input.program),
  } satisfies Omit<ArtifactManifestV1, "manifestDigest"> & { readonly manifestDigest: string };
  const manifest = { ...base, manifestDigest: sha256(stableJson(base)) } satisfies ArtifactManifestV1;
  return Object.freeze(manifest);
}

/** Creates the receipt that binds a manifest to the compiler revision. */
export function createCompilationReceipt(
  manifest: ArtifactManifestV1,
  compilerVersion: string,
  checks: readonly CompilationCheck[] = []
): CompilationReceipt {
  return Object.freeze({
    compilerVersion,
    declarationDigest: manifest.declarationDigest,
    programDigest: manifest.programDigest,
    manifestDigest: manifest.manifestDigest,
    artifactDigest: manifest.artifactDigest,
    files: manifest.files.length,
    symbols: manifest.symbols.length,
    checks: Object.freeze([...checks]),
  });
}

/** Builds the agent lookup index without parsing generated source. */
export function createArtifactManifestIndex(manifest: ArtifactManifestV1): ArtifactManifestIndex {
  const declarations = new Map<string, Set<string>>();
  const symbolToFile: Record<string, string> = {};
  const symbolToDependencies: Record<string, readonly string[]> = {};
  const capabilities = new Map<string, Set<string>>();
  const protocols = new Map<string, Set<string>>();
  const consumers = new Map<string, Set<string>>();

  for (const symbol of manifest.symbols) {
    symbolToFile[symbol.id] = symbol.file;
    symbolToDependencies[symbol.id] = [...symbol.dependencies];
    add(declarations, symbol.declaration, symbol.id);
    for (const capability of symbol.capabilities) add(capabilities, capability, symbol.id);
    for (const protocol of symbol.protocols) add(protocols, protocol, symbol.id);
    for (const dependency of symbol.dependencies) add(consumers, dependency, symbol.id);
  }

  const typeToUsers: Record<string, readonly string[]> = {};
  for (const type of manifest.types) {
    typeToUsers[type.name] = [...(consumers.get(symbolIdForType(manifest, type)) ?? [])].sort(compareText);
  }

  return Object.freeze({
    declarationToSymbols: mapToRecord(declarations),
    symbolToFile: Object.freeze({ ...symbolToFile }),
    symbolToDependencies: Object.freeze({ ...symbolToDependencies }),
    capabilityToSymbols: mapToRecord(capabilities),
    protocolToSymbols: mapToRecord(protocols),
    typeToUsers: Object.freeze(typeToUsers),
    symbolConsumers: mapToRecord(consumers),
  });
}

/** Verifies artifact sidecars and generated files without loading generated code. */
export const inspectArtifactStatus = inspectArtifactStatusImpl;

/** Converts one generated module into hash-bound file metadata. */
export function hashArtifactFile(outputDir: string, module: ArtifactModule): ManifestFile {
  const path = safePath(outputDir, module.path);
  const bytes = statSync(path).size;
  return {
    path: module.path,
    hash: sha256(readFileSync(path)),
    bytes,
    exports: module.exports.map((item) => item.symbolId).sort(),
    imports: module.dependencies.map((dependency) => ({
      module: dependency.module,
      symbols: [...dependency.symbols].sort(),
    })),
  };
}

function collectTypes(program: ArtifactProgram): readonly ManifestType[] {
  return program.symbols
    .filter((symbol) => symbol.kind === "type")
    .map((symbol) => ({
      name: symbol.name,
      file: modulePath(program, symbol.module),
      exportName: symbol.exportName,
      declaration: symbol.declaration,
    }))
    .sort((left, right) => compareText(left.name, right.name));
}

function collectProtocols(program: ArtifactProgram): readonly ManifestProtocol[] {
  const groups = new Map<string, { capability: ProtocolCapability; symbols: Set<string> }>();
  for (const binding of program.protocols) {
    const key = `${binding.protocol}:${binding.version}:${binding.input}:${binding.output}`;
    const capability: ProtocolCapability = {
      protocol: binding.protocol,
      version: binding.version,
      input: binding.input,
      output: binding.output,
    };
    const group = groups.get(key) ?? { capability, symbols: new Set<string>() };
    group.symbols.add(binding.symbolId);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ capability, symbols }) => ({ ...capability, symbols: [...symbols].sort() }))
    .sort((left, right) => compareText(`${left.protocol}:${left.version}`, `${right.protocol}:${right.version}`));
}

function collectSemanticMap(program: ArtifactProgram): SemanticMap {
  const groups = new Map<string, Set<string>>();
  for (const symbol of program.symbols) {
    const symbols = groups.get(symbol.declaration) ?? new Set<string>();
    symbols.add(symbol.id);
    groups.set(symbol.declaration, symbols);
  }
  return {
    declarations: [...groups.entries()]
      .map(([declaration, symbols]) => ({ declaration, symbols: [...symbols].sort() }))
      .sort((left, right) => compareText(left.declaration, right.declaration)),
  };
}

function modulePath(program: ArtifactProgram, id: string): string {
  return program.modules.find((module) => module.id === id)?.path ?? id;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

function mapToRecord(map: Map<string, Set<string>>): Readonly<Record<string, readonly string[]>> {
  return Object.freeze(
    Object.fromEntries(
      [...map.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, values]) => [key, Object.freeze([...values].sort(compareText))])
    )
  );
}

function symbolIdForType(manifest: ArtifactManifestV1, type: ManifestType): string {
  return (
    manifest.symbols.find(
      (symbol) => symbol.name === type.name && symbol.file === type.file && symbol.exportName === type.exportName
    )?.id ?? type.name
  );
}

function safePath(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error(`Artifact path must be relative: ${path}`);
  const resolved = resolve(root, path);
  const rel = relative(resolve(root), resolved);
  if (rel === ".." || rel.startsWith("..\\") || rel.startsWith("../"))
    throw new Error(`Artifact path escapes output directory: ${path}`);
  return resolved;
}
