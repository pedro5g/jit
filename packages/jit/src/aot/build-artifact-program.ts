import { resolveLazySchema, schemaChildren } from "../compiler/schema-recursion.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { type CompiledArtifact, getArtifact } from "../runtime/artifact-registry.js";
import { declarationDigest, stableJson } from "./artifact-manifest.js";
import type {
  ArtifactDeclaration,
  ArtifactExport,
  ArtifactModule,
  ArtifactProgram,
  ArtifactSymbol,
  ArtifactSymbolKind,
  ModuleDependency,
  ProtocolBinding,
  ProtocolCapability,
} from "./artifact-program.js";
import { createArtifactProgram } from "./artifact-program.js";

/** The public declarations assigned to one planned generated module. */
export interface ArtifactProgramModuleInput {
  readonly name: string;
  readonly path: string;
  readonly exports: readonly string[];
  readonly types: readonly string[];
  readonly artifacts: Readonly<Record<string, unknown>>;
  readonly groups: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly schemas: Readonly<Record<string, unknown>>;
}

/** Input used to lower generated module plans into an ArtifactProgram. */
export interface BuildArtifactProgramOptions {
  readonly modules: readonly ArtifactProgramModuleInput[];
  readonly includeBarrel: boolean;
  readonly barrelPath?: string;
  readonly protocols?: Readonly<Record<string, readonly ProtocolCapability[]>>;
}

/** Lowers already-planned public declarations into the source-independent program. */
export function buildArtifactProgram(options: BuildArtifactProgramOptions): ArtifactProgram {
  const symbols: ArtifactSymbol[] = [];
  const bindings: ProtocolBinding[] = [];
  const schemaOwners = createSchemaOwners(options.modules);
  const modules = options.modules.map((input) =>
    buildModule(input, schemaOwners, symbols, bindings, options.protocols)
  );
  if (options.includeBarrel) modules.push(createBarrelModule(options, symbols));

  const protocolNames = new Map<string, string[]>();
  for (const binding of bindings) {
    const names = protocolNames.get(binding.symbolId) ?? [];
    const protocolName = binding.protocol.endsWith(`/v${binding.version}`)
      ? binding.protocol
      : `${binding.protocol}/v${binding.version}`;
    names.push(protocolName);
    protocolNames.set(binding.symbolId, names);
  }
  const finalizedSymbols = symbols.map((symbol) => ({
    ...symbol,
    protocols: Object.freeze([...(protocolNames.get(symbol.id) ?? [])].sort(compareText)),
  }));
  return createArtifactProgram({ modules, symbols: finalizedSymbols, protocols: bindings });
}

function createSchemaOwners(inputs: readonly ArtifactProgramModuleInput[]): WeakMap<ATS.AnyTypeSchema, string> {
  const owners = new WeakMap<ATS.AnyTypeSchema, string>();
  for (const input of inputs) {
    registerTypeOwners(input, owners);
    registerClassOwners(input, owners);
  }
  return owners;
}

function registerTypeOwners(input: ArtifactProgramModuleInput, owners: WeakMap<ATS.AnyTypeSchema, string>): void {
  for (const name of input.types) {
    const schema = input.schemas[name];
    if (schema !== undefined) owners.set(unwrapSchema(schema as SchemaInput), symbolIdFor(input, name, true));
  }
}

function registerClassOwners(input: ArtifactProgramModuleInput, owners: WeakMap<ATS.AnyTypeSchema, string>): void {
  for (const [name, value] of Object.entries(input.artifacts)) {
    const artifact = getArtifact(value);
    if (artifact?.kind !== "class") continue;
    const symbolId = symbolIdFor(input, name, false);
    owners.set(artifact.schema, symbolId);
    if (artifact.declaredSchema !== undefined) owners.set(artifact.declaredSchema, symbolId);
  }
}

function buildModule(
  input: ArtifactProgramModuleInput,
  schemaOwners: WeakMap<ATS.AnyTypeSchema, string>,
  symbols: ArtifactSymbol[],
  bindings: ProtocolBinding[],
  protocols: Readonly<Record<string, readonly ProtocolCapability[]>> | undefined
): ArtifactModule {
  const declarations: ArtifactDeclaration[] = [];
  const exports: ArtifactExport[] = [];
  for (const name of input.exports) {
    const symbolId = symbolIdFor(input, name, false);
    const symbol = createSymbol(input, name, symbolId, false, schemaOwners);
    symbols.push(symbol);
    declarations.push({ name, kind: symbol.kind, symbolId });
    exports.push({ name, symbolId, typeOnly: false });
    addProtocolBindings(bindings, input.name, name, symbolId, protocols);
  }
  for (const name of input.types) {
    const symbolId = symbolIdFor(input, name, true);
    const symbol = createSymbol(input, name, symbolId, true, schemaOwners);
    symbols.push(symbol);
    declarations.push({ name, kind: "type", symbolId });
    exports.push({ name, symbolId, typeOnly: true });
  }
  return {
    id: input.name,
    path: input.path,
    dependencies: moduleDependencies(input.name, symbols),
    declarations,
    exports,
  };
}

