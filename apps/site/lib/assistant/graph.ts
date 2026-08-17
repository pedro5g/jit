import { fold } from "./tokenize";

/**
 * What jit is made of, as a graph rather than a word list.
 *
 * A flat synonym table can only say "this word means that word". It cannot say
 * that a question about masking is also about the boundary it happens at, that
 * `JIT.map` belongs to DTOs, or — the failure that motivated this — that "jit"
 * in a reader's question names *this library* and not just-in-time compilation
 * in general. A model asked "why is jit fast" with no such anchor answers about
 * JavaScript engines, invents `JIT.js`, and sounds confident doing it.
 *
 * Each node carries four things: the surface forms readers use for it in both
 * languages, the vocabulary the documentation uses, the public API that belongs
 * to it, and the page that explains it. Edges let one matched concept pull in
 * its neighbours at a decayed weight, which is how "how do I mask PII at my
 * API boundary" reaches the masking page and the boundary guide at once.
 */

export interface ConceptNode {
  id: string;
  /** How a reader names it, in English and Portuguese. */
  aliases: string[];
  /** How the documentation writes about it — what retrieval searches for. */
  terms: string[];
  /** Public `JIT.*` members that belong to this concept. */
  apis: string[];
  /**
   * One sentence of ground truth, written by hand and verified against the
   * docs. Retrieval returns whatever section ranked highest, which is often a
   * list of mechanisms rather than the reason behind them — asked why jit is
   * fast, the model receives "arrays use indexed loops" and has to invent the
   * rest. This is the sentence it should have had.
   */
  fact?: string;
  /**
   * The concrete strategies behind the fact, for when a reader asks how or
   * why rather than what. A one-sentence fact stops the model contradicting
   * the docs; it does not let it explain the mechanism, which is what someone
   * evaluating the library actually wants to read.
   */
  mechanisms?: string[];
  /** The page that explains it, used when deciding where to navigate. */
  page?: string;
  /** Related concepts, and how much of this node's weight they inherit. */
  edges?: Record<string, number>;
}

/**
 * The library itself. Matching this node is what tells the prompt to state,
 * in one line, that jit is this package — the single most common way an answer
 * goes wrong is drifting into generic just-in-time compilation.
 */
export const SELF_NODE = "self";

