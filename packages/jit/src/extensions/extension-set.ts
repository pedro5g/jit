import type { ExtensionDescriptor } from "./plugin.js";

/** Immutable set of semantic extensions contributing to compilation. */
export interface ExtensionSet {
  /** Installed immutable extension descriptors, sorted by stable identity. */
  readonly plugins: readonly ExtensionDescriptor[];
  /** Digest of plugin ids, versions, ABIs and semantic descriptors. */
  readonly digest: string;
  /** Returns a new set containing the plugin, or this set if already installed. */
  add(plugin: ExtensionDescriptor): ExtensionSet;
}

class ImmutableExtensionSet implements ExtensionSet {
  readonly plugins: readonly ExtensionDescriptor[];
  readonly digest: string;

  constructor(plugins: readonly ExtensionDescriptor[]) {
    const byId = new Map<string, ExtensionDescriptor>();
    for (const plugin of plugins) {
      assertDescriptor(plugin);
      const previous = byId.get(plugin.id);
      if (previous !== undefined && extensionSignature(previous) !== extensionSignature(plugin)) {
        throw new Error(`extension ${plugin.id} has conflicting descriptors`);
      }
      byId.set(plugin.id, freezeDescriptor(plugin));
    }
    assertCompositionNames([...byId.values()]);
    this.plugins = Object.freeze(
      [...byId.values()].sort((left, right) => compareText(extensionSignature(left), extensionSignature(right)))
    );
    this.digest = digest(this.plugins);
    Object.freeze(this);
  }

  add(plugin: ExtensionDescriptor): ExtensionSet {
    assertDescriptor(plugin);
    const sameIdentity = this.plugins.find((candidate) => candidate.id === plugin.id);
    if (sameIdentity !== undefined && extensionSignature(sameIdentity) !== extensionSignature(plugin))
      throw new Error(`extension ${plugin.id} is already installed with a different descriptor`);
    if (sameIdentity !== undefined) return this;
    return new ImmutableExtensionSet([...this.plugins, plugin]);
  }
}

/** Creates an empty immutable extension set. */
export function createExtensionSet(plugins: readonly ExtensionDescriptor[] = []): ExtensionSet {
  return new ImmutableExtensionSet(plugins);
}