function createBarrelModule(options: BuildArtifactProgramOptions, symbols: readonly ArtifactSymbol[]): ArtifactModule {
  return {
    id: "index",
    path: options.barrelPath ?? "index.ts",
    dependencies: options.modules.map((module) => ({
      module: module.name,
      symbols: symbols.filter((symbol) => symbol.module === module.name).map((symbol) => symbol.id),
    })),
    declarations: [],
    exports: symbols.map((symbol) => ({
      name: symbol.exportName,
      symbolId: symbol.id,
      typeOnly: symbol.kind === "type",
    })),
  };
}

function symbolIdFor(input: ArtifactProgramModuleInput, name: string, typeOnly: boolean): string {
  const valueExists = input.artifacts[name] !== undefined || input.groups[name] !== undefined;
  return `${input.name}:${name}${typeOnly && valueExists ? ":type" : ""}`;
}

/** Computes the revision digest for the declarations that produced an artifact. */
export function declarationRevisionDigest(options: BuildArtifactProgramOptions): string {
  const declarations = options.modules.map((module) => ({
    name: module.name,
    artifacts: Object.fromEntries(
      Object.entries(module.artifacts)
        .sort(([left], [right]) => compareText(left, right))
        .map(([name, value]) => [name, declarationFingerprint(value)])
    ),
    groups: Object.fromEntries(
      Object.entries(module.groups)
        .sort(([left], [right]) => compareText(left, right))
        .map(([name, group]) => [
          name,
          Object.fromEntries(
            Object.entries(group)
              .sort(([left], [right]) => compareText(left, right))
              .map(([member, value]) => [member, declarationFingerprint(value)])
          ),
        ])
    ),
    schemas: Object.fromEntries(
      Object.entries(module.schemas)
        .sort(([left], [right]) => compareText(left, right))
        .map(([name, schema]) => [name, declarationFingerprint(schema)])
    ),
  }));
  return declarationDigest({ declarations });
}

function createSymbol(
  input: ArtifactProgramModuleInput,
  name: string,
  symbolId: string,
  typeOnly: boolean,
  schemaOwners: WeakMap<ATS.AnyTypeSchema, string>
): ArtifactSymbol {
  if (typeOnly) {
    const schema = input.schemas[name];
    return {
      id: symbolId,
      name,
      kind: "type",
      module: input.name,
      exportName: name,
      declaration: name,
      output: name,
      capabilities: ["type"],
      protocols: [],
      dependencies: schema === undefined ? [] : schemaDependencies(input.name, schema as SchemaInput, schemaOwners),
      effects: [],
    };
  }

  const value = input.artifacts[name] ?? input.groups[name];
  const artifact = getArtifact(value);
  const group = input.groups[name];
  const kind = group ? "constant" : artifactKind(artifact);
  const capabilities = group ? Object.keys(group).sort() : artifactCapabilities(artifact);
  const errors = artifactErrorContracts(artifact);
  const inputType = artifactInput(artifact);
  const outputType = artifactOutput(name, artifact);
  const classMetadata = artifact?.kind === "class" ? artifactClassMetadata(artifact) : undefined;

  return {
    id: symbolId,
    name,
    kind,
    module: input.name,
    exportName: name,
    declaration: name,
    ...(inputType === undefined ? {} : { input: inputType }),
    ...(outputType === undefined ? {} : { output: outputType }),
    ...(classMetadata ?? {}),
    ...(errors.length > 0 ? { errors } : {}),
    capabilities,
    protocols: [],
    dependencies: schemaDependenciesForSymbol(input, name, artifact, schemaOwners),
    effects: artifactEffects(artifact),
  };
}

function artifactClassMetadata(
  artifact: Extract<CompiledArtifact, { readonly kind: "class" }>
): Pick<ArtifactSymbol, "construction" | "factories" | "event"> {
  return {
    construction: artifact.construction,
    factories: artifact.factories,
    ...(artifact.domainEvent === undefined ? {} : { event: artifact.domainEvent }),
  };
}

function schemaDependenciesForSymbol(
  input: ArtifactProgramModuleInput,
  name: string,
  artifact: CompiledArtifact | undefined,
  owners: WeakMap<ATS.AnyTypeSchema, string>
): readonly string[] {
  const dependencies = new Set(schemaDependencies(input.name, artifactSchema(artifact), owners));
  const group = input.groups[name];
  if (group !== undefined) {
    for (const member of Object.values(group)) {
      const memberArtifact = getArtifact(member);
      for (const dependency of schemaDependencies(input.name, artifactSchema(memberArtifact), owners))
        dependencies.add(dependency);
    }
  }
  return [...dependencies].sort(compareText);
}

