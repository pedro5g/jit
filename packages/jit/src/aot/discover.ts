import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SchemaInput } from "../core/builder/index.js";
import { JITError } from "../errors/index.js";
import { classifyDeclaration, isSchemaInput, readArtifactGroup } from "./classify.js";
import type { AotOutputFormat } from "./generate.js";

export { classifyDeclarations, isSchemaInput } from "./classify.js";

/** `jit.config.*` shape — declaration discovery plus one generation target. */
export interface JitConfig {
  /**
   * Declaration files, directories, or glob patterns loaded by the AOT build.
   * When omitted, discovery starts at the project root using `patterns`.
   */
  readonly entries?: readonly string[];
  /**
   * Glob patterns used for directory and root discovery.
   * By default, matches TypeScript files whose basename ends in `.jit`.
   */
  readonly patterns?: readonly string[];
  /** Generated executable source. */
  readonly output?: {
    /**
     * Generated directory, relative to this config file. Previous JIT output
     * there is always replaced.
     * @default "generated"
     */
    readonly directory?: string;
    /**
     * `"ts"` emits typed source the application's own build resolves;
     * `"js"` emits ready-to-run ESM.
     * @default "ts"
     */
    readonly format?: AotOutputFormat;
    /**
     * Emit one module per declaration file, named after it
     * (`user.jit.ts` -> `user.ts`), plus an `index` re-exporting all of them.
     * By default everything lands in a single `index`.
     * @default false
     */
    readonly perFile?: boolean;
  };
}

/** Identity helper so `jit.config.ts` gets full typing. */
export function defineConfig<const TConfig extends JitConfig>(config: TConfig): TConfig {
  return config;
}

export const DEFAULT_SCHEMA_PATTERNS = ["**/*.jit.ts", "**/*.jit.js"] as const;

const CONFIG_BASENAMES = ["jit.config.ts", "jit.config.js", "jit.config.mjs"];
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", "out"]);

let moduleGeneration = 0;

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
  // The ESM cache is keyed by URL, so `--watch` and repeated generations
  // would keep reading the first version of a file the developer edited.
  const fresh = `${url}?jit=${++moduleGeneration}`;

  try {
    return (await import(fresh)) as Record<string, unknown>;
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

export interface CollectedDeclarations {
  /** Binding name -> registered compiled artifact. */
  readonly artifacts: Record<string, unknown>;
  /** Binding name -> object literal whose members are compiled artifacts. */
  readonly groups: Record<string, Record<string, unknown>>;
  /** Exported type alias -> schema referenced by `JIT.Typeof<typeof binding>`. */
  readonly schemas: Record<string, SchemaInput>;
  /** Binding name -> file it was declared in. */
  readonly sources: ReadonlyMap<string, string>;
  /** Runtime bindings the declaration file exports itself. */
  readonly exported: ReadonlySet<string>;
}

/**
 * Reads every declaration file and classifies its explicit public surface.
 * Exported artifacts and artifact objects become runtime output. Exported
 * `JIT.Typeof<typeof schema>` aliases become generated types. Private bindings
 * remain available only while resolving those declarations and never become
 * output merely because they exist in a `.jit` file.
 */
export async function collectDeclarations(files: readonly string[]): Promise<CollectedDeclarations> {
  const artifacts: Record<string, unknown> = {};
  const groups: Record<string, Record<string, unknown>> = {};
  const schemas: Record<string, SchemaInput> = {};
  const sources = new Map<string, string>();
  const exported = new Set<string>();

  for (const file of files) {
    const declaration = await loadDeclarationFile(file);

    for (const name of Object.keys(declaration.module)) {
      if (!declaration.exported.has(name)) continue;
      const value = declaration.module[name];
      const kind = classifyDeclaration(value);

      if (kind === undefined || kind === "schema") continue;

      const previous = sources.get(name);

      if (previous !== undefined) {
        throw new JITError(
          "INVALID_OPERATION",
          `AOT declaration "${name}" is defined in both ${previous} and ${file} — declaration names must be unique across files`
        );
      }

      if (kind === "group") {
        groups[name] = readArtifactGroup(value) as Record<string, unknown>;
      } else {
        artifacts[name] = value;
      }

      sources.set(name, file);
      exported.add(name);
    }

    for (const type of declaration.types) {
      const schema = declaration.module[type.schemaBinding];

      if (!isSchemaInput(schema)) {
        throw new JITError(
          "INVALID_OPERATION",
          `AOT type ${JSON.stringify(type.name)} references ${JSON.stringify(type.schemaBinding)}, which is not a JIT schema`
        );
      }
      const previous = sources.get(type.name);

      if (previous !== undefined && previous !== file) {
        throw new JITError(
          "INVALID_OPERATION",
          `AOT declaration "${type.name}" is defined in both ${previous} and ${file} — declaration names must be unique across files`
        );
      }
      schemas[type.name] = schema;
      sources.set(type.name, file);
    }
  }

  return { artifacts, groups, schemas, sources, exported };
}

interface LoadedDeclaration {
  readonly module: Record<string, unknown>;
  readonly exported: ReadonlySet<string>;
  readonly types: readonly ExportedTypeAlias[];
}

interface ExportedTypeAlias {
  readonly name: string;
  readonly schemaBinding: string;
}

/**
 * Loads a declaration file with private top-level bindings visible only so an
 * explicit exported type alias can resolve its `typeof` operand. The sibling
 * is always removed again; private values are filtered before classification.
 */
async function loadDeclarationFile(file: string): Promise<LoadedDeclaration> {
  const source = readFileSync(file, "utf8");
  const bindings = readTopLevelBindings(source);
  const exported = readRuntimeExports(source);
  const types = readExportedTypeAliases(source);
  const hidden = bindings.filter((binding) => !exported.has(binding));

  if (hidden.length === 0) return { module: await loadModule(file), exported, types };

  const extension = extname(file);
  const sibling = join(
    dirname(file),
    `${basename(file, extension)}.${process.pid.toString(36)}${Date.now().toString(36)}.jit-scan${extension}`
  );

  try {
    writeFileSync(sibling, `${source}\nexport { ${hidden.join(", ")} };\n`);
    return { module: await loadModule(sibling), exported, types };
  } catch {
    return { module: await loadModule(file), exported, types };
  } finally {
    rmSync(sibling, { force: true });
  }
}

/** Top-level `const`/`let`/`var` binding names. */
function readTopLevelBindings(source: string): readonly string[] {
  const bindings: string[] = [];
  const seen = new Set<string>();

  for (const match of source.matchAll(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm)) {
    const name = match[1];

    if (seen.has(name)) continue;
    seen.add(name);
    bindings.push(name);
  }

  return bindings;
}

/** Runtime names explicitly exported by the declaration module. */
function readRuntimeExports(source: string): ReadonlySet<string> {
  const exported = new Set<string>();

  for (const match of source.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm)) {
    exported.add(match[1]);
  }
  for (const block of readExportBlocks(source)) {
    if (block.typesOnly) continue;
    for (const entry of block.entries) {
      if (!entry.typesOnly) exported.add(entry.exported);
    }
  }

  return exported;
}

