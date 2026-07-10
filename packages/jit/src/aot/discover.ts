import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SchemaInput } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { getArtifact } from "../runtime/artifact-registry.js";

/** `jit.config.*` shape — declaration discovery plus generation targets. */
export interface JitConfig {
  /**
   * Files, directories, or glob patterns to load AOT declarations from. When
   * omitted, `jit generate` scans from the project root using `patterns`.
   */
  readonly schemas?: readonly string[];
  /** Output directory; defaults to `node_modules/@jit/generated`. */
  readonly outDir?: string;
  /** Generated package name; defaults to `@jit/generated`. */
  readonly packageName?: string;
  /**
   * Glob patterns used when scanning directories or when `schemas` is
   * omitted. The default matches files ending in `.jit.ts`.
   */
  readonly patterns?: readonly string[];
  /** Remove known generated files before writing; defaults to true. */
  readonly clean?: boolean;
  /**
   * Write a package.json exports map beside the JS/types; defaults to true.
   * Use false when generating into an app source folder instead of
   * `node_modules/@jit/generated`.
   */
  readonly emitPackageJson?: boolean;
}

/** Identity helper so `jit.config.ts` gets full typing. */
export function defineConfig<const TConfig extends JitConfig>(config: TConfig): TConfig {
  return config;
}

export const DEFAULT_SCHEMA_PATTERNS = ["**/*.jit.ts"] as const;

const CONFIG_BASENAMES = ["jit.config.ts", "jit.config.mts", "jit.config.js", "jit.config.mjs", "jit.config.cjs"];
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", "out"]);

/** Recursively finds AOT declaration files under a directory using glob patterns. */
export function discoverSchemaFiles(root: string, patterns: readonly string[] = DEFAULT_SCHEMA_PATTERNS): string[] {
  const found: string[] = [];
  const absoluteRoot = resolve(root);
  const matchers = patterns.map(globToRegExp);

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) walk(join(dir, entry.name));
        continue;
      }

      const absolute = join(dir, entry.name);
      const relative = absolute
        .slice(absoluteRoot.length + 1)
        .split("\\")
        .join("/");

      if (matchers.some((matcher) => matcher.test(relative))) found.push(absolute);
    }
  };

  walk(absoluteRoot);
  return found.sort();
}

/** Expands files, directories, and glob patterns relative to `baseDir`. */
export function expandSchemaEntries(
  entries: readonly string[] | undefined,
  baseDir: string,
  patterns: readonly string[] = DEFAULT_SCHEMA_PATTERNS
): string[] {
  if (!entries || entries.length === 0) return [];

  const files = new Set<string>();

  for (const entry of entries) {
    if (isGlobPattern(entry)) {
      for (const file of discoverSchemaFiles(baseDir, [entry])) files.add(file);
      continue;
    }

    const absolute = resolve(baseDir, entry);

    try {
      const stat = statSync(absolute);

      if (stat.isFile()) files.add(absolute);
      else if (stat.isDirectory()) {
        for (const file of discoverSchemaFiles(absolute, patterns)) files.add(file);
      }
    } catch {
      // Missing entries are ignored here; the generate command reports when
      // the final expanded set is empty.
    }
  }

  return [...files].sort();
}

/** Finds the `jit.config.*` file in a directory, if any. */
export function findConfigFile(cwd: string): string | undefined {
  for (const basename of CONFIG_BASENAMES) {
    const candidate = join(cwd, basename);

    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not there — try the next candidate
    }
  }

  return undefined;
}

/**
 * Imports a schema/config module. TypeScript files are tried natively
 * first (Node with type stripping, tsx, bun); when that fails, `jiti` is
 * used if installed. The error message says exactly how to unblock.
 */
export async function loadModule(file: string): Promise<Record<string, unknown>> {
  const absolute = resolve(file);
  const url = pathToFileURL(absolute).href;

  try {
    return (await import(url)) as Record<string, unknown>;
  } catch (error) {
    if (!/\.(ts|mts|cts)$/.test(absolute)) throw error;

    try {
      // Optional peer: resolved dynamically so the engine has no hard dep.
      const jitiId = "jiti";
      const jitiModule = (await import(jitiId)) as {
        createJiti: (base: string) => { import: (id: string) => Promise<unknown> };
      };
      const jiti = jitiModule.createJiti(pathToFileURL(process.cwd()).href);

      return (await jiti.import(url)) as Record<string, unknown>;
    } catch (fallbackError) {
      if ((fallbackError as { code?: string }).code === "ERR_MODULE_NOT_FOUND") {
        throw new JITError(
          "INVALID_OPERATION",
          `cannot load TypeScript schema file ${file}: this Node version does not strip types and jiti is not installed. Install jiti (\`pnpm add -D jiti\`) or run through tsx (\`tsx node_modules/.bin/jit generate\`).`
        );
      }
      throw fallbackError;
    }
  }
}

/** True for values that are schemas/builders/compile marker objects. */
export function isSchemaInput(candidate: unknown): candidate is SchemaInput {
  if (candidate === null || typeof candidate !== "object") return false;

  const value = candidate as { schema?: { type?: unknown }; type?: unknown; def?: unknown };

  if (value.schema && typeof value.schema === "object" && typeof value.schema.type === "string") return true;
  return typeof value.type === "string" && value.def !== undefined;
}

export interface CollectedSchemas {
  /** Export name -> object-style `JIT.compile(schema, { ... })` marker. */
  readonly schemas: Record<string, SchemaInput>;
  /** Export name -> standalone compiled function/object registered by JIT. */
  readonly functions: Record<string, unknown>;
  /** Export name -> file it came from (collision reporting and d.ts anchoring). */
  readonly sources: ReadonlyMap<string, string>;
}

/** Loads every file and collects AOT-buildable exports; name collisions throw. */
export async function collectSchemas(files: readonly string[]): Promise<CollectedSchemas> {
  const schemas: Record<string, SchemaInput> = {};
  const functions: Record<string, unknown> = {};
  const sources = new Map<string, string>();

  for (const file of files) {
    const loaded = await loadModule(file);

    for (const name of Object.keys(loaded)) {
      const value = loaded[name];
      const buildableSchema = isAotObjectInput(value);
      const buildableFunction = getArtifact(value) !== undefined;

      if (!buildableSchema && !buildableFunction) continue;

      const previous = sources.get(name);

      if (previous !== undefined) {
        throw new JITError(
          "INVALID_OPERATION",
          `AOT export "${name}" is defined in both ${previous} and ${file} — export names must be unique across declaration files`
        );
      }

      if (buildableSchema) schemas[name] = value;
      else functions[name] = value;
      sources.set(name, file);
    }
  }

  return { schemas, functions, sources };
}

function isAotObjectInput(candidate: unknown): candidate is SchemaInput {
  return isSchemaInput(candidate) && (candidate as { readonly __jitAot?: unknown }).__jitAot === "grouped";
}

function isGlobPattern(value: string): boolean {
  return /[*?[\]{}]/.test(value);
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";

  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*") {
      if (next === "*") {
        if (pattern[index + 2] === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index++;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`${source}$`);
}

function escapeRegExp(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}