function artifactSchema(artifact: CompiledArtifact | undefined): SchemaInput | undefined {
  if (artifact === undefined || !("schema" in artifact)) return undefined;
  return artifact.schema as SchemaInput;
}

function schemaDependencies(
  _module: string,
  input: SchemaInput | undefined,
  owners: WeakMap<ATS.AnyTypeSchema, string>
): readonly string[] {
  if (input === undefined) return [];
  const dependencies = new Set<string>();
  const seen = new WeakSet<ATS.AnyTypeSchema>();
  const walk = (schema: ATS.AnyTypeSchema, root = false): void => {
    const current = resolveLazySchema(schema);
    if (seen.has(current)) return;
    seen.add(current);
    const owner = owners.get(current);
    if (!root && owner !== undefined) dependencies.add(owner);
    for (const child of schemaChildren(current)) walk(child);
  };
  walk(unwrapSchema(input), true);
  return [...dependencies].sort(compareText);
}

function moduleDependencies(module: string, symbols: readonly ArtifactSymbol[]): readonly ModuleDependency[] {
  const byModule = new Map<string, Set<string>>();
  for (const symbol of symbols.filter((candidate) => candidate.module === module)) {
    for (const dependency of symbol.dependencies) {
      const separator = dependency.indexOf(":");
      if (separator < 0) continue;
      const targetModule = dependency.slice(0, separator);
      if (targetModule === module) continue;
      const names = byModule.get(targetModule) ?? new Set<string>();
      names.add(dependency);
      byModule.set(targetModule, names);
    }
  }
  return [...byModule.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([targetModule, names]) => ({ module: targetModule, symbols: [...names].sort(compareText) }));
}

function addProtocolBindings(
  bindings: ProtocolBinding[],
  module: string,
  name: string,
  symbolId: string,
  protocols: Readonly<Record<string, readonly ProtocolCapability[]>> | undefined
): void {
  for (const capability of protocols?.[name] ?? protocols?.[`${module}:${name}`] ?? []) {
    bindings.push({ ...capability, symbolId });
  }
}

function artifactKind(artifact: CompiledArtifact | undefined): ArtifactSymbolKind {
  if (!artifact) return "function";
  if (artifact.kind === "class") return artifact.domainEvent ? "event" : "class";
  if (artifact.kind === "operation" && artifact.op === "jsonSchema") return "constant";
  return "function";
}

function artifactCapabilities(artifact: CompiledArtifact | undefined): readonly string[] {
  if (!artifact) return [];
  if ("op" in artifact) return [artifact.op];
  if (artifact.kind === "execution")
    return artifact.plan.stages.map((stage) =>
      stage.kind === "validate" || stage.kind === "operation" ? stage.operation : stage.kind
    );
  if (artifact.kind === "class") return [...artifact.capabilities].sort();
  return [artifact.kind];
}

function artifactInput(artifact: CompiledArtifact | undefined): string | undefined {
  if (!artifact) return undefined;
  if (artifact.kind === "validator") return "unknown";
  if (artifact.kind === "class") return artifact.construction === "factory" ? "Input" : "constructor-input";
  return "unknown";
}

function artifactOutput(name: string, artifact: CompiledArtifact | undefined): string | undefined {
  if (!artifact) return undefined;
  if (artifact.kind === "validator" && (artifact.op === "parse" || artifact.op === "parseAsync")) return name;
  if (artifact.kind === "class") return name;
  return undefined;
}

function artifactErrorContracts(
  artifact: CompiledArtifact | undefined
): readonly { readonly code: string; readonly type: string }[] {
  if (artifact?.kind === "validator" && artifact.op !== "is")
    return [{ code: "VALIDATION_FAILED", type: "ValidationError" }];
  if (artifact?.kind === "class" && artifact.policy?.result === "throw")
    return [{ code: "VALIDATION_FAILED", type: "ValidationError" }];
  return [];
}

function artifactEffects(
  artifact: CompiledArtifact | undefined
): readonly { readonly kind: string; readonly target?: string }[] {
  if (!artifact) return [];
  if (artifact.kind === "validator") return [{ kind: "validate" }];
  if (artifact.kind === "operation" && artifact.op === "update") return [{ kind: "write" }];
  if (artifact.kind === "class" && artifact.aggregate) return [{ kind: "emit-event" }];
  return [];
}

function declarationFingerprint(value: unknown): unknown {
  const artifact = getArtifact(value);
  if (!artifact) return value;
  const descriptor: Record<string, unknown> = { kind: artifact.kind };
  if ("op" in artifact) descriptor.op = artifact.op;
  if ("schema" in artifact) descriptor.schema = artifact.schema;
  if (artifact.kind === "class") {
    descriptor.capabilities = artifact.capabilities;
    descriptor.construction = artifact.construction;
    descriptor.factories = artifact.factories;
    descriptor.domainEvent = artifact.domainEvent;
  }
  return stableJson(descriptor);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