export const CONCEPTS: ConceptNode[] = [
  {
    id: SELF_NODE,
    aliases: ["jit", "lib", "library", "biblioteca", "framework", "package", "pacote", "projeto", "project"],
    terms: ["jit", "compiled", "engine", "schema"],
    apis: [],
    fact: "jit is a schema-first data engine for TypeScript: you describe a shape once with JIT.object({...}) and it compiles specialized JavaScript for every operation over that shape — validation, equality, cloning, diffing, queries, serialization and more.",
    page: "/docs",
    edges: { purpose: 0.7, compilation: 0.6, validation: 0.3, aot: 0.3 },
  },
  {
    /**
     * Why the library exists at all.
     *
     * "por que a jit existe?" and "qual problema ela resolve?" are the two
     * questions a reader evaluating the library asks first, and neither had
     * anything behind it: no node here, no section in the docs. Both retrieved
     * unrelated reference pages, and the model filled the gap by inventing.
     */
    id: "purpose",
    aliases: [
      "purpose",
      "proposito",
      "propósito",
      "problema",
      "problem",
      "existe",
      "exists",
      "motivo",
      "reason",
      "serve",
      "para que serve",
      "vale a pena",
      "worth it",
      "by hand",
      "na mao",
      "na mão",
      "necessidade",
      "tradeoff",
    ],
    terms: ["problem", "interpret", "generic", "duplication", "handwritten", "once", "purpose"],
    apis: [],
    fact: "jit exists because one schema is used for a dozen different jobs — validating a request, comparing two states, cloning, diffing, masking a log line, serializing a response — and a generic library re-reads that schema on every single call for every one of them. jit reads it once, at compile time, and emits a dedicated function per job.",
    mechanisms: [
      "The cost problem: a schema is a description, so a generic library has to walk that description at runtime — traverse the tree, branch on each node's type, allocate intermediates — every time it validates or clones a value. That work is identical on every call and is paid on every call.",
      "The drift problem: teams reach for one library for validation, another for deep equality, another for cloning, another for serialization. Each holds its own idea of the same shape, and the four descriptions fall out of sync.",
      "jit's answer to both: describe the shape once, and compile a specialized function for every operation over it. The schema is read at build time and never at call time, and every operation is derived from the same declaration, so they cannot disagree.",
      "AOT generation closes the loop: the engine itself never ships to production, so the only thing in the bundle is the generated code the application actually calls.",
    ],
    page: "/docs/concepts/why-jit",
    edges: { compilation: 0.7, performance: 0.5, comparison: 0.4, self: 0.4 },
  },
  {
    id: "compilation",
    aliases: ["compile", "compilar", "compilação", "compilation", "codegen", "generated", "gerado", "specialized"],
    terms: ["compile", "generated", "specialized", "emit", "monomorphic", "straightline", "source"],
    apis: [],
    fact: "jit walks a schema once, at compile time, and emits the monomorphic straight-line code a performance engineer would write by hand. A generic library re-walks its schema on every single call; jit never does.",
    mechanisms: [
      "Static property access only: a known shape is read as `value.name`, never through for...in or Object.keys.",
      "Checks are ordered cheapest-first — typeof, then null, then numeric range, then length, then regex — so the common rejection costs one comparison.",
      "Classic indexed loops with early returns; no closures, no callbacks per element, no Array.prototype.push in hot paths.",
      "Runtime values (regexes, refinement callbacks, query arguments) travel into the compiled function as external bindings, never interpolated into its source — so compiling is not string concatenation of user data.",
      "The result is monomorphic: one shape in, one code path, so the JavaScript engine can inline and keep the call site hot.",
    ],
    page: "/docs/concepts/compilation-model",
    edges: { performance: 0.7, aot: 0.5, runtime: 0.5 },
  },
  {
    id: "performance",
    aliases: ["fast", "rapido", "rápido", "velocidade", "speed", "performance", "desempenho", "benchmark", "slow"],
    terms: ["fast", "faster", "performance", "benchmark", "ns", "throughput", "allocation"],
    apis: [],
    fact: "The speed comes from doing the schema work once instead of per call: static property access rather than dynamic lookup, classic indexed loops, checks ordered cheapest-first (typeof, then null, then numeric, then length, then regex), no closures and no intermediate allocations. It is faster than a generic validator for the same reason a compiler is faster than an interpreter.",
    mechanisms: [
      "The schema is walked once at compile time; a generic validator re-walks its schema on every call, branching on types and allocating intermediates as it goes.",
      "`is` returns a boolean without allocating an issue array, so guards cost nothing beyond the comparisons themselves.",
      "`safeParse` leads with that allocation-free check wherever the schema cannot rebuild its input, and only pays the annotated traversal when it must.",
      "Structural operations are surgical: only paths containing a changed or marked field are rebuilt, and untouched subtrees are shared by reference rather than copied.",
      "Queries fuse into one loop — filters and projections are lowered into a single pass with no intermediate arrays.",
    ],
    page: "/docs/reference/benchmarks",
    edges: { compilation: 0.8, memory: 0.4 },
  },
  {
    id: "memory",
    aliases: ["memory", "memoria", "memória", "allocation", "alocação", "gc", "heap"],
    terms: ["memory", "allocation", "allocates", "bytes", "columnar", "buffer"],
    apis: ["process"],
    fact: "Allocation is controlled rather than incidental: is() allocates nothing, surgical operations share untouched subtrees, and binary rowsets use fixed-width buffers.",
    page: "/docs/runtime/binary-rowsets",
    edges: { binary: 0.7, performance: 0.5 },
  },
  {
    id: "validation",
    aliases: ["validate", "validar", "validação", "validation", "validator", "parse", "guard", "check", "checar"],
    terms: ["validate", "parse", "safeparse", "issues", "predicate", "guard", "boundary"],
    apis: ["validate", "dto"],
    fact: "JIT.validate.is is a type predicate that allocates nothing and returns on the first failure. JIT.validate.parse returns the output or throws. JIT.validate.safeParse returns a success union carrying a structured issue vector.",
    mechanisms: [
      "`is` is a type predicate: it returns on the first failure and allocates nothing.",
      "`parse` returns the transformed output or throws JITValidationError; for a schema that cannot rebuild its input it reuses the `is` fast path.",
      "`safeParse` returns a success union whose failure carries a structured issue vector — each issue has a path, a code and a message.",
      "Sanitization and coercion run inside the same specialized pass as validation, so a value is not traversed twice.",
    ],
    page: "/docs/runtime/validation",
    edges: { schema: 0.5, errors: 0.5, boundary: 0.4 },
  },
  {
    id: "schema",
    // "model" was JIT.model until 2.0 removed it, and it collides with
    // "module" once typos are tolerated — a reader saying it today means
    // something else.
    aliases: ["schema", "esquema", "shape", "type", "tipo", "declare", "declarar"],
    terms: ["schema", "object", "field", "declare", "builder", "infer", "typeof"],
    apis: ["object", "string", "number", "array", "union", "literal", "record", "tuple", "optional", "nullable"],
    fact: "A schema is written once with zod-like builders and carries its resolved TypeScript type; JIT.Typeof<typeof Schema> reads it back.",
    page: "/docs/concepts/schemas-and-types",
    edges: { validation: 0.5, composition: 0.5 },
  },
  {
    id: "composition",
    aliases: [
      "compose",
      "compor",
      "composition",
      "composicao",
      "composição",
      "recursive",
      "recursivo",
      "union",
      "uniao",
      "união",
      "discriminated",
      "discriminada",
      "discriminado",
      "discriminante",
      "intersection",
      "intersecao",
      "interseção",
      "lazy",
    ],
    terms: ["union", "intersection", "lazy", "recursive", "cycle", "discriminated", "refine", "pipe"],
    apis: ["union", "intersection", "lazy", "refine", "pipe", "discriminatedUnion", "xor", "brand"],
    page: "/docs/reference/functions/composition",
    edges: { schema: 0.6 },
  },
  {
    id: "aot",
    aliases: ["aot", "generate", "gerar", "geração", "build", "cli", "artifact", "artefato", "token", "define"],
    terms: ["aot", "generate", "importfree", "module", "cli", "artifact", "define", "entries", "output"],
    apis: [],
    fact: "AOT generation (jit generate) runs the same compiler at build time and writes a self-contained module with zero runtime imports. The engine does NOT ship: the generated module is the only jit code in the production bundle, which is the opposite of runtime mode, where the compiler is part of the application.",
    mechanisms: [
      "Generation runs the same compiler the runtime uses, then writes the resulting functions to disk as ordinary JavaScript or TypeScript.",
      "The emitted module imports nothing: the error class and runtime helpers are inlined, so the engine never reaches production and cannot be tree-shaken incorrectly.",
      "The difference from runtime mode is WHEN the compiler runs, and therefore whether it ships. Build time: it does not. First use: it does.",
      "Because nothing is compiled at runtime, the output needs no globalThis.Function and runs under a strict Content Security Policy and on edge runtimes.",
      "Only the artifacts a declaration file names are emitted, so an operation the application never asks for is never generated and never bundled.",
    ],
    page: "/docs/aot/generation-and-tree-shaking",
    edges: { compilation: 0.6, workspace: 0.4, bundle: 0.5 },
  },
  {
    id: "runtime",
    aliases: ["runtime", "jit runtime", "em tempo de execução", "on the fly", "primeiro uso", "first use"],
    terms: ["runtime", "function", "cache", "compiled", "firstuse"],
    apis: [],
    fact: "Runtime mode compiles an operation the first time it is used, through globalThis.Function, and caches the resulting function by schema identity. Nothing is written to disk: the compiled function lives in memory for the life of the process.",
    mechanisms: [
      "The compile happens once per schema-and-operation pair, on first call, and every later call reuses the cached function.",
      "The engine is part of the application in this mode, so the schema builders and the compiler are in the bundle.",
      "It needs `globalThis.Function`, which a strict Content Security Policy forbids — that restriction is the reason AOT exists, not a flaw in runtime mode.",
      "It is the right mode for a long-lived process and for schemas that are not known until the program runs.",
    ],
    page: "/docs/concepts/compilation-model",
    edges: { compilation: 0.6, cache: 0.5, aot: 0.5 },
  },
  {
    id: "bundle",
    aliases: ["bundle", "treeshaking", "tree shaking", "tamanho", "size", "csp", "browser", "navegador", "edge"],
    terms: ["bundle", "treeshaking", "imports", "csp", "browser", "edge"],
    apis: [],
    page: "/docs/guides/browser-and-edge",
    edges: { aot: 0.7 },
  },
  {
    id: "query",
    aliases: ["query", "consulta", "filter", "filtro", "search", "buscar", "where", "sort", "ordenar", "aggregate"],
    terms: ["query", "filter", "projection", "orderby", "groupby", "iterator", "visitor", "fused"],
    apis: ["query", "from", "param", "const"],
    fact: "A query builder compiles to one fused loop over the collection: filters and projections are lowered into a single pass with no intermediate arrays.",
    page: "/docs/runtime/queries",
    edges: { binary: 0.4, lazy: 0.5 },
  },
  {
    id: "lazy",
    aliases: ["lazy", "preguiçoso", "iterator", "generator", "stream", "chunk", "progressive"],
    terms: ["lazy", "iterator", "asynciterator", "visitor", "chunk", "stream", "ndjson"],
    apis: ["stream"],
    page: "/docs/runtime/lazy-execution",
    edges: { query: 0.5, json: 0.4 },
  },
  {
    id: "binary",
    aliases: ["binary", "binário", "rowset", "columnar", "batch", "lote", "million", "milhão", "analytics"],
    terms: ["binary", "rowset", "columnar", "packed", "aligned", "typed", "view"],
    apis: ["process", "binary"],
    fact: "Binary rowsets store large flat-object batches in fixed-width memory, so a scan reads typed views instead of walking objects.",
    mechanisms: [
      "Rows are stored in fixed-width memory, so a scan reads typed views instead of walking objects and chasing pointers.",
      "Enum and literal strings, and booleans, are compared as integer codes inside query loops rather than as strings.",
      "Discriminated object unions use dense integer tags, so a union scan is an integer compare instead of a string compare.",
      "Columnar mode keeps masks and per-field typed lanes in one buffer, and generated scans use a cached column base index with no row cursor.",
    ],
    page: "/docs/runtime/binary-rowsets",
    edges: { memory: 0.6, query: 0.5 },
  },
  {
    id: "json",
    aliases: ["json", "stringify", "serializar", "serialize", "serialization", "encode", "decode"],
    terms: ["json", "stringify", "parse", "chunks", "escape", "wire"],
    apis: ["json", "jsonValue"],
    page: "/docs/runtime/serialization",
    edges: { codec: 0.5, lazy: 0.3 },
  },
  {
    id: "codec",
    aliases: ["codec", "wire", "binary format", "formato", "encode", "version", "versão"],
    terms: ["codec", "encode", "decode", "wire", "version", "bitmask"],
    apis: ["codec", "binary"],
    page: "/docs/reference/functions/codec",
    edges: { json: 0.4 },
  },
  {
    id: "security",
    aliases: ["mask", "mascarar", "pii", "redact", "sanitize", "sanitizar", "xss", "security", "segurança", "log"],
    terms: ["mask", "sanitize", "pii", "redact", "xss", "policy", "leak"],
    apis: ["security", "format"],
    fact: "Fields marked with .pii() or .sanitize() are rebuilt into a safe copy; only paths containing a marked field are touched, and untouched subtrees are shared by reference.",
    page: "/docs/reference/functions/mask",
    edges: { boundary: 0.5, validation: 0.3 },
  },
  {
    id: "boundary",
    aliases: ["boundary", "borda", "api", "endpoint", "request", "requisição", "input", "entrada", "dto"],
    terms: ["boundary", "inbound", "outbound", "dto", "whitelist", "payload"],
    apis: ["dto", "map", "transform"],
    page: "/docs/guides/boundary-recipes",
    edges: { validation: 0.6, security: 0.4 },
  },
  {
    id: "update",
    aliases: ["update", "atualizar", "patch", "immutable", "imutável", "state", "estado", "reactive", "draft"],
    terms: ["update", "patch", "immutable", "draft", "reactive", "watch"],
    apis: ["update", "watch", "watchedList"],
    page: "/docs/runtime/reactive-updates",
    edges: { compare: 0.5 },
  },
  {
    id: "compare",
    aliases: ["equal", "igual", "compare", "comparar", "diff", "hash", "clone", "clonar", "copy", "cópia"],
    terms: ["equal", "diff", "hash", "clone", "structural", "identity"],
    apis: ["compare", "clone"],
    page: "/docs/reference/functions/equal",
    edges: { update: 0.4 },
  },
  {
    id: "errors",
    aliases: ["error", "erro", "issue", "exception", "throw", "falha", "fail"],
    terms: ["issue", "issues", "error", "path", "code", "message"],
    apis: ["validate"],
    page: "/docs/reference/functions/validation",
    edges: { validation: 0.7 },
  },
  {
    id: "cache",
    aliases: ["cache", "identity", "identidade", "reuse", "reaproveitar", "invalidate"],
    terms: ["cache", "identity", "hash", "invalidation", "compiled"],
    apis: [],
    page: "/docs/runtime/cache-hash-index",
    edges: { runtime: 0.5 },
  },
  {
    id: "jsonschema",
    aliases: ["json schema", "jsonschema", "openapi", "swagger", "contract", "contrato", "draft"],
    terms: ["jsonschema", "openapi", "draft", "document", "dialect", "ref"],
    apis: ["jsonSchema"],
    page: "/docs/reference/functions/json-schema",
    edges: { schema: 0.5 },
  },
  {
    id: "migration",
    aliases: ["migrate", "migrar", "migração", "upgrade", "atualizar versão", "2.0", "breaking", "removed", "removido"],
    terms: ["migrating", "removed", "replaced", "legacy", "facade"],
    apis: [],
    fact: "2.0 removed the JIT.validator, JIT.model, JIT.mapper and JIT.serializer facades. Capabilities are reached through namespaces, and an aggregate is a plain object of artifacts.",
    page: "/docs/guides/migrating-to-2",
    edges: { self: 0.3 },
  },
  {
    id: "workspace",
    aliases: ["workspace", "playground", "lab", "editor", "run", "rodar", "executar", "try", "testar"],
    terms: ["workspace", "editor", "run", "generate", "artifact"],
    apis: [],
    fact: "The workspace runs a schema against real values, or generates the import-free module plus a signed reference the CLI can pull into a project.",
    page: "/workspace",
    edges: { aot: 0.5 },
  },
  {
    id: "comparison",
    aliases: ["zod", "valibot", "typebox", "typia", "ajv", "yup", "versus", "vs", "comparar com", "alternativa"],
    terms: ["zod", "valibot", "typebox", "typia", "comparison", "standard"],
    apis: [],
    page: "/docs/reference/library-comparison",
    edges: { performance: 0.4 },
  },
  {
    id: "install",
    aliases: [
      "install",
      "instalar",
      "instalo",
      "instalação",
      "instalacao",
      "setup",
      "quickstart",
      "quick start",
      "começar",
      "comecar",
      "primeiro passo",
      "getting started",
      "npm",
      "pnpm",
      "yarn",
      "bun",
    ],
    terms: ["install", "npm", "pnpm", "quickstart", "package", "dependency"],
    apis: [],
    fact: "jit installs as the npm package @jit-compiler/jit; schemas are written against `@jit-compiler/jit/runtime`, and a file that AOT generation reads imports from `@jit-compiler/jit/define` instead.",
    page: "/docs/quick-start",
    edges: { self: 0.4, aot: 0.3 },
  },
  {
    id: "mcp",
    aliases: ["mcp", "agent", "agente", "tool", "ferramenta", "claude", "cursor"],
    terms: ["mcp", "stdio", "tools", "resources", "prompts"],
    apis: [],
    page: "/docs/guides/mcp-server",
  },
];

