import { dirname, relative } from "node:path";

/** A stable identifier for a generated module. */
export type ModuleId = string;

/** A type reference in the portable artifact contract. */
export type TypeRef = string;

/** The declaration roles understood by the artifact manifest. */
export type ArtifactSymbolKind = "function" | "class" | "type" | "constant" | "schema" | "event";

/** A semantic capability exposed by a generated artifact. */
export interface ProtocolCapability {
  /** Protocol name understood by the artifact consumer. */
  readonly protocol: string;
  /** Version of the protocol contract. */
  readonly version: number;
  /** Input type reference accepted by the capability. */
  readonly input: TypeRef;
  /** Output type reference produced by the capability. */
  readonly output: TypeRef;
}

/** A protocol capability attached to one generated symbol. */
export interface ProtocolBinding extends ProtocolCapability {
  /** Symbol id implementing the capability. */
  readonly symbolId: string;
}

/** A dependency between generated modules. */
export interface ModuleDependency {
  /** Referenced module id. */
  readonly module: ModuleId;
  /** Symbol ids imported from the referenced module. */
  readonly symbols: readonly string[];
}

/** A declaration materialized in an artifact module. */
export interface ArtifactDeclaration {
  /** Source-level declaration name. */
  readonly name: string;
  /** Kind of declaration materialized in the module. */
  readonly kind: ArtifactSymbolKind;
  /** Stable symbol id assigned during lowering. */
  readonly symbolId: string;
}

/** One value or type exported by an artifact module. */
export interface ArtifactExport {
  /** Exported name in the generated module. */
  readonly name: string;
  /** Stable symbol id represented by the export. */
  readonly symbolId: string;
  /** Whether the export exists only in the type namespace. */
  readonly typeOnly: boolean;
}

/** A source-independent module in the final artifact program. */
export interface ArtifactModule {
  /** Stable module identifier. */
  readonly id: ModuleId;
  /** Relative output path for the module. */
  readonly path: string;
  /** Modules imported by this module. */
  readonly dependencies: readonly ModuleDependency[];
  /** Declarations materialized in this module. */
  readonly declarations: readonly ArtifactDeclaration[];
  /** Values and types exported by this module. */
  readonly exports: readonly ArtifactExport[];
}

/** A portable description of a generated public symbol. */
export interface ArtifactSymbol {
  /** Stable symbol identifier. */
  readonly id: string;
  /** Source or generated symbol name. */
  readonly name: string;
  /** Kind of generated symbol. */
  readonly kind: ArtifactSymbolKind;
  /** Module containing the symbol. */
  readonly module: ModuleId;
  /** Export name used by the generated module. */
  readonly exportName: string;
  /** Source declaration identity. */
  readonly declaration: string;
  /** Input type reference when the symbol accepts input. */
  readonly input?: TypeRef;
  /** Output type reference when the symbol produces output. */
  readonly output?: TypeRef;
  /** Stable validation error descriptors exposed by the symbol. */
  readonly errors?: readonly {
    /** Machine-readable error code. */
    readonly code: string;
    /** Type or phase associated with the error. */
    readonly type: string;
  }[];
  /** Runtime Class construction boundary, when this symbol is a class. */
  readonly construction?: "constructor" | "factory";
  /** Canonical factory names, when this symbol is a Runtime Class. */
  readonly factories?: Readonly<{
    readonly create: string | false;
    readonly hydrate: string | false;
  }>;
  /** Domain-event envelope metadata, when this symbol is an event class. */
  readonly event?: Readonly<{ readonly type: string; readonly version: number }>;
  /** Capabilities installed on the generated symbol. */
  readonly capabilities: readonly string[];
  /** Protocol names implemented by the generated symbol. */
  readonly protocols: readonly string[];
  /** Other symbol ids required by the generated symbol. */
  readonly dependencies: readonly string[];
  /** Observable effects declared by the generated symbol. */
  readonly effects: readonly {
    /** Effect category. */
    readonly kind: string;
    /** Optional effect target. */
    readonly target?: string;
  }[];
}

