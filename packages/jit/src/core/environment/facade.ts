import { locales } from "../../errors/locale.js";
import {
  type ErrorTreeNode,
  type FlattenedError,
  type FormatOptions,
  type FormattedIssue,
  flatten,
  format,
  issues,
  pretty,
  tree,
} from "../../errors/presentation.js";
import type { ExtensionDescriptor } from "../../extensions/plugin.js";
import { createRegistry, type Registry } from "../registry/index.js";
import type { RuntimeConfigInput } from "./config.js";
import {
  configureDefaultEnvironment,
  createEnvironment,
  extendEnvironment,
  getDefaultEnvironment,
  type JITEnvironment,
  reconfigureEnvironment,
  rememberExtensionResult,
  withEnvironment,
} from "./environment.js";

/** Error namespace bound to one environment's presentation locale. */
export interface EnvironmentErrorApi {
  /** Formats canonical issues with this environment's locale. */
  format(error: unknown, options?: Omit<FormatOptions, "locale">): readonly FormattedIssue[];
  /** Groups root and top-level field messages for forms and HTTP responses. */
  flatten(error: unknown, options?: Omit<FormatOptions, "locale">): FlattenedError;
  /** Builds a nested property tree of presented validation messages. */
  tree(error: unknown, options?: Omit<FormatOptions, "locale">): ErrorTreeNode;
  /** Produces a readable multiline representation for logs and CLIs. */
  pretty(error: unknown, options?: Omit<FormatOptions, "locale">): string;
  /** Returns structural issue descriptors without formatting their messages. */
  issues(error: unknown): ReturnType<typeof issues>;
}

/** Adds a composition operator to the namespace member it targets. */
export type ExtendedNamespace<TNamespace extends object, TPlugin extends ExtensionDescriptor> = TPlugin extends {
  readonly kind: "composition";
  readonly target: infer TTarget;
  readonly name: infer TName;
}
  ? TTarget extends keyof TNamespace
    ? TName extends string
      ? Omit<TNamespace, TTarget> & { readonly [K in TTarget]: WithComposition<TNamespace[TTarget], TName> }
      : TNamespace
    : TNamespace
  : TNamespace;

type WithComposition<TMember, TName extends string> = TMember extends (...args: infer TArgs) => infer TResult
  ? TMember & { readonly [K in TName]: (...args: TArgs) => TResult }
  : TMember;

/** Public methods added to the root namespace and to isolated facades. */
export interface EnvironmentApi<TNamespace extends object> {
  /** Replaces presentation settings for this facade and returns the resolved environment. */
  readonly config: (input: RuntimeConfigInput) => JITEnvironment;
  /** Creates an isolated facade that shares the same factory implementations. */
  readonly create: (input?: RuntimeConfigInput) => TNamespace;
  /** Metadata registry scoped to this facade's environment. */
  readonly globalRegistry: Registry<unknown>;
  /** Creates a typed descriptive metadata registry. */
  readonly registry: <TMetadata = unknown>(id?: string) => Registry<TMetadata>;
  /** Built-in error presentation locales. */
  readonly locales: typeof locales;
  /** Error presentation helpers bound to this facade's locale. */
  readonly error: EnvironmentErrorApi;
  /** Returns an isolated facade with an immutable extension installed. */
  readonly $extends: <TPlugin extends ExtensionDescriptor>(plugin: TPlugin) => ExtendedNamespace<TNamespace, TPlugin>;
}

type Callable = (...args: readonly unknown[]) => unknown;

const BUILTIN_EXTENSION_NAMES = new Set([
  "is",
  "parse",
  "safeParse",
  "parseAsync",
  "safeParseAsync",
  "issues",
  "optional",
  "nullable",
  "nullish",
  "default",
  "catch",
  "transform",
  "refine",
  "superRefine",
  "min",
  "max",
  "length",
  "nonEmpty",
  "meta",
  "register",
  "$extends",
]);

/**
 * Creates a shallow/prototype-sharing environment facade. Namespace objects
 * retain the original object as their prototype; only environment-bound
 * callables and nested facades are materialized. This avoids Proxy and keeps
 * builder instances and factory implementations allocation-conscious.
 */
export function createEnvironmentFacade<TNamespace extends object>(
  namespace: TNamespace,
  environment: JITEnvironment = getDefaultEnvironment()
): TNamespace & EnvironmentApi<TNamespace> {
  const wrapped = wrapValue(namespace, environment, new WeakMap<object, unknown>(), false) as Record<string, unknown>;
  const api = createEnvironmentApi(namespace, environment);

  for (const [key, value] of Object.entries(api)) {
    Object.defineProperty(wrapped, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: false,
    });
  }
  return Object.freeze(wrapped) as TNamespace & EnvironmentApi<TNamespace>;
}

