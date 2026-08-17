/**
 * The library's real public surface, at all three levels, written out for the
 * ghost to hold in front of it.
 *
 * The assistant used to carry only the 74 top-level `JIT.*` names, taken from a
 * markdown table. That is a third of the surface, and it is the wrong third:
 * almost nothing a reader writes is a bare `JIT.x`. Real code says
 * `JIT.validate.safeParse(User)` and `JIT.string().min(3).email()`, and both of
 * those levels were invisible — to the prompt, which could not show them, and
 * to the audit, which explicitly refused to check them. `JIT.compare.deepEqual`
 * and `.notEmpty()` are inventions that passed every gate we had.
 *
 * Three sources, each authoritative for one thing:
 *   the runtime      — which names exist (reflection cannot be out of date);
 *   builder/types.ts — which chain methods each schema kind actually allows,
 *                      since the shared prototype exposes all of them on all
 *                      of them and only the types gate it;
 *   the docs table   — where each member is documented, and its one-line purpose.
 *
 * Where the docs and the runtime disagree, the runtime wins and the
 * disagreement is reported: that is a documentation bug, and the reader who
 * finds it via a wrong answer pays more for it than we do here.
 *
 * Run with tsx from the repo root:
 *   npx tsx --conditions @jit/source apps/site/scripts/build-api-surface.ts
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { JIT } from "@jit-compiler/jit/runtime";

const siteDir = path.resolve(import.meta.dirname, "..");
const packageSrc = path.resolve(siteDir, "../../packages/jit/src");
const outFile = path.join(siteDir, "public/assistant/api-surface.json");

/** Real exports that reflection cannot see, because they are types. */
const TYPE_EXPORTS = ["Typeof", "Strict"];

// ---------------------------------------------------------------- level 1 & 2

export interface NamespaceMember {
  name: string;
  /** `JIT.validate.safeParse` — the form a reader actually writes. */
  path: string;
}

/**
 * Members reached through a namespace object. `JIT.validate` is not callable;
 * `JIT.validate.safeParse` is, and it is the name that has to be right.
 */
function namespaceMembers(): Record<string, string[]> {
  const namespaces: Record<string, string[]> = {};

  for (const name of Object.keys(JIT)) {
    const value = (JIT as Record<string, unknown>)[name];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;

    const members = Object.keys(value).filter((member) => !member.startsWith("__"));
    if (members.length > 0) namespaces[name] = members.sort();
  }

  return namespaces;
}

// -------------------------------------------------------------------- level 3

/**
 * Method names declared directly in one interface body.
 *
 * Overloads repeat a name and are collapsed; JSDoc, generics and multi-line
 * signatures are skipped by only accepting a name at the body's own
 * indentation followed by `(` or `<`.
 */
