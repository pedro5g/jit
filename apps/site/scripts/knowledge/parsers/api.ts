/**
 * The library's real public surface, at all three levels, as symbols.
 *
 * This is the engine's answer to "does that name exist?", and it is why the
 * audit can afford to be strict. Three sources, each authoritative for exactly
 * one thing:
 *
 *   the runtime      — which names exist. Reflection cannot be out of date.
 *   builder/types.ts — which chain methods each schema kind actually allows,
 *                      since every builder shares one prototype and only the
 *                      types gate them. Reflecting this would tell the model
 *                      that `.email()` is fine on a number.
 *   the docs table   — where each member is documented, and its one-line purpose.
 *
 * Where the docs and the runtime disagree, the runtime wins and the
 * disagreement is reported as a documentation bug. A reader who finds it
 * through a wrong answer pays far more for it than the build does here.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { JIT } from "@jit-compiler/jit/runtime";
import type { ApiSymbol } from "../../../lib/copilot/core/entities/api-symbol";
import { type SymbolId, symbolId } from "../../../lib/copilot/core/value-objects/ids";

/**
 * Real exports reflection cannot see, because they only exist as types.
 *
 * This used to be the literal list `["Typeof", "Strict"]`, written by hand in
 * two scripts. The library grew `Input`, `Hydrate`, `Wire` and `Update`, the
 * reference page started using all three, and both scripts reported them as
 * invented APIs — a documentation audit failing on correct documentation,
 * which is the failure mode that teaches you to stop reading the audit.
 *
 * §111 in one line: it could be extracted from the real source, so it is.
 */
