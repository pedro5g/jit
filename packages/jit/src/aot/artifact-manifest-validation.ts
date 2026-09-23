import type {
  ArtifactManifestV1,
  CompilationCheck,
  CompilationReceipt,
  ManifestFile,
  ManifestPhysicalPlan,
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
  return isManifestHeader(value) && isManifestDigests(value) && isManifestOwnership(value) && isManifestEmission(value);
}

function isManifestHeader(value: Record<string, unknown>): boolean {
  return value.manifestVersion === 1 && isManifestCompiler(value.compiler);
}

function isManifestCompiler(value: unknown): boolean {
  return isRecord(value) && isString(value.name) && isString(value.version);
}

function isManifestDigests(value: Record<string, unknown>): boolean {
  return (
    isDigest(value.declarationDigest) &&
    isDigest(value.programDigest) &&
    isDigest(value.artifactDigest) &&
    isDigest(value.manifestDigest)
  );
}

function isManifestOwnership(value: Record<string, unknown>): boolean {
  return value.ownership === "managed" || value.ownership === "detached";
}

function isManifestEmission(value: Record<string, unknown>): boolean {
  if (!isRecord(value.emission)) return false;
  return (
    (value.emission.format === "ts" || value.emission.format === "js") &&
    (value.emission.naming === "compact" || value.emission.naming === "semantic") &&
    (value.target === undefined || isManifestTarget(value.target)) &&
    (value.physicalPlanDigest === undefined || isDigest(value.physicalPlanDigest)) &&
    (value.physicalPlans === undefined || isArrayOf(value.physicalPlans, isManifestPhysicalPlan))
  );
}

function isManifestPhysicalPlan(value: unknown): value is ManifestPhysicalPlan {
  if (!isRecord(value) || !isString(value.symbol) || !isString(value.target) || !isPhysicalDigest(value.digest))
    return false;
  return (
    (value.capabilities === undefined || isArrayOf(value.capabilities, isManifestCapability)) &&
    isArrayOf(value.decisions, isManifestDecision)
  );
}

function isManifestCapability(value: unknown): value is NonNullable<ManifestPhysicalPlan["capabilities"]>[number] {
  return (
    isRecord(value) &&
    isString(value.kind) &&
    (value.key === undefined || isString(value.key)) &&
    Number.isInteger(value.sourceStage) &&
    typeof value.reusable === "boolean"
  );
}

function isManifestDecision(value: unknown): value is ManifestPhysicalPlan["decisions"][number] {
  if (!isRecord(value)) return false;
  return (
    isString(value.family) &&
    isString(value.strategy) &&
    isArrayOf(value.reason, isString) &&
    isArrayOf(value.evidence, isString) &&
    isNumberRecord(value.estimated)
  );
}

function isNumberRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function isManifestTarget(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isString(value.profile) &&
    isString(value.runtime) &&
    isString(value.engine) &&
    (value.engineVersion === undefined || isString(value.engineVersion))
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
  return isValidClassMetadata(value) && isManifestSymbolCollections(value) && isManifestMetadata(value.metadata);
}

function isManifestMetadata(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return (
    (value.id === undefined || isString(value.id)) &&
    (value.title === undefined || isString(value.title)) &&
    (value.description === undefined || isString(value.description)) &&
    (value.deprecated === undefined || typeof value.deprecated === "boolean") &&
    (value.tags === undefined || isArrayOf(value.tags, isString))
  );
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
    isArrayOf(value.effects, isManifestEffect) &&
    (value.extensions === undefined || isArrayOf(value.extensions, isManifestExtension))
  );
}

function isManifestExtension(value: unknown): value is NonNullable<ManifestSymbol["extensions"]>[number] {
  if (!isRecord(value) || !isString(value.id) || !isString(value.version)) return false;
  const abi = value.abi;
  return typeof abi === "number" && Number.isSafeInteger(abi) && abi > 0;
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

function isPhysicalDigest(value: unknown): value is string {
  return typeof value === "string" && /^physical-[a-f0-9]{8}$/.test(value);
}