function interfaceMethods(source: string, name: string): string[] {
  const opening = new RegExp(`export interface ${name}\\b[^{]*\\{`, "m").exec(source);
  if (!opening) throw new Error(`builder/types.ts no longer declares ${name} — the chain surface cannot be built`);

  let depth = 0;
  let end = opening.index + opening[0].length;
  for (let i = opening.index + opening[0].length - 1; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  const body = source.slice(opening.index + opening[0].length, end);
  const methods = new Set<string>();
  for (const match of body.matchAll(/^ {2}([A-Za-z_$][A-Za-z0-9_$]*)\s*[<(]/gm)) methods.add(match[1]);

  return [...methods].sort();
}

/**
 * Which chain methods each schema kind allows.
 *
 * This cannot be reflected: every builder shares one prototype, so
 * `JIT.number().email` is a function at runtime and a type error in an editor.
 * Reflection would tell the ghost that `.email()` is fine on a number, which is
 * exactly the kind of confident wrong answer we are removing. The conditional
 * type in builder/types.ts is the real gate, so it is what gets read.
 */
function chainMethods(source: string): Record<string, string[]> {
  const core = interfaceMethods(source, "BuilderCore");
  const byInterface = {
    string: interfaceMethods(source, "StringCheckMethods"),
    number: interfaceMethods(source, "NumberCheckMethods"),
    array: interfaceMethods(source, "ArrayCheckMethods"),
    date: interfaceMethods(source, "DateLikeCheckMethods"),
    object: interfaceMethods(source, "ObjectOperators"),
    function: interfaceMethods(source, "FunctionOperators"),
    codec: interfaceMethods(source, "CodecOperators"),
  };

  const merge = (extra: string[], drop: string[] = []) =>
    [...new Set([...core.filter((method) => !drop.includes(method)), ...extra])].sort();

  return {
    // the dispatch in builder/types.ts, kind for kind
    string: merge(byInterface.string),
    number: merge(byInterface.number),
    int: merge(byInterface.number),
    array: merge(byInterface.array),
    date: merge(byInterface.date),
    temporal: merge(byInterface.date),
    // ObjectBuilder omits `required` rather than adding to the core
    object: merge(byInterface.object, ["required"]),
    function: merge(byInterface.function),
    codec: merge(byInterface.codec),
    /** Everything else gets the core alone. */
    default: merge([]),
  };
}

// ------------------------------------------------------------- the docs table

interface DocumentedMember {
  name: string;
  url: string;
  purpose: string;
}

function documentedMembers(source: string): DocumentedMember[] {
  const members: DocumentedMember[] = [];
  const seen = new Set<string>();
  const pattern = /`JIT\.([A-Za-z0-9_]+)`\s*\|\s*\[[^\]]+\]\(\.\/([^)]+)\)(?:\s*\|\s*(?!\s*`JIT\.)([^|\n]+))?/g;

  for (const match of source.matchAll(pattern)) {
    const [, name, target, purpose] = match;
    if (!name || seen.has(name)) continue;

    seen.add(name);
    members.push({
      name,
      url: `/docs/reference/functions/${target.replace(/#.*$/, "")}`,
      purpose: (purpose ?? "").replace(/`/g, "").trim(),
    });
  }

  return members;
}

// -------------------------------------------------------------------- compare

/** Every way the documentation and the library can disagree about a name. */
function mismatches(documented: DocumentedMember[], namespaces: Record<string, string[]>) {
  const problems: string[] = [];
  const real = new Set(Object.keys(JIT));
  const declared = new Set(documented.map((member) => member.name));

  for (const name of [...real].sort()) {
    if (!declared.has(name)) problems.push(`JIT.${name} exists in the runtime but the API index does not list it`);
  }
  for (const name of [...declared].sort()) {
    if (!real.has(name)) problems.push(`the API index lists JIT.${name}, which the runtime does not export`);
  }

  // The "Purpose" cell of a namespace row enumerates its members. When that
  // list drifts, the ghost is shown a namespace with a missing method and
  // reaches for something else — or invents one.
  for (const member of documented) {
    const members = namespaces[member.name];
    if (!members) continue;

    const cited = [...member.purpose.matchAll(/\b([a-z][A-Za-z0-9]*)\b/g)].map((match) => match[1]);
    const missing = members.filter((name) => !cited.includes(name));
    if (missing.length > 0 && cited.some((name) => members.includes(name))) {
      problems.push(`the API index row for JIT.${member.name} omits: ${missing.join(", ")}`);
    }
  }

  return problems;
}

// ----------------------------------------------------------------------- main

const builderTypes = await fs.readFile(path.join(packageSrc, "core/builder/types.ts"), "utf8");
const apiIndex = await fs.readFile(path.join(siteDir, "content/docs/reference/functions/index.mdx"), "utf8");

const documented = documentedMembers(apiIndex);
const namespaces = namespaceMembers();
const chain = chainMethods(builderTypes);
const problems = mismatches(documented, namespaces);

const byName = new Map(documented.map((member) => [member.name, member]));
const members = Object.keys(JIT)
  .sort()
  .map((name) => ({
    name,
    url: byName.get(name)?.url ?? "",
    purpose: byName.get(name)?.purpose ?? "",
    members: namespaces[name] ?? [],
  }));

const payload = {
  builtAt: new Date().toISOString(),
  typeExports: TYPE_EXPORTS,
  members,
  chain,
  /** Every name valid anywhere in a chain, for the audit's fast membership test. */
  allChainMethods: [...new Set(Object.values(chain).flat())].sort(),
  problems,
};

await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(outFile, JSON.stringify(payload));

const chainTotal = payload.allChainMethods.length;
const namespaceTotal = Object.values(namespaces).flat().length;
console.log(
  `[api-surface] ${members.length} members, ${namespaceTotal} namespace methods, ${chainTotal} chain methods across ${Object.keys(chain).length} kinds -> public/assistant/api-surface.json`
);

if (problems.length > 0) {
  console.log(`[api-surface] ${problems.length} documentation mismatch(es):`);
  for (const problem of problems) console.log(`  - ${problem}`);
}
