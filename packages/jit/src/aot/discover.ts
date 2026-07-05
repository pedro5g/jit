import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SchemaInput } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";

/** `jit.config.*` shape — schema locations plus generation targets. */
export interface JitConfig {
  /**
   * Files or directories to load schemas from. Directories are scanned
   * recursively for the `*.jit.{ts,mts,js,mjs,cjs}` convention. Defaults
   * to scanning the current working directory.
   */
  readonly schemas?: readonly string[];
  /** Output directory; defaults to `node_modules/@jit/generated`. */
  readonly outDir?: string;
  /** Generated package name; defaults to `@jit/generated`. */
  readonly packageName?: string;
}

/** Identity helper so `jit.config.ts` gets full typing. */
export function defineConfig(config: JitConfig): JitConfig {
  return config;
}

const SCHEMA_FILE_PATTERN = /\.jit\.(ts|mts|cts|js|mjs|cjs)$/;
const CONFIG_BASENAMES = ["jit.config.ts", "jit.config.mts", "jit.config.js", "jit.config.mjs", "jit.config.cjs"];
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", "out"]);

/** Recursively finds `*.jit.*` schema files under a directory. */
export function discoverSchemaFiles(root: string): string[] {
  const found: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) walk(join(dir, entry.name));
        continue;
      }
      if (SCHEMA_FILE_PATTERN.test(entry.name)) found.push(join(dir, entry.name));
    }
  };

  walk(root);
  return found.sort();
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

/** True for values `AOT.generate` accepts (schemas and builders). */
export function isSchemaInput(candidate: unknown): candidate is SchemaInput {
  if (candidate === null || typeof candidate !== "object") return false;

  const value = candidate as { schema?: { type?: unknown }; type?: unknown; def?: unknown };

  if (value.schema && typeof value.schema === "object" && typeof value.schema.type === "string") return true;
  return typeof value.type === "string" && value.def !== undefined;
}

export interface CollectedSchemas {
  readonly schemas: Record<string, SchemaInput>;
  /** Export name → file it came from (collision reporting). */
  readonly sources: ReadonlyMap<string, string>;
}

/** Loads every file and collects exported schemas; name collisions throw. */
export async function collectSchemas(files: readonly string[]): Promise<CollectedSchemas> {
  const schemas: Record<string, SchemaInput> = {};
  const sources = new Map<string, string>();

  for (const file of files) {
    const loaded = await loadModule(file);

    for (const name of Object.keys(loaded)) {
      if (!isSchemaInput(loaded[name])) continue;

      const previous = sources.get(name);

      if (previous !== undefined) {
        throw new JITError(
          "INVALID_OPERATION",
          `schema export "${name}" is defined in both ${previous} and ${file} — export names must be unique across schema files`
        );
      }

      schemas[name] = loaded[name] as SchemaInput;
      sources.set(name, file);
    }
  }

  return { schemas, sources };
}
