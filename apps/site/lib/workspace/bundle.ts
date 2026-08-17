/**
 * Several files, one program.
 *
 * The compiler worker evaluates a single function body with `JIT` handed in as
 * a binding: there is no module loader behind it, so a project of more than one
 * file has to arrive already linked. The obvious way to do that is to
 * concatenate the sources, and it is wrong the moment two files declare the
 * same name — which they do constantly, because `schema` is the name everything
 * uses.
 *
 * So each dependency keeps a scope of its own and hands back what it exports,
 * and an import becomes the destructuring it always was. That is what makes
 * `import { schema as User } from "./user-schemas"` mean the same thing here
 * as it does in the reader's repository.
 */

export interface BundleUnit {
  /** Workspace path, used to resolve what the imports point at. */
  path: string;
  /** JavaScript for that file, imports included. */
  code: string;
}

/** `import { a, b as c } from "./x"` and friends, in emitted JavaScript. */
const IMPORT = /^[ \t]*import\s+([^;]*?)\s*from\s*["']([^"']+)["'];?[ \t]*$/gm;
/** A side-effect import has nothing to bind. */
const BARE_IMPORT = /^[ \t]*import\s*["'][^"']+["'];?[ \t]*$/gm;

/** Names a unit declares at the top level, which is what it can export. */
export function topLevelNames(code: string): string[] {
  const names = new Set<string>();

  for (const match of code.matchAll(
    /(?:^|\n)\s*(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g
  )) {
    if (match[1]) names.add(match[1]);
  }

  return [...names];
}

/**
 * The specifier a unit path answers to, so `./user-schemas`, `./user-schemas.js`
 * and `../user-schemas.ts` all find the same unit.
 */
function matches(specifier: string, unitPath: string): boolean {
  const wanted = specifier.replace(/\.(?:js|ts)$/, "").replace(/^\.\//, "");
  const target = unitPath.replace(/\.ts$/, "");

  return target === wanted || target.endsWith(`/${wanted}`) || wanted.endsWith(target);
}

/** `{ a, b as c }` -> `{ a, b: c }`; `* as ns` -> the module object itself. */
function binding(clause: string, module: string): string | null {
  const namespace = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(clause.trim());
  if (namespace) return `const ${namespace[1]} = ${module};`;

  const named = /\{([^}]*)\}/.exec(clause);
  if (!named) return null;

  const parts = named[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const alias = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(part);
      return alias ? `${alias[1]}: ${alias[2]}` : part;
    });

  return parts.length > 0 ? `const { ${parts.join(", ")} } = ${module};` : null;
}

/** Strips `export` so a declaration is an ordinary one inside its scope. */
function withoutExports(code: string): string {
  return code
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "")
    .replace(/\bexport\s+(?=(?:const|let|var|function|class|type|interface|default)\b)/g, "")
    .replace(/^\s*export\s+type\s*\{[^}]*\};?\s*$/gm, "");
}

/**
 * Links the units into one program whose last unit is the entry.
 *
 * Every unit before the entry becomes a scope that returns its declarations;
 * the entry stays at the top level, because its names are what the compiler is
 * asked to generate from.
 */
export function bundleUnits(units: readonly BundleUnit[]): string {
  const moduleOf = new Map<string, string>();
  const chunks: string[] = [];

  units.forEach((unit, index) => {
    const isEntry = index === units.length - 1;
    const body = link(withoutExports(unit.code), moduleOf);

    if (isEntry) {
      chunks.push(body);
      return;
    }

    const name = `__module${index}`;
    moduleOf.set(unit.path, name);
    chunks.push(`const ${name} = (() => {\n${body}\nreturn { ${topLevelNames(unit.code).join(", ")} };\n})();`);
  });

  return chunks.join("\n\n");
}

/** Rewrites the imports of one unit against the modules already built. */
function link(code: string, moduleOf: ReadonlyMap<string, string>): string {
  return code.replace(BARE_IMPORT, "").replace(IMPORT, (_match, clause: string, specifier: string) => {
    // the package itself is a binding of the enclosing function, not a module
    if (!specifier.startsWith(".")) return "";

    for (const [path, name] of moduleOf) {
      if (matches(specifier, path)) return binding(clause, name) ?? "";
    }

    // a file that is not in the project: dropping it leaves a clear
    // "x is not defined" rather than a syntax error about an import
    return "";
  });
}