/** Builds the non-enumerable-independent API for a namespace object. */
export function createEnvironmentApi<TNamespace extends object>(
  namespace: TNamespace,
  environment: JITEnvironment
): EnvironmentApi<TNamespace> {
  return {
    config: (input) => reconfigureEnvironment(environment, input),
    create: (input = {}) =>
      createEnvironmentFacade(namespace, createEnvironment(input, environment.extensions, environment.config)),
    globalRegistry: environment.globalRegistry,
    registry: <TMetadata = unknown>(id?: string) => createRegistry<TMetadata>(id),
    locales,
    error: createErrorApi(environment),
    $extends: <TPlugin extends ExtensionDescriptor>(plugin: TPlugin) =>
      createEnvironmentFacade(namespace, extendEnvironment(environment, plugin)) as ExtendedNamespace<
        TNamespace,
        TPlugin
      >,
  };
}

function createErrorApi(environment: JITEnvironment): EnvironmentErrorApi {
  const options = (): FormatOptions => ({ locale: environment.config.locale });
  return Object.freeze({
    format: (error: unknown, input: Omit<FormatOptions, "locale"> = {}) => format(error, { ...options(), ...input }),
    flatten: (error: unknown, input: Omit<FormatOptions, "locale"> = {}) => flatten(error, { ...options(), ...input }),
    tree: (error: unknown, input: Omit<FormatOptions, "locale"> = {}) => tree(error, { ...options(), ...input }),
    pretty: (error: unknown, input: Omit<FormatOptions, "locale"> = {}) => pretty(error, { ...options(), ...input }),
    issues,
  });
}

function wrapValue(
  value: unknown,
  environment: JITEnvironment,
  seen: WeakMap<object, unknown>,
  freezeObject = true,
  propertyName?: string
): unknown {
  if (typeof value === "function") return wrapFunction(value as Callable, environment, seen, propertyName);
  if (value === null || typeof value !== "object") return value;

  const object = value as object;
  const cached = seen.get(object);
  if (cached !== undefined) return cached;

  const result = Object.create(object) as Record<string, unknown>;
  seen.set(object, result);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const child = wrapValue((value as Record<string, unknown>)[key], environment, seen, true, key);
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: child,
      writable: false,
    });
  }
  return freezeObject ? Object.freeze(result) : result;
}

function wrapFunction(
  value: Callable,
  environment: JITEnvironment,
  seen: WeakMap<object, unknown>,
  propertyName?: string
): Callable {
  const cached = seen.get(value as object);
  if (cached !== undefined) return cached as Callable;

  const wrapped = function environmentFactory(this: unknown, ...args: readonly unknown[]): unknown {
    return withEnvironment(environment, () => Reflect.apply(value, this, args));
  } as Callable;
  seen.set(value as object, wrapped);
  Object.setPrototypeOf(wrapped, value);

  for (const key of Object.keys(value)) {
    Object.defineProperty(wrapped, key, {
      configurable: true,
      enumerable: true,
      value: wrapValue((value as unknown as Record<string, unknown>)[key], environment, seen),
      writable: false,
    });
  }

  for (const extension of environment.extensions.plugins) {
    if (extension.kind !== "composition" || extension.target !== propertyName) continue;
    if (
      BUILTIN_EXTENSION_NAMES.has(extension.name) ||
      Object.getOwnPropertyDescriptor(wrapped, extension.name) !== undefined
    ) {
      throw new Error(`extension ${extension.id} cannot shadow ${extension.target}.${extension.name}`);
    }
    const applyComposition = (...args: readonly unknown[]): unknown =>
      withEnvironment(environment, () =>
        rememberExtensionResult(extension.compose(Reflect.apply(value, undefined, args)), extension, environment)
      );
    Object.defineProperty(wrapped, extension.name, {
      configurable: false,
      enumerable: true,
      value: Object.freeze(applyComposition),
      writable: false,
    });
  }
  return Object.freeze(wrapped);
}

/** Configures the default facade without exposing compiler strategy switches. */
export function configureRootEnvironment(input: RuntimeConfigInput): JITEnvironment {
  return configureDefaultEnvironment(input);
}

/** Root error API follows the current default environment without a hot-path lookup in compiled functions. */
export const rootError: EnvironmentErrorApi = Object.freeze({
  format: (error: unknown, input: Omit<FormatOptions, "locale"> = {}) =>
    format(error, { ...input, locale: getDefaultEnvironment().config.locale }),
  flatten: (error: unknown, input: Omit<FormatOptions, "locale"> = {}) =>
    flatten(error, { ...input, locale: getDefaultEnvironment().config.locale }),
  tree: (error: unknown, input: Omit<FormatOptions, "locale"> = {}) =>
    tree(error, { ...input, locale: getDefaultEnvironment().config.locale }),
  pretty: (error: unknown, input: Omit<FormatOptions, "locale"> = {}) =>
    pretty(error, { ...input, locale: getDefaultEnvironment().config.locale }),
  issues,
});

/** Root namespace registry factory. */
export function rootRegistry<TMetadata = unknown>(id?: string): Registry<TMetadata> {
  return createRegistry<TMetadata>(id);
}