function digest(plugins: readonly ExtensionDescriptor[]): string {
  let hash = 2166136261;
  const source = plugins.map(extensionSignature).join("|");
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `ext-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertIdentity(plugin: ExtensionDescriptor): void {
  if (
    typeof plugin.id !== "string" ||
    plugin.id.length === 0 ||
    typeof plugin.version !== "string" ||
    plugin.version.length === 0 ||
    !Number.isSafeInteger(plugin.abi) ||
    plugin.abi < 1
  ) {
    throw new TypeError("extensions require a non-empty id, version and positive integer ABI");
  }
  if (
    plugin.metadataDependencies !== undefined &&
    (!Array.isArray(plugin.metadataDependencies) ||
      plugin.metadataDependencies.some((key) => typeof key !== "string" || key.length === 0) ||
      new Set(plugin.metadataDependencies).size !== plugin.metadataDependencies.length)
  ) {
    throw new TypeError(`extension ${plugin.id} metadata dependencies must be unique non-empty strings`);
  }
}

function assertDescriptor(plugin: ExtensionDescriptor): void {
  assertIdentity(plugin);
  assertGrammar(plugin.grammar);

  if (plugin.kind === "composition") {
    assertCompositionDescriptor(plugin);
    return;
  }
  if (plugin.kind === "semantic") {
    assertSemanticDescriptor(plugin);
    return;
  }
  assertStrategyDescriptor(plugin);
}

function assertCompositionDescriptor(plugin: Extract<ExtensionDescriptor, { readonly kind: "composition" }>): void {
  if (plugin.name.length === 0 || plugin.target.length === 0 || typeof plugin.compose !== "function")
    throw new TypeError("composition extensions require a name, target, and compose function");
}

function assertSemanticDescriptor(plugin: Extract<ExtensionDescriptor, { readonly kind: "semantic" }>): void {
  if (plugin.name.length === 0 || typeof plugin.lower !== "function")
    throw new TypeError("semantic extensions require a name and lower function");
}

function assertStrategyDescriptor(plugin: Extract<ExtensionDescriptor, { readonly kind: "strategy" }>): void {
  if (
    plugin.family.length === 0 ||
    plugin.candidate.length === 0 ||
    !Array.isArray(plugin.evidence) ||
    plugin.evidence.some((id) => typeof id !== "string" || id.length === 0) ||
    (plugin.optimized && plugin.evidence.length === 0) ||
    typeof plugin.legality !== "function" ||
    typeof plugin.targetSupport !== "function" ||
    typeof plugin.estimate !== "function" ||
    typeof plugin.lower !== "function"
  )
    throw new TypeError("strategy extensions require a candidate, legality, target support, estimate, and IR lowering");
}

function assertGrammar(grammar: unknown): asserts grammar is ExtensionDescriptor["grammar"] {
  if (typeof grammar !== "object" || grammar === null || Array.isArray(grammar))
    throw new TypeError("extensions require an API grammar");

  const value = grammar as Record<string, unknown>;
  if (value.repeat !== undefined && value.repeat !== "allow" && value.repeat !== "forbid")
    throw new TypeError("extension grammar repeat must be allow or forbid");
  if (value.terminal !== undefined && typeof value.terminal !== "boolean")
    throw new TypeError("extension grammar terminal must be boolean");
  for (const key of ["requires", "provides", "conflicts", "fusion"] as const) {
    const entries = value[key];
    if (entries !== undefined && (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")))
      throw new TypeError(`extension grammar ${key} must contain only strings`);
  }
}

function extensionSignature(plugin: ExtensionDescriptor): string {
  const descriptor = {
    id: plugin.id,
    version: plugin.version,
    abi: plugin.abi,
    metadataDependencies: [...(plugin.metadataDependencies ?? [])].sort(),
    kind: plugin.kind,
    ...(plugin.kind === "composition" ? { name: plugin.name, target: plugin.target, grammar: plugin.grammar } : {}),
    ...(plugin.kind === "semantic" ? { name: plugin.name, grammar: plugin.grammar } : {}),
    ...(plugin.kind === "strategy"
      ? {
          family: plugin.family,
          candidate: plugin.candidate,
          optimized: plugin.optimized,
          portability: plugin.portability,
          evidence: [...plugin.evidence].sort(),
          grammar: plugin.grammar,
        }
      : {}),
  };
  return JSON.stringify(descriptor);
}

function freezeDescriptor(plugin: ExtensionDescriptor): ExtensionDescriptor {
  const grammar = plugin.grammar;
  return Object.freeze({
    ...plugin,
    ...(plugin.metadataDependencies === undefined
      ? {}
      : { metadataDependencies: Object.freeze([...plugin.metadataDependencies].sort()) }),
    grammar: Object.freeze({
      ...grammar,
      ...(grammar.requires === undefined ? {} : { requires: Object.freeze([...grammar.requires]) }),
      ...(grammar.provides === undefined ? {} : { provides: Object.freeze([...grammar.provides]) }),
      ...(grammar.conflicts === undefined ? {} : { conflicts: Object.freeze([...grammar.conflicts]) }),
      ...(grammar.fusion === undefined ? {} : { fusion: Object.freeze([...grammar.fusion]) }),
    }),
  }) as ExtensionDescriptor;
}

function assertCompositionNames(plugins: readonly ExtensionDescriptor[]): void {
  const names = new Map<string, string>();
  for (const plugin of plugins) {
    if (plugin.kind !== "composition") continue;
    const key = `${plugin.target}.${plugin.name}`;
    const previous = names.get(key);
    if (previous !== undefined && previous !== plugin.id)
      throw new Error(`composition extensions ${previous} and ${plugin.id} both provide ${key}`);
    names.set(key, plugin.id);
  }
}