export function extractTypeExports(runtimeSource: string): string[] {
  const names = new Set<string>();

  // `export type Typeof<T> = ...`
  for (const match of runtimeSource.matchAll(/^export type ([A-Za-z_$][\w$]*)\s*[<=]/gm)) names.add(match[1]);

  // `export type { Strict } from "..."`, including the multi-line form
  for (const match of runtimeSource.matchAll(/^export type \{([\s\S]*?)\}/gm)) {
    for (const part of match[1].split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }

  return [...names].sort();
}

export interface ApiExtraction {
  symbols: ApiSymbol[];
  /** Public names that exist only in the type system. */
  typeExports: string[];
  /** Chain methods per schema kind, kept for the prompt and the audit. */
  chain: Record<string, string[]>;
  /** Documentation bugs found while building this. */
  problems: string[];
  /** `JIT.x` -> the reference page that documents it. */
  documentedUrls: Map<string, string>;
}

interface DeclaredMethod {
  name: string;
  signature: string;
}

/**
 * Method names and signatures declared directly in one interface body.
 *
 * Overloads repeat a name and are collected under it. JSDoc, generics and
 * multi-line signatures are handled by only accepting a name at the body's own
 * indentation followed by `(` or `<`, then taking the rest of the line.
 */
function interfaceMethods(source: string, name: string, origin: string, indent = 2): DeclaredMethod[] {
  const opening = new RegExp(`(?:export )?interface ${name}\\b[^{]*\\{`, "m").exec(source);
  if (!opening) throw new Error(`${origin} no longer declares ${name} — the chain surface cannot be built`);

  const bodyStart = opening.index + opening[0].length;
  let depth = 1;
  let end = source.length;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  const body = source.slice(bodyStart, end);
  const found: DeclaredMethod[] = [];
  const pattern = new RegExp(`^ {${indent}}([A-Za-z_$][A-Za-z0-9_$]*)\\s*[<(].*$`, "gm");

  for (const match of body.matchAll(pattern)) {
    found.push({ name: match[1], signature: match[0].trim().replace(/;$/, "") });
  }

  return found;
}

/**
 * Methods on the inline half of an intersection type alias — the `& { where();
 * limit() }` in `CqrsQuery`. Those names are as public as an interface's:
 * `where` lives there, and an assistant that cannot see it reaches for
 * `filter`, which is the internal spelling.
 */
function aliasIntersectionMethods(source: string, name: string, origin: string): DeclaredMethod[] {
  const opening = new RegExp(`(?:export )?type ${name}\\b[^=]*=`, "m").exec(source);
  if (!opening) throw new Error(`${origin} no longer declares ${name} — the chain surface cannot be built`);

  const brace = source.indexOf("& {", opening.index + opening[0].length);
  if (brace === -1) return [];

  const start = source.indexOf("{", brace);
  let depth = 0;
  let end = start;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  const found: DeclaredMethod[] = [];
  for (const match of source.slice(start + 1, end).matchAll(/^ {4}([A-Za-z_$][A-Za-z0-9_$]*)\s*[<(].*$/gm)) {
    found.push({ name: match[1], signature: match[0].trim().replace(/;$/, "") });
  }

  return found;
}

/** Members reached through a namespace object: `JIT.validate.safeParse`. */
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

/**
 * Which chain methods each schema kind allows, mirroring the conditional type
 * in `builder/types.ts` kind for kind.
 */
function chainMethods(source: string): {
  byKind: Record<string, string[]>;
  checksByKind: Record<string, string[]>;
  signatures: Map<string, string>;
} {
  const signatures = new Map<string, string>();
  const collect = (methods: DeclaredMethod[]) => {
    for (const method of methods) if (!signatures.has(method.name)) signatures.set(method.name, method.signature);
    return methods.map((method) => method.name);
  };

  const core = collect(interfaceMethods(source, "BuilderCore", "builder/types.ts"));
  const byInterface = {
    string: collect(interfaceMethods(source, "StringCheckMethods", "builder/types.ts")),
    number: collect(interfaceMethods(source, "NumberCheckMethods", "builder/types.ts")),
    array: collect(interfaceMethods(source, "ArrayCheckMethods", "builder/types.ts")),
    date: collect(interfaceMethods(source, "DateLikeCheckMethods", "builder/types.ts")),
    object: collect(interfaceMethods(source, "ObjectOperators", "builder/types.ts")),
    function: collect(interfaceMethods(source, "FunctionOperators", "builder/types.ts")),
    codec: collect(interfaceMethods(source, "CodecOperators", "builder/types.ts")),
  };

  const merge = (extra: string[], drop: string[] = []) =>
    [...new Set([...core.filter((method) => !drop.includes(method)), ...extra])].sort();

  /**
   * Which of a kind's methods are constraints rather than operations.
   *
   * The library already draws this line and draws it in one place: a check
   * method is declared in `StringCheckMethods` and friends, while `.parse()`,
   * `.optional()` and `.pipe()` come from `BuilderCore`. Carrying the
   * distinction out of the extractor means nothing downstream has to guess it
   * — and §111's rule is that a distinction the source makes is never
   * re-derived by hand somewhere else.
   */
  const checksByKind: Record<string, string[]> = {
    string: [...byInterface.string].sort(),
    number: [...byInterface.number].sort(),
    int: [...byInterface.number].sort(),
    array: [...byInterface.array].sort(),
    date: [...byInterface.date].sort(),
    temporal: [...byInterface.date].sort(),
  };

  return {
    checksByKind,
    byKind: {
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
    },
    signatures,
  };
}

/**
 * The CQRS query chain, which no schema kind gates and reflection cannot see:
 * a query builder is a function with methods hung off it, so every name looks
 * available on every builder.
 */
function queryChain(
  cqrsSource: string,
  querySource: string,
  signatures: Map<string, string>
): Record<string, string[]> {
  const collect = (methods: DeclaredMethod[]) => {
    for (const method of methods) if (!signatures.has(method.name)) signatures.set(method.name, method.signature);
    return methods.map((method) => method.name);
  };

  const ops = collect(interfaceMethods(cqrsSource, "CqrsQueryOps", "factories/cqrs.ts"));
  const alias = collect(aliasIntersectionMethods(cqrsSource, "CqrsQuery", "factories/cqrs.ts"));

  return {
    "cqrs.query": [...new Set([...ops, ...alias])].sort(),
    "cqrs.join": collect(interfaceMethods(cqrsSource, "CqrsJoinOnBuilder", "factories/cqrs.ts")),
    "cqrs.to": collect(interfaceMethods(querySource, "QuerySinks", "factories/query.ts")),
  };
}

interface DocumentedMember {
  name: string;
  url: string;
  purpose: string;
}

/**
 * The reference index table. The factory tables put two members on one row, so
 * the optional purpose cell must refuse a cell that is itself a member —
 * otherwise it swallows the next `JIT.x` and that member never gets a row.
 */
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

/** Every way the documentation and the library can disagree about a name. */
function mismatches(documented: DocumentedMember[], namespaces: Record<string, string[]>): string[] {
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
  // list drifts, the model is shown a namespace with a missing method and
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

export async function extractApi(packageSrc: string, apiIndexFile: string): Promise<ApiExtraction> {
  const [builderTypes, cqrsSource, querySource, runtimeSource, apiIndex] = await Promise.all([
    fs.readFile(path.join(packageSrc, "core/builder/types.ts"), "utf8"),
    fs.readFile(path.join(packageSrc, "factories/cqrs.ts"), "utf8"),
    fs.readFile(path.join(packageSrc, "factories/query.ts"), "utf8"),
    fs.readFile(path.join(packageSrc, "runtime.ts"), "utf8"),
    fs.readFile(apiIndexFile, "utf8"),
  ]);

  const typeExports = extractTypeExports(runtimeSource);

  const documented = documentedMembers(apiIndex);
  const namespaces = namespaceMembers();
  const { byKind, checksByKind, signatures } = chainMethods(builderTypes);
  const chain = { ...byKind, ...queryChain(cqrsSource, querySource, signatures) };

  const byName = new Map(documented.map((member) => [member.name, member]));
  const symbols: ApiSymbol[] = [];
  const emitted = new Set<string>();

  const emit = (symbol: ApiSymbol) => {
    if (emitted.has(symbol.id)) return;
    emitted.add(symbol.id);
    symbols.push(symbol);
  };

  const blank = { signatures: [] as string[], validOn: [] as string[], purpose: "", examples: [] };

  // ------------------------------------------------------------- level 1 & 2
  for (const name of Object.keys(JIT).sort()) {
    const members = namespaces[name] ?? [];
    const documentation = byName.get(name);
    const id = symbolId(`jit.${name}`);

    emit({
      ...blank,
      id,
      name,
      path: `JIT.${name}`,
      kind: members.length > 0 ? "namespace" : "factory",
      purpose: documentation?.purpose ?? "",
      examples: [],
    });

    for (const member of members) {
      emit({
        ...blank,
        id: symbolId(`jit.${name}.${member}`),
        name: member,
        path: `JIT.${name}.${member}`,
        kind: "function",
        parent: id,
        purpose: "",
        examples: [],
      });
    }
  }

  for (const name of typeExports) {
    emit({ ...blank, id: symbolId(`jit.${name}`), name, path: `JIT.${name}`, kind: "type", examples: [] });
  }

  // ----------------------------------------------------------------- level 3
  /**
   * One symbol per (kind, method) pair rather than one per method name.
   *
   * `jit.string.min` and `jit.number.min` are different entries on purpose:
   * exact lookup has to resolve what a reader actually writes —
   * `JIT.string().min(3)` — and the audit has to be able to say that
   * `.email()` on a number is wrong. A single `min` symbol could do neither.
   * `validOn` then carries every kind the *name* is valid on, which is what
   * turns "that is wrong" into "that is valid on a string".
   */
  const kindsForMethod = new Map<string, string[]>();
  for (const [kind, methods] of Object.entries(chain)) {
    if (kind === "default") continue;
    for (const method of methods) {
      const kinds = kindsForMethod.get(method) ?? [];
      kinds.push(kind);
      kindsForMethod.set(method, kinds);
    }
  }

  for (const [kind, methods] of Object.entries(chain)) {
    if (kind === "default") continue;

    // `cqrs.query` reaches through a namespace member; `string` is a factory.
    // Both spell the parent the same way.
    const parentPath = `jit.${kind}`;

    /**
     * A chain kind with no symbol of its own gets one.
     *
     * `JIT.cqrs.query().to.iterator()` reaches its sinks through `.to`, which
     * is a property on the query builder rather than a member of `JIT.cqrs` —
     * so reflection never sees it and `jit.cqrs.to` was missing from the
     * index. Its operators then had no parent, which made them look like
     * top-level public members with no documentation: the coverage check
     * reported two APIs as undocumented when what was actually missing was
     * the node above them.
     */
    if (!emitted.has(symbolId(parentPath))) {
      const [namespace, step] = kind.split(".");
      emit({
        ...blank,
        id: symbolId(parentPath),
        name: step ?? kind,
        path: `JIT.${kind}`,
        kind: "namespace",
        ...(step && emitted.has(symbolId(`jit.${namespace}`)) ? { parent: symbolId(`jit.${namespace}`) } : {}),
        examples: [],
      });
    }

    const parent = symbolId(parentPath);
    const isOperator = kind.startsWith("cqrs.");
    const checks = new Set(checksByKind[kind] ?? []);

    for (const method of methods) {
      const signature = signatures.get(method);
      emit({
        id: symbolId(`${parentPath}.${method}`),
        name: method,
        path: `JIT.${kind}().${method}`,
        kind: isOperator ? "operator" : "method",
        ...(parent ? { parent } : {}),
        signatures: signature ? [signature] : [],
        validOn: kindsForMethod.get(method) ?? [kind],
        role: checks.has(method) ? "check" : "operation",
        purpose: "",
        examples: [],
      });
    }
  }

  return {
    symbols,
    typeExports,
    chain,
    problems: mismatches(documented, namespaces),
    documentedUrls: new Map(documented.map((member) => [member.name, member.url])),
  };
}

export type { SymbolId };
