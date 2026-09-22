/** Roles used by the compiler when requesting a generated identifier. */
export type NameRole =
  | "field"
  | "input"
  | "output"
  | "item"
  | "index"
  | "issue"
  | "result"
  | "source"
  | "target"
  | "binding"
  | "temporary";

/** A deterministic request for one generated identifier. */
export interface NameRequest {
  readonly role: NameRole;
  readonly path?: readonly string[];
  readonly preferred?: string;
  readonly scope: string;
}

/** Source naming profile used by an AOT emitter. */
export type NamingProfile = "compact" | "semantic";

const RESERVED = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

/** Allocates stable names without consulting generated source. */
export class SemanticNameAllocator {
  readonly #profile: NamingProfile;
  readonly #used = new Map<string, Set<string>>();

  constructor(profile: NamingProfile = "compact") {
    this.#profile = profile;
  }

  /** Allocates the next name for a semantic request in its scope. */
  allocate(request: NameRequest): string {
    const used = this.#used.get(request.scope) ?? new Set<string>();
    this.#used.set(request.scope, used);
    const base = this.#profile === "semantic" ? semanticBase(request) : compactBase(request);
    let candidate = base;
    let suffix = 1;

    while (used.has(candidate) || RESERVED.has(candidate)) candidate = `${base}_${suffix++}`;
    used.add(candidate);
    return candidate;
  }

  /** Reserves a public name so internal allocations cannot shadow it. */
  reserve(scope: string, name: string): void {
    const used = this.#used.get(scope) ?? new Set<string>();
    used.add(name);
    this.#used.set(scope, used);
  }
}

function compactBase(request: NameRequest): string {
  const preferred = request.preferred ?? request.role;
  return sanitize(preferred, request.role);
}

function semanticBase(request: NameRequest): string {
  const values = request.path && request.path.length > 0 ? request.path : [request.preferred ?? request.role];
  const words = values.flatMap(tokenize);
  const base = words.map((word, index) => (index === 0 ? word.toLowerCase() : capitalize(word))).join("");
  return sanitize(base || request.role, request.role);
}

function tokenize(value: string): readonly string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9_$]+/)
    .flatMap((part) => (part.length > 0 ? [part] : []));
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ""}${value.slice(1).toLowerCase()}`;
}

function sanitize(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_$]/g, "_");
  const first = normalized[0];
  const safe = first && /[A-Za-z_$]/.test(first) ? normalized : `_${normalized}`;
  return safe.length > 0 ? safe : fallback;
}