/** Explicit `JIT.Typeof<typeof schema>` aliases, including type-only export lists. */
function readExportedTypeAliases(source: string): readonly ExportedTypeAlias[] {
  const aliases = new Map<string, { readonly schemaBinding: string; readonly exported: boolean }>();

  for (const match of source.matchAll(
    /^(export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?JIT\.Typeof\s*<\s*typeof\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*>\s*;?/gm
  )) {
    aliases.set(match[2], { schemaBinding: match[3], exported: match[1] !== undefined });
  }

  const result = new Map<string, ExportedTypeAlias>();

  for (const [name, alias] of aliases) {
    if (alias.exported) result.set(name, { name, schemaBinding: alias.schemaBinding });
  }
  for (const block of readExportBlocks(source)) {
    for (const entry of block.entries) {
      if (!block.typesOnly && !entry.typesOnly) continue;
      const alias = aliases.get(entry.local);

      if (alias) result.set(entry.exported, { name: entry.exported, schemaBinding: alias.schemaBinding });
    }
  }

  return [...result.values()];
}

interface ExportBlock {
  readonly typesOnly: boolean;
  readonly entries: readonly { readonly local: string; readonly exported: string; readonly typesOnly: boolean }[];
}

function readExportBlocks(source: string): readonly ExportBlock[] {
  const blocks: ExportBlock[] = [];

  for (const match of source.matchAll(/^export\s+(type\s+)?\{([^}]*)\}\s*;?/gm)) {
    const typesOnly = match[1] !== undefined;
    const entries = match[2]
      .split(",")
      .map((raw) => {
        const trimmed = raw.trim();
        const entryTypesOnly = trimmed.startsWith("type ");
        const value = entryTypesOnly ? trimmed.slice(5).trim() : trimmed;
        const [local, exported = local] = value.split(/\s+as\s+/).map((part) => part.trim());

        return { local, exported, typesOnly: entryTypesOnly };
      })
      .filter((entry) => entry.local.length > 0 && entry.exported.length > 0);

    blocks.push({ typesOnly, entries });
  }

  return blocks;
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