/** The source-independent program produced after semantic lowering. */
export interface ArtifactProgram {
  /** Generated modules in deterministic order. */
  readonly modules: readonly ArtifactModule[];
  /** Generated symbols in deterministic order. */
  readonly symbols: readonly ArtifactSymbol[];
  /** Protocol capabilities attached to generated symbols. */
  readonly protocols: readonly ProtocolBinding[];
}

/** Input accepted by the deterministic ArtifactProgram constructor. */
export interface ArtifactProgramInput {
  /** Modules to normalize and validate. */
  readonly modules: readonly ArtifactModule[];
  /** Symbols to normalize and validate. */
  readonly symbols: readonly ArtifactSymbol[];
  /** Optional protocol bindings to validate and retain. */
  readonly protocols?: readonly ProtocolBinding[];
}

/** Builds and validates one deterministic artifact program. */
export function createArtifactProgram(input: ArtifactProgramInput): ArtifactProgram {
  const modules = input.modules
    .map((module) => normalizeModule(module))
    .sort((left, right) => compareText(left.id, right.id));
  const moduleIds = new Set(modules.map((module) => module.id));
  validateModuleIds(modules, moduleIds);
  validateModuleDependencies(modules, moduleIds);

  const symbols = input.symbols
    .map((symbol) => normalizeSymbol(symbol))
    .sort((left, right) => compareText(left.id, right.id));
  const symbolIds = new Set<string>();
  validateSymbols(symbols, symbolIds, moduleIds);
  validateSymbolDependencies(symbols, symbolIds);
  validateExports(modules, symbolIds);

  const protocols = [...(input.protocols ?? [])].sort((left, right) => {
    const protocol = compareText(left.protocol, right.protocol);
    return protocol !== 0 ? protocol : compareText(left.symbolId, right.symbolId);
  });
  validateProtocols(protocols, symbolIds);
  validateDependencySymbols(modules, symbolIds);

  const program = {
    modules: Object.freeze(modules),
    symbols: Object.freeze(symbols),
    protocols: Object.freeze(protocols),
  } satisfies ArtifactProgram;

  detectModuleCycles(program.modules);
  return Object.freeze(program);
}

function validateModuleIds(modules: readonly ArtifactModule[], moduleIds: ReadonlySet<string>): void {
  if (moduleIds.size !== modules.length) throw new Error("ArtifactProgram contains duplicate module ids.");
}

function validateModuleDependencies(modules: readonly ArtifactModule[], moduleIds: ReadonlySet<string>): void {
  for (const module of modules) {
    for (const dependency of module.dependencies) {
      if (!moduleIds.has(dependency.module)) {
        throw new Error(
          `ArtifactProgram module ${JSON.stringify(module.id)} depends on missing module ${JSON.stringify(dependency.module)}.`
        );
      }
    }
  }
}

function validateSymbols(
  symbols: readonly ArtifactSymbol[],
  symbolIds: Set<string>,
  moduleIds: ReadonlySet<string>
): void {
  for (const symbol of symbols) {
    if (symbolIds.has(symbol.id))
      throw new Error(`ArtifactProgram contains duplicate symbol id ${JSON.stringify(symbol.id)}.`);
    if (!moduleIds.has(symbol.module))
      throw new Error(`ArtifactProgram symbol ${JSON.stringify(symbol.id)} references a missing module.`);
    symbolIds.add(symbol.id);
  }
}

function validateSymbolDependencies(symbols: readonly ArtifactSymbol[], symbolIds: ReadonlySet<string>): void {
  for (const symbol of symbols) {
    for (const dependency of symbol.dependencies) {
      if (!symbolIds.has(dependency)) {
        throw new Error(
          `ArtifactProgram symbol ${JSON.stringify(symbol.id)} depends on missing symbol ${JSON.stringify(dependency)}.`
        );
      }
    }
  }
}

