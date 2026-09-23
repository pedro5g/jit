import { createExtensionSet, type ExtensionSet } from "../../extensions/index.js";
import type { ExtensionDescriptor } from "../../extensions/plugin.js";
import { createRegistry, type Registry } from "../registry/index.js";
import { type RuntimeConfig, type RuntimeConfigInput, resolveRuntimeConfig } from "./config.js";

/** Immutable compiler context captured by a facade and by schema builders. */
export interface JITEnvironment {
  /** Stable process-local identity for this immutable environment. */
  readonly id: string;
  /** Presentation settings captured by compiled diagnostic operations. */
  readonly config: RuntimeConfig;
  /** Descriptive metadata registry scoped to this environment. */
  readonly globalRegistry: Registry<unknown>;
  /** Immutable extensions that participate in compilation identity. */
  readonly extensions: ExtensionSet;
}

let environmentOrdinal = 0;

/** Creates an isolated environment without copying the factory implementation. */
export function createEnvironment(
  input: RuntimeConfigInput = {},
  extensions: ExtensionSet = createExtensionSet(),
  base?: RuntimeConfig
): JITEnvironment {
  const id = `jit-${++environmentOrdinal}`;
  return Object.freeze({
    id,
    config: resolveRuntimeConfig(input, base),
    globalRegistry: createRegistry<unknown>(`${id}:global`),
    extensions,
  });
}

let defaultEnvironment = createEnvironment();

/** The mutable binding behind `JIT.globalRegistry`; replacing config swaps the default environment. */
export let globalRegistry: Registry<unknown> = defaultEnvironment.globalRegistry;

/** Returns the current default environment. */
export function getDefaultEnvironment(): JITEnvironment {
  return defaultEnvironment;
}

/** Replaces the default environment without mutating an existing one. */
export function configureDefaultEnvironment(input: RuntimeConfigInput): JITEnvironment {
  const previous = defaultEnvironment;
  defaultEnvironment = createEnvironment(input, defaultEnvironment.extensions, previous.config);
  globalRegistry = defaultEnvironment.globalRegistry;
  if (activeEnvironment === previous) activeEnvironment = defaultEnvironment;
  return defaultEnvironment;
}

/** Creates a child environment with a replaced presentation configuration. */
export function reconfigureEnvironment(environment: JITEnvironment, input: RuntimeConfigInput): JITEnvironment {
  return Object.freeze({
    id: `${environment.id}:config`,
    config: resolveRuntimeConfig(input, environment.config),
    globalRegistry: environment.globalRegistry,
    extensions: environment.extensions,
  });
}

/** Creates a child environment with one immutable extension added. */
export function extendEnvironment(environment: JITEnvironment, plugin: ExtensionDescriptor): JITEnvironment {
  return Object.freeze({
    id: `${environment.id}:extend:${plugin.id}@${plugin.version}`,
    config: environment.config,
    globalRegistry: environment.globalRegistry,
    extensions: environment.extensions.add(plugin),
  });
}

const schemaEnvironments = new WeakMap<object, JITEnvironment>();
let activeEnvironment = defaultEnvironment;

/** Runs synchronous schema construction under one environment. */
export function withEnvironment<T>(environment: JITEnvironment, callback: () => T): T {
  const previous = activeEnvironment;
  activeEnvironment = environment;
  try {
    return callback();
  } finally {
    activeEnvironment = previous;
  }
}

/** Environment active while a factory is building a schema. */
export function getActiveEnvironment(): JITEnvironment {
  return activeEnvironment;
}

/** Associates a schema with the environment that created it. */
export function rememberSchemaEnvironment(schema: object, environment: JITEnvironment): void {
  schemaEnvironments.set(schema, environment);
}

/**
 * Marks the schema returned by a composition extension without retaining the
 * plugin implementation in the schema or in generated artifacts.
 */
export function rememberExtensionResult<TValue>(
  value: TValue,
  plugin: ExtensionDescriptor,
  environment: JITEnvironment
): TValue {
  if (isSchemaObject(value)) return annotateExtension(value, plugin, environment) as TValue;
  if (typeof value !== "object" || value === null || !("schema" in value)) return value;

  const builder = value as { schema?: unknown };
  if (!isSchemaObject(builder.schema)) return value;
  builder.schema = annotateExtension(builder.schema, plugin, environment);
  return value;
}

/** Finds the environment captured by a schema or its derived builder. */
export function environmentForSchema(schema: object): JITEnvironment | undefined {
  const direct = schemaEnvironments.get(schema);
  if (direct !== undefined) return direct;
  return findNestedEnvironment(schema as { readonly def?: unknown }, new Set<object>());
}

function findNestedEnvironment(schema: { readonly def?: unknown }, seen: Set<object>): JITEnvironment | undefined {
  if (seen.has(schema)) return undefined;
  seen.add(schema);

  const definition = schema.def;
  if (typeof definition !== "object" || definition === null) return undefined;

  for (const value of Object.values(definition as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isSchemaObject(item)) {
          const environment = schemaEnvironments.get(item) ?? findNestedEnvironment(item, seen);
          if (environment !== undefined) return environment;
        }
      }
    } else if (isSchemaObject(value)) {
      const environment = schemaEnvironments.get(value) ?? findNestedEnvironment(value, seen);
      if (environment !== undefined) return environment;
    }
  }
  return undefined;
}

function isSchemaObject(value: unknown): value is {
  readonly type: unknown;
  readonly _type?: unknown;
  readonly def: unknown;
  readonly annotations?: unknown;
} {
  return typeof value === "object" && value !== null && "type" in value && "def" in value;
}

function annotateExtension(
  schema: { readonly type: unknown; readonly _type?: unknown; readonly def: unknown; readonly annotations?: unknown },
  plugin: ExtensionDescriptor,
  environment: JITEnvironment
): object {
  const annotations = isRecord(schema.annotations) ? schema.annotations : {};
  const previous = Array.isArray(annotations.extensions) ? annotations.extensions.filter(isExtensionIdentity) : [];
  const identity = Object.freeze({ id: plugin.id, version: plugin.version, abi: plugin.abi });
  const extensions = previous.some(
    (candidate) =>
      candidate.id === identity.id && candidate.version === identity.version && candidate.abi === identity.abi
  )
    ? previous
    : [...previous, identity].sort((left, right) => left.id.localeCompare(right.id));
  const marked = {
    type: schema.type,
    _type: null,
    def: schema.def,
    annotations: Object.freeze({ ...annotations, extensions: Object.freeze(extensions) }),
  };
  rememberSchemaEnvironment(marked, environment);
  return marked;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExtensionIdentity(
  value: unknown
): value is { readonly id: string; readonly version: string; readonly abi: number } {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.version === "string" &&
    typeof value.abi === "number" &&
    Number.isSafeInteger(value.abi) &&
    value.abi > 0
  );
}
