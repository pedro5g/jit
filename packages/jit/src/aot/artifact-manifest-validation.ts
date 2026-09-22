import type {
  ArtifactManifestV1,
  CompilationCheck,
  CompilationReceipt,
  ManifestFile,
  ManifestProtocol,
  ManifestSymbol,
  ManifestType,
  SemanticMap,
} from "./artifact-manifest.js";

/** Validates the public shape before an agent trusts persisted metadata. */
export function isArtifactManifest(value: unknown): value is ArtifactManifestV1 {
  if (!isRecord(value)) return false;
  const structural =
    isManifestIdentity(value) &&
    isArrayOf(value.files, isManifestFile) &&
    isArrayOf(value.symbols, isManifestSymbol) &&
    isArrayOf(value.types, isManifestType) &&
    isArrayOf(value.protocols, isManifestProtocol) &&
    isSemanticMap(value.semanticMap);
  return structural && isManifestComplete(value);
}

function isManifestComplete(value: Record<string, unknown>): boolean {
  const files = value.files as readonly ManifestFile[];
  const symbols = value.symbols as readonly ManifestSymbol[];
  const symbolIds = new Set(symbols.map((symbol) => symbol.id));
  const filePaths = new Set(files.map((file) => file.path));
  const protocols = value.protocols as readonly ManifestProtocol[];
  const semanticMap = value.semanticMap as SemanticMap;
  return (
    symbolIds.size === symbols.length &&
    filesReferenceSymbols(files, symbolIds) &&
    filesReferenceImportedSymbols(files, symbolIds) &&
    symbolsReferenceFiles(symbols, filePaths) &&
    protocolsReferenceSymbols(protocols, symbolIds) &&
    semanticMapReferencesSymbols(semanticMap, symbolIds)
  );
}

function filesReferenceSymbols(files: readonly ManifestFile[], symbolIds: ReadonlySet<string>): boolean {
  return files.every((file) => file.exports.every((symbol) => symbolIds.has(symbol)));
}

function filesReferenceImportedSymbols(files: readonly ManifestFile[], symbolIds: ReadonlySet<string>): boolean {
  return files.every((file) =>
    file.imports.every((dependency) => dependency.symbols.every((symbol) => symbolIds.has(symbol)))
  );
}

function symbolsReferenceFiles(symbols: readonly ManifestSymbol[], filePaths: ReadonlySet<string>): boolean {
  return symbols.every((symbol) => filePaths.has(symbol.file));
}

function protocolsReferenceSymbols(protocols: readonly ManifestProtocol[], symbolIds: ReadonlySet<string>): boolean {
  return protocols.every((protocol) => protocol.symbols.every((symbol) => symbolIds.has(symbol)));
}

function semanticMapReferencesSymbols(semanticMap: SemanticMap, symbolIds: ReadonlySet<string>): boolean {
  return semanticMap.declarations.every((entry) => entry.symbols.every((symbol) => symbolIds.has(symbol)));
}

function isManifestIdentity(value: Record<string, unknown>): boolean {
  if (value.manifestVersion !== 1 || !isRecord(value.compiler)) return false;
  if (!isString(value.compiler.name) || !isString(value.compiler.version)) return false;
  if (!isDigest(value.declarationDigest) || !isDigest(value.programDigest)) return false;
  if (!isDigest(value.artifactDigest) || !isDigest(value.manifestDigest)) return false;
  if (value.ownership !== "managed" && value.ownership !== "detached") return false;
  if (!isRecord(value.emission)) return false;
  return (
    (value.emission.format === "ts" || value.emission.format === "js") &&
    (value.emission.naming === "compact" || value.emission.naming === "semantic")
  );
}

export function isCompilationReceipt(value: unknown): value is CompilationReceipt {
  if (!isRecord(value)) return false;
  return (
    isString(value.compilerVersion) &&
    isDigest(value.declarationDigest) &&
    isDigest(value.programDigest) &&
    isDigest(value.manifestDigest) &&
    isDigest(value.artifactDigest) &&
    Number.isInteger(value.files) &&
    Number.isInteger(value.symbols) &&
    isArrayOf(value.checks, isCompilationCheck)
  );
}

function isManifestFile(value: unknown): value is ManifestFile {
  if (!isRecord(value) || !isString(value.path) || !isDigest(value.hash) || !Number.isInteger(value.bytes))
    return false;
  return (
    isArrayOf(value.exports, isString) &&
    isArrayOf(
      value.imports,
      (item): item is ManifestFile["imports"][number] =>
        isRecord(item) && isString(item.module) && isArrayOf(item.symbols, isString)
    )
  );
}

function isManifestSymbol(value: unknown): value is ManifestSymbol {
  return isRecord(value) && isManifestSymbolIdentity(value) && isManifestSymbolShape(value);
}

function isManifestSymbolIdentity(value: Record<string, unknown>): boolean {
  return (
    isString(value.id) &&
    isString(value.name) &&
    isString(value.module) &&
    isString(value.file) &&
    isString(value.exportName) &&
    isString(value.declaration)
  );
}

function isManifestSymbolShape(value: Record<string, unknown>): boolean {
  return isValidClassMetadata(value) && isManifestSymbolCollections(value);
}

function isValidClassMetadata(value: Record<string, unknown>): boolean {
  return (
    (value.construction === undefined || value.construction === "constructor" || value.construction === "factory") &&
    (value.factories === undefined || isFactories(value.factories)) &&
    (value.event === undefined || isEvent(value.event))
  );
}

function isManifestSymbolCollections(value: Record<string, unknown>): boolean {
  return (
    isString(value.kind) &&
    isArrayOf(value.capabilities, isString) &&
    isArrayOf(value.protocols, isString) &&
    isArrayOf(value.dependencies, isString) &&
    isArrayOf(value.effects, isManifestEffect)
  );
}

function isManifestEffect(value: unknown): value is ManifestSymbol["effects"][number] {
  return isRecord(value) && isString(value.kind) && (value.target === undefined || isString(value.target));
}

function isFactories(value: unknown): boolean {
  return (
    isRecord(value) &&
    (typeof value.create === "string" || value.create === false) &&
    (typeof value.hydrate === "string" || value.hydrate === false)
  );
}

function isEvent(value: unknown): boolean {
  return isRecord(value) && isString(value.type) && Number.isInteger(value.version);
}

function isManifestType(value: unknown): value is ManifestType {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isString(value.file) &&
    isString(value.exportName) &&
    isString(value.declaration)
  );
}

function isManifestProtocol(value: unknown): value is ManifestProtocol {
  return (
    isRecord(value) &&
    isString(value.protocol) &&
    Number.isInteger(value.version) &&
    isString(value.input) &&
    isString(value.output) &&
    isArrayOf(value.symbols, isString)
  );
}

function isSemanticMap(value: unknown): value is SemanticMap {
  return (
    isRecord(value) &&
    isArrayOf(
      value.declarations,
      (item): item is SemanticMap["declarations"][number] =>
        isRecord(item) && isString(item.declaration) && isArrayOf(item.symbols, isString)
    )
  );
}

function isCompilationCheck(value: unknown): value is CompilationCheck {
  return (
    isRecord(value) &&
    isString(value.name) &&
    (value.status === "passed" || value.status === "warning" || value.status === "skipped") &&
    (value.detail === undefined || isString(value.detail))
  );
}

function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is readonly T[] {
  return Array.isArray(value) && value.every(guard);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