const BY_ID = new Map(CONCEPTS.map((node) => [node.id, node]));

/**
 * Aliases are matched folded, so "rápida", "rapido" and "rapidas" all reach
 * the same node. Multi-word aliases are matched against the folded sentence;
 * single words against its folded tokens, so "no" never fires inside "node".
 */
const ALIASES: { words: string[]; id: string }[] = CONCEPTS.flatMap((node) =>
  node.aliases.map((alias) => ({ words: alias.split(/\s+/).map(fold), id: node.id }))
);

export function conceptById(id: string): ConceptNode | undefined {
  return BY_ID.get(id);
}

/** Every API member the graph knows, mapped to the concept that owns it. */
const API_OWNER = new Map<string, string>();
for (const node of CONCEPTS) {
  for (const api of node.apis) {
    if (!API_OWNER.has(api)) API_OWNER.set(api, node.id);
  }
}

export function conceptForApi(api: string): string | undefined {
  return API_OWNER.get(api);
}

export interface ConceptMatch {
  id: string;
  /** 1 for a concept named directly, less for one reached through an edge. */
  weight: number;
}

/**
 * Resolves a question to concepts, then walks one step out along the edges.
 *
 * One step is deliberate: two steps reaches most of the graph from anywhere,
 * which is the same as matching nothing.
 */