function validateExports(modules: readonly ArtifactModule[], symbolIds: ReadonlySet<string>): void {
  for (const module of modules) {
    for (const exported of module.exports) {
      if (!symbolIds.has(exported.symbolId)) {
        throw new Error(`ArtifactProgram export ${JSON.stringify(exported.name)} references a missing symbol.`);
      }
    }
  }
}

function validateProtocols(protocols: readonly ProtocolBinding[], symbolIds: ReadonlySet<string>): void {
  for (const binding of protocols) {
    if (!symbolIds.has(binding.symbolId)) {
      throw new Error(`Protocol ${JSON.stringify(binding.protocol)} references a missing symbol.`);
    }
  }
}

function validateDependencySymbols(modules: readonly ArtifactModule[], symbolIds: ReadonlySet<string>): void {
  for (const module of modules) {
    for (const dependency of module.dependencies) {
      for (const symbol of dependency.symbols) {
        if (!symbolIds.has(symbol)) {
          throw new Error(
            `ArtifactProgram module ${JSON.stringify(module.id)} depends on missing symbol ${JSON.stringify(symbol)}.`
          );
        }
      }
    }
  }
}

/** Returns modules in deterministic dependency-first order. */
export function topologicalModuleOrder(program: ArtifactProgram): readonly ArtifactModule[] {
  const byId = new Map(program.modules.map((module) => [module.id, module] as const));
  const visiting = new Set<ModuleId>();
  const visited = new Set<ModuleId>();
  const ordered: ArtifactModule[] = [];

  const visit = (id: ModuleId): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`ArtifactProgram module cycle includes ${JSON.stringify(id)}.`);
    const module = byId.get(id);
    if (!module) throw new Error(`ArtifactProgram references missing module ${JSON.stringify(id)}.`);

    visiting.add(id);
    for (const dependency of [...module.dependencies].sort((left, right) => compareText(left.module, right.module))) {
      visit(dependency.module);
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(module);
  };

  for (const module of program.modules) visit(module.id);
  return Object.freeze(ordered);
}

/** Resolves a relative ESM import without inspecting emitted source. */
export function relativeModuleImport(fromPath: string, toPath: string): string {
  const value = relative(dirname(fromPath), toPath).replace(/\\/g, "/");
  return value.startsWith(".") ? value : `./${value}`;
}

function normalizeModule(module: ArtifactModule): ArtifactModule {
  return {
    id: module.id,
    path: module.path,
    dependencies: Object.freeze(
      [...module.dependencies]
        .map((dependency) => ({
          module: dependency.module,
          symbols: Object.freeze([...dependency.symbols].sort()),
        }))
        .sort((left, right) => compareText(left.module, right.module))
    ),
    declarations: Object.freeze(
      [...module.declarations].sort((left, right) => compareText(left.symbolId, right.symbolId))
    ),
    exports: Object.freeze([...module.exports].sort((left, right) => compareText(left.name, right.name))),
  };
}

function normalizeSymbol(symbol: ArtifactSymbol): ArtifactSymbol {
  return {
    ...symbol,
    capabilities: Object.freeze([...symbol.capabilities].sort()),
    protocols: Object.freeze([...symbol.protocols].sort()),
    dependencies: Object.freeze([...symbol.dependencies].sort()),
    effects: Object.freeze(
      [...symbol.effects].sort((left, right) =>
        compareText(`${left.kind}:${left.target ?? ""}`, `${right.kind}:${right.target ?? ""}`)
      )
    ),
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function detectModuleCycles(modules: readonly ArtifactModule[]): void {
  const byId = new Map(modules.map((module) => [module.id, module] as const));
  const visiting = new Set<ModuleId>();
  const visited = new Set<ModuleId>();

  const visit = (id: ModuleId): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`ArtifactProgram module cycle includes ${JSON.stringify(id)}.`);
    const module = byId.get(id);
    if (!module) return;

    visiting.add(id);
    for (const dependency of module.dependencies) visit(dependency.module);
    visiting.delete(id);
    visited.add(id);
  };

  for (const module of modules) visit(module.id);
}
