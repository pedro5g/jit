import type { RuntimeConfigInput } from "../core/environment/config.js";
import type { JITEnvironment } from "../core/environment/environment.js";
import {
  configureRootEnvironment,
  type ExtendedNamespace,
  rootError,
  rootRegistry,
} from "../core/environment/facade.js";
import {
  createEnvironment,
  createEnvironmentFacade,
  extendEnvironment,
  getDefaultEnvironment,
  globalRegistry,
} from "../core/environment/index.js";
import { locales } from "../errors/locale.js";
import type { ExtensionDescriptor } from "../extensions/plugin.js";
import { plugin as pluginFactory } from "../extensions/plugin.js";
import type * as PublicFactories from "./index.js";

/** Replaces the default presentation environment. Physical optimization is compiler-owned. */
export function config(input: RuntimeConfigInput): JITEnvironment {
  return configureRootEnvironment(input);
}

/** Creates an isolated JIT facade that shares factory implementations. */
export function create(this: unknown, input: RuntimeConfigInput = {}): typeof PublicFactories {
  const environment = getDefaultEnvironment();
  const namespace = resolvePublicNamespace(this);
  return createEnvironmentFacade(
    namespace,
    createEnvironment(input, environment.extensions, environment.config)
  ) as typeof PublicFactories;
}

/** Typed metadata registry factory. */
export const registry = rootRegistry;

/** Default registry and built-in locales exposed by the root JIT facade. */
export {
  /** Metadata registry belonging to the current default environment. */
  globalRegistry,
  /** Built-in presentation locales. */
  locales,
};

/** Presentation helpers bound to the current default environment. */
export const error = rootError;

/** Creates an immutable environment with one extension installed. */
export function $extends<TPlugin extends ExtensionDescriptor>(
  this: unknown,
  extension: TPlugin
): ExtendedNamespace<typeof PublicFactories, TPlugin> {
  const namespace = resolvePublicNamespace(this);
  return createEnvironmentFacade(namespace, extendEnvironment(getDefaultEnvironment(), extension)) as ExtendedNamespace<
    typeof PublicFactories,
    TPlugin
  >;
}

/** Extension factory namespace; source emitters remain private to the compiler. */
export const plugin = pluginFactory;

function resolvePublicNamespace(receiver: unknown): typeof PublicFactories {
  if (receiver === null || typeof receiver !== "object") {
    throw new TypeError("JIT.create() and JIT.$extends() must be called as namespace members");
  }
  return receiver as typeof PublicFactories;
}