/**
 * Edit distance counting a swap of two neighbours as one edit, capped.
 *
 * Transposition is the typo people actually make — "rapdio" for "rapido",
 * "valdiar" for "validar" — and plain Levenshtein scores it 2, which puts it
 * out of reach of any threshold tight enough to be safe. Rows are kept only
 * two deep, and the walk bails as soon as every cell exceeds the limit.
 */
function withinDistance(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  if (a === b) return true;

  let twoBack: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, twoBack[j - 2] + 1);
      }

      current[j] = value;
      best = Math.min(best, value);
    }

    if (best > limit) return false;
    twoBack = previous;
    previous = current;
  }

  return previous[b.length] <= limit;
}

/**
 * A typo does not make the question about something else. Readers write
 * "rapdio", "valdiar", "esquena" and "toa rapido", and a concept that only
 * matches spelling drops all of them — leaving retrieval to guess and the
 * model to invent. One edit is allowed on a word long enough for the match to
 * still mean something.
 */
const MIN_FUZZY_LENGTH = 5;

function matchesWord(alias: string, present: Set<string>, words: string[]): boolean {
  if (present.has(alias)) return true;
  if (alias.length < MIN_FUZZY_LENGTH) return false;

  return words.some((word) => {
    if (word.length < MIN_FUZZY_LENGTH) return false;

    // One being a prefix of the other is the same word in two languages or two
    // parts of speech: "valido" against "validar", "compil" against
    // "compilation", "gera" against "generate". Folding cannot reach across
    // that gap — it only trims agreement — and an edit distance of 1 is far too
    // tight for it. This is why "como valido um objeto?" matched no concept at
    // all, and so arrived with no ground truth and no identity anchor.
    if (word.startsWith(alias) || alias.startsWith(word)) return true;

    return withinDistance(word, alias, 1);
  });
}

/**
 * The words a question offers the graph.
 *
 * An identifier is several words: a reader who writes `safeParse` has said
 * "parse", and one who writes `JIT.validate.is` has said "validate". Splitting
 * on whitespace alone hides both, which is why "how does safeParse work?"
 * resolved to no concept and arrived with no ground truth attached. Every part
 * is kept alongside the whole, so `safeparse` still matches an alias of its own.
 */
function questionWords(question: string): { words: string[]; sentence: string } {
  /** One entry per word the reader wrote, in order — multi-word aliases read this. */
  const spoken: string[] = [];
  /** Those plus every part of every identifier — single-word aliases read this. */
  const expanded = new Set<string>();

  for (const raw of question.split(/[^\p{L}\p{N}._-]+/u)) {
    if (!raw) continue;

    const whole = fold(raw);
    spoken.push(whole);
    expanded.add(whole);

    for (const segment of raw.split(/[._-]+/).filter(Boolean)) {
      expanded.add(fold(segment));
      for (const part of segment.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ")) {
        if (part) expanded.add(fold(part));
      }
    }
  }

  expanded.delete("");
  return { words: [...expanded], sentence: ` ${spoken.join(" ")} ` };
}

export function resolveConcepts(question: string): ConceptMatch[] {
  const { words, sentence } = questionWords(question);
  const present = new Set(words);
  const direct = new Map<string, number>();

  for (const { words: alias, id } of ALIASES) {
    if (direct.has(id)) continue;

    const matched =
      alias.length === 1 ? matchesWord(alias[0], present, words) : sentence.includes(` ${alias.join(" ")} `);
    if (matched) direct.set(id, 1);
  }

  const scored = new Map(direct);
  for (const [id, weight] of direct) {
    for (const [neighbour, factor] of Object.entries(conceptById(id)?.edges ?? {})) {
      const inherited = weight * factor;
      if (inherited > (scored.get(neighbour) ?? 0)) scored.set(neighbour, inherited);
    }
  }

  // Equal weights are ordered by specificity: "jit is a data engine" is true
  // of every question and belongs behind the concept actually asked about.
  return [...scored]
    .map(([id, weight]) => ({ id, weight }))
    .sort((a, b) => b.weight - a.weight || Number(a.id === SELF_NODE) - Number(b.id === SELF_NODE));
}
