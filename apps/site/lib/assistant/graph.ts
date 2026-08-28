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
   * The same fact in Portuguese.
   *
   * A large share of readers ask in Portuguese, and the grounded answer is
   * shown verbatim rather than translated by the model — a 0.8B model handed
   * an English paragraph to translate rewrites it, and rewriting is exactly
   * what this path exists to avoid. Written by hand for the concepts that
   * actually get asked about; the rest fall back to the English text.
   */
  factPt?: string;
  /**
   * The concrete strategies behind the fact, for when a reader asks how or
   * why rather than what. A one-sentence fact stops the model contradicting
   * the docs; it does not let it explain the mechanism, which is what someone
   * evaluating the library actually wants to read.
   */
  mechanisms?: string[];
  /** The mechanisms in Portuguese, for the same reason as `factPt`. */
  mechanismsPt?: string[];
  /**
   * A short, runnable demonstration of this concept.
   *
   * Asked "pode me mostrar um exemplo de uso?", a small model with no example
   * to lean on produced a JSON envelope and a hundred lines of `array.push`.
   * These are executed against the real library by the test suite, so what the
   * ghost falls back to is code that actually runs.
   */
  example?: string;
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
    factPt:
      "A jit é um data engine schema-first para TypeScript: você descreve um formato uma vez com JIT.object({...}) e ela compila JavaScript especializado para cada operação sobre esse formato — validação, igualdade, clonagem, diff, queries, serialização e mais.",
    mechanisms: [
      "One declaration drives every operation: validation, equality, cloning, diffing, hashing, immutable updates, queries, DTO mapping, PII masking, sanitizing, JSON, a versioned binary codec, binary rowsets and progressive streaming.",
      "Validation, security and transport are navigable namespaces; structural leaves are JIT.compare.equal, JIT.compare.diff, JIT.compare.hash and JIT.clone; schema factories sit at the root.",
      "Every artifact is lazy and callable: `.compile()` is an optional warm-up and `.plan` exposes the descriptor AOT consumes.",
    ],
    mechanismsPt: [
      "Uma declaração alimenta todas as operações: validação, igualdade, clonagem, diff, hash, updates imutáveis, queries, mapeamento de DTO, mascaramento de PII, sanitização, JSON, um codec binário versionado, rowsets binários e validação progressiva em stream.",
      "Validação, segurança e transporte são namespaces navegáveis; as operações estruturais são JIT.compare.equal, JIT.compare.diff, JIT.compare.hash e JIT.clone; as fábricas de schema ficam na raiz.",
      "Todo artefato é lazy e chamável: `.compile()` é um aquecimento opcional e `.plan` expõe o descritor que o AOT consome.",
    ],
    example:
      "const User = JIT.object({\n  id: JIT.string().uuid(),\n  email: JIT.string().email(),\n  age: JIT.number().int().min(0),\n});\n\n// one declaration, many compiled operations\nconst isUser = JIT.validate.is(User);\nconst sameUser = JIT.compare.equal(User);\nconst cloneUser = JIT.clone(User);\nconst toJson = JIT.json.stringify(User);",
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
    factPt:
      "A jit existe porque um mesmo schema é usado para uma dúzia de tarefas diferentes — validar uma requisição, comparar dois estados, clonar, gerar um diff, mascarar uma linha de log, serializar uma resposta — e uma biblioteca genérica relê esse schema a cada chamada, para cada uma delas. A jit lê uma vez, em tempo de compilação, e emite uma função dedicada por tarefa.",
    mechanismsPt: [
      "O custo: um schema é uma descrição, então uma biblioteca genérica precisa percorrer essa descrição em runtime — andar pela árvore, ramificar no tipo de cada nó, alocar intermediários — toda vez que valida ou clona um valor. Esse trabalho é idêntico em toda chamada e é pago em toda chamada.",
      "A divergência: times acabam com uma lib para validação, outra para igualdade profunda, outra para clonagem, outra para serialização. Cada uma guarda sua própria ideia do mesmo formato, e as quatro saem de sincronia.",
      "A resposta da jit para os dois: descreva o formato uma vez e compile uma função especializada para cada operação sobre ele. O schema é lido em build time e nunca em tempo de chamada, e toda operação deriva da mesma declaração — então elas não têm como discordar.",
      "A geração AOT fecha o ciclo: o próprio motor nunca vai para produção, então o que sobra no bundle é só o código gerado que a aplicação de fato chama.",
    ],
    fact: "jit exists because one schema is used for a dozen different jobs — validating a request, comparing two states, cloning, diffing, masking a log line, serializing a response — and a generic library re-reads that schema on every single call for every one of them. jit reads it once, at compile time, and emits a dedicated function per job.",
    mechanisms: [
      "The cost problem: a schema is a description, so a generic library has to walk that description at runtime — traverse the tree, branch on each node's type, allocate intermediates — every time it validates or clones a value. That work is identical on every call and is paid on every call.",
      "The drift problem: teams reach for one library for validation, another for deep equality, another for cloning, another for serialization. Each holds its own idea of the same shape, and the four descriptions fall out of sync.",
      "jit's answer to both: describe the shape once, and compile a specialized function for every operation over it. The schema is read at build time and never at call time, and every operation is derived from the same declaration, so they cannot disagree.",
      "AOT generation closes the loop: the engine itself never ships to production, so the only thing in the bundle is the generated code the application actually calls.",
    ],
    example:
      "const User = JIT.object({\n  id: JIT.string().uuid(),\n  email: JIT.string().email().pii(),\n});\n\n// every one of these is derived from the SAME declaration,\n// so they cannot disagree about what a User is\nconst isUser = JIT.validate.is(User);\nconst safeForLogs = JIT.security.mask(User);\nconst sameUser = JIT.compare.equal(User);",
    page: "/docs/concepts/why-jit",
    edges: { compilation: 0.7, performance: 0.5, comparison: 0.4, self: 0.4 },
  },
  {
    id: "compilation",
    aliases: ["compile", "compilar", "compilação", "compilation", "codegen", "generated", "gerado", "specialized"],
    terms: ["compile", "generated", "specialized", "emit", "monomorphic", "straightline", "source"],
    apis: [],
    factPt:
      "A jit percorre o schema uma vez, em tempo de compilação, e emite o código monomórfico e linear que um engenheiro de performance escreveria à mão. Uma biblioteca genérica repercorre o schema a cada chamada; a jit nunca faz isso.",
    mechanismsPt: [
      "Só acesso estático a propriedades: um formato conhecido é lido como `value.name`, nunca via for...in ou Object.keys.",
      "Checagens ordenadas da mais barata para a mais cara — typeof, depois null, depois faixa numérica, depois comprimento, depois regex — então a rejeição comum custa uma comparação.",
      "Laços indexados clássicos com retorno antecipado; sem closures, sem callback por elemento, sem Array.prototype.push em caminho quente.",
      "Valores de runtime (regexes, callbacks de refine, argumentos de query) entram na função compilada como bindings externos, nunca interpolados no fonte — compilar não é concatenar string de dado do usuário.",
      "O resultado é monomórfico: um formato entra, um caminho de código, então o motor JavaScript consegue inline e mantém o call site quente.",
    ],
    fact: "jit walks a schema once, at compile time, and emits the monomorphic straight-line code a performance engineer would write by hand. A generic library re-walks its schema on every single call; jit never does.",
    mechanisms: [
      "Static property access only: a known shape is read as `value.name`, never through for...in or Object.keys.",
      "Checks are ordered cheapest-first — typeof, then null, then numeric range, then length, then regex — so the common rejection costs one comparison.",
      "Classic indexed loops with early returns; no closures, no callbacks per element, no Array.prototype.push in hot paths.",
      "Runtime values (regexes, refinement callbacks, query arguments) travel into the compiled function as external bindings, never interpolated into its source — so compiling is not string concatenation of user data.",
      "The result is monomorphic: one shape in, one code path, so the JavaScript engine can inline and keep the call site hot.",
    ],
    example:
      'const User = JIT.object({ id: JIT.string(), age: JIT.number().int() });\n\n// compiled on first use, then cached by schema identity\nconst isUser = JIT.validate.is(User);\n\nisUser({ id: "a", age: 30 }); // compiles here\nisUser({ id: "b", age: 31 }); // reuses the compiled function',
    page: "/docs/concepts/compilation-model",
    edges: { performance: 0.7, aot: 0.5, runtime: 0.5 },
  },
  {
    id: "performance",
    aliases: ["fast", "rapido", "rápido", "velocidade", "speed", "performance", "desempenho", "benchmark", "slow"],
    terms: ["fast", "faster", "performance", "benchmark", "ns", "throughput", "allocation"],
    apis: [],
    factPt:
      "A velocidade vem de fazer o trabalho do schema uma vez, em vez de a cada chamada: acesso estático a propriedades em vez de lookup dinâmico, laços indexados clássicos, checagens ordenadas da mais barata para a mais cara (typeof, depois null, depois numérico, depois comprimento, depois regex), sem closures e sem alocações intermediárias. É mais rápida que um validador genérico pelo mesmo motivo que um compilador é mais rápido que um interpretador.",
    mechanismsPt: [
      "O schema é percorrido uma vez, em tempo de compilação; um validador genérico repercorre o schema a cada chamada, ramificando por tipo e alocando intermediários no caminho.",
      "`is` devolve um booleano sem alocar array de issues, então um guard custa apenas as comparações em si.",
      "`safeParse` começa por essa mesma checagem sem alocação onde o schema não precisa reconstruir a entrada, e só paga a travessia anotada quando é obrigada.",
      "Operações estruturais são cirúrgicas: só os caminhos que contêm um campo alterado ou marcado são reconstruídos, e subárvores intocadas são compartilhadas por referência em vez de copiadas.",
      "Queries se fundem em um único laço — filtros e projeções descem para uma só passada, sem arrays intermediários.",
    ],
    fact: "The speed comes from doing the schema work once instead of per call: static property access rather than dynamic lookup, classic indexed loops, checks ordered cheapest-first (typeof, then null, then numeric, then length, then regex), no closures and no intermediate allocations. It is faster than a generic validator for the same reason a compiler is faster than an interpreter.",
    mechanisms: [
      "The schema is walked once at compile time; a generic validator re-walks its schema on every call, branching on types and allocating intermediates as it goes.",
      "`is` returns a boolean without allocating an issue array, so guards cost nothing beyond the comparisons themselves.",
      "`safeParse` leads with that allocation-free check wherever the schema cannot rebuild its input, and only pays the annotated traversal when it must.",
      "Structural operations are surgical: only paths containing a changed or marked field are rebuilt, and untouched subtrees are shared by reference rather than copied.",
      "Queries fuse into one loop — filters and projections are lowered into a single pass with no intermediate arrays.",
    ],
    example:
      "const User = JIT.object({ id: JIT.string(), age: JIT.number().int().min(0) });\n\n// allocates nothing and returns on the first failing check\nconst isUser = JIT.validate.is(User);\n\n// pays for the issue vector only when it has to report one\nconst parseUser = JIT.validate.safeParse(User);",
    page: "/docs/reference/benchmarks",
    edges: { compilation: 0.8, memory: 0.4 },
  },
  {
    id: "memory",
    aliases: ["memory", "memoria", "memória", "allocation", "alocação", "gc", "heap"],
    terms: ["memory", "allocation", "allocates", "bytes", "columnar", "buffer"],
    apis: ["process"],
    fact: "Allocation is controlled rather than incidental: is() allocates nothing, surgical operations share untouched subtrees, and binary rowsets use fixed-width buffers.",
    factPt:
      "A alocação é controlada, não incidental: is() não aloca nada, operações cirúrgicas compartilham subárvores intocadas, e rowsets binários usam buffers de largura fixa.",
    mechanisms: [
      "`is` returns a boolean and allocates no issue array, so a guard costs only its comparisons.",
      "Structural operations rebuild only the paths that changed; unchanged children keep their identity and are shared by reference.",
      "Binary rowsets store rows in fixed-width memory, so a scan reads typed views instead of allocating an object per row.",
      "`JIT.json.stringifyChunks` emits bounded chunks instead of building one large string for a big array.",
    ],
    mechanismsPt: [
      "`is` devolve um booleano e não aloca array de issues, então um guard custa só as comparações.",
      "Operações estruturais reconstroem apenas os caminhos que mudaram; filhos inalterados mantêm identidade e são compartilhados por referência.",
      "Rowsets binários guardam linhas em memória de largura fixa, então um scan lê typed views em vez de alocar um objeto por linha.",
      "`JIT.json.stringifyChunks` emite chunks limitados em vez de montar uma string gigante para um array grande.",
    ],
    example:
      "const Row = JIT.object({ id: JIT.string(), amount: JIT.number() });\n\n// a guard that allocates nothing at all\nconst isRow = JIT.validate.is(Row);\n\n// bounded chunks instead of one large string\nconst toChunks = JIT.json.stringifyChunks(JIT.array(Row), { chunkBytes: 16 * 1024 });",
    page: "/docs/runtime/binary-rowsets",
    edges: { binary: 0.7, performance: 0.5 },
  },
  {
    id: "validation",
    aliases: ["validate", "validar", "validação", "validation", "validator", "parse", "guard", "check", "checar"],
    terms: ["validate", "parse", "safeparse", "issues", "predicate", "guard", "boundary"],
    apis: ["validate", "dto"],
    factPt:
      "JIT.validate.is é um type predicate que não aloca nada e retorna na primeira falha. JIT.validate.parse devolve a saída ou lança. JIT.validate.safeParse devolve uma união de sucesso carregando um vetor estruturado de issues.",
    mechanismsPt: [
      "`is` é um type predicate: retorna na primeira falha e não aloca nada.",
      "`parse` devolve a saída transformada ou lança JITValidationError; para um schema que não precisa reconstruir a entrada, ele reusa o caminho rápido do `is`.",
      "`safeParse` devolve uma união de sucesso cuja falha carrega um vetor estruturado de issues — cada issue tem um path, um code e uma message.",
      "Sanitização e coerção rodam dentro da mesma passada especializada da validação, então o valor não é percorrido duas vezes.",
    ],
    fact: "JIT.validate.is is a type predicate that allocates nothing and returns on the first failure. JIT.validate.parse returns the output or throws. JIT.validate.safeParse returns a success union carrying a structured issue vector.",
    mechanisms: [
      "`is` is a type predicate: it returns on the first failure and allocates nothing.",
      "`parse` returns the transformed output or throws JITValidationError; for a schema that cannot rebuild its input it reuses the `is` fast path.",
      "`safeParse` returns a success union whose failure carries a structured issue vector — each issue has a path, a code and a message.",
      "Sanitization and coercion run inside the same specialized pass as validation, so a value is not traversed twice.",
    ],
    example:
      "const User = JIT.object({\n  id: JIT.string().uuid(),\n  email: JIT.string().email(),\n});\n\nconst isUser = JIT.validate.is(User);          // boolean, allocates nothing\nconst parseUser = JIT.validate.parse(User);    // returns the value or throws\nconst safeUser = JIT.validate.safeParse(User); // returns a success union",
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
    factPt:
      "Um schema é escrito uma vez com builders no estilo zod e carrega seu tipo TypeScript resolvido; JIT.Typeof<typeof Schema> lê esse tipo de volta.",
    mechanisms: [
      "Builders are fluent and immutable: every call returns a new builder and leaves the input schema unchanged.",
      "Check methods are gated by kind at the type level — `.email()` exists on a string, `.pick()` on an object, `.multipleOf()` on a number — so a wrong one is a type error before it is a runtime problem.",
      "`JIT.Typeof<typeof User>` reads the inferred type back out, so the schema is the single declaration and the TypeScript type follows it.",
      "The same schema object is the key the compile cache uses, so reusing one declaration reuses every function compiled from it.",
    ],
    mechanismsPt: [
      "Builders são fluentes e imutáveis: cada chamada devolve um builder novo e deixa o schema de entrada intacto.",
      "Métodos de check são restritos por tipo — `.email()` existe em string, `.pick()` em object, `.multipleOf()` em number — então o errado é erro de tipo antes de ser problema em runtime.",
      "`JIT.Typeof<typeof User>` lê o tipo inferido de volta, então o schema é a única declaração e o tipo TypeScript segue dela.",
      "O próprio objeto de schema é a chave do cache de compilação, então reusar uma declaração reusa toda função compilada a partir dela.",
    ],
    example:
      'const User = JIT.object({\n  id: JIT.number().int32().positive(),\n  name: JIT.string().min(3).max(80),\n  email: JIT.string().email(),\n  role: JIT.union(JIT.literal("admin"), JIT.literal("member")),\n});\n\n// the schema carries its own TypeScript type\ntype UserShape = JIT.Typeof<typeof User>;',
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
    fact: "Composition helpers each return a NEW builder and leave the input schema unchanged: JIT.union, JIT.intersection, JIT.discriminatedUnion, JIT.optional, JIT.nullable, JIT.lazy, JIT.refine, JIT.pipe, JIT.brand and JIT.xor. Fluent equivalents exist where they read naturally, so JIT.optional(JIT.string()) and JIT.string().optional() are the same thing.",
    factPt:
      "Os helpers de composição devolvem sempre um builder NOVO e deixam o schema de entrada intacto: JIT.union, JIT.intersection, JIT.discriminatedUnion, JIT.optional, JIT.nullable, JIT.lazy, JIT.refine, JIT.pipe, JIT.brand e JIT.xor. Existem equivalentes fluentes onde fazem sentido, então JIT.optional(JIT.string()) e JIT.string().optional() são a mesma coisa.",
    mechanisms: [
      "`JIT.discriminatedUnion` dispatches on the tag field before comparing anything else, so a union costs one check rather than trying each variant.",
      "`JIT.lazy` is what makes a self-referencing or cyclic schema work: the reference is resolved when it is first needed rather than while the declaration is still being built.",
      "`JIT.refine` takes a predicate that travels into the compiled function as an external binding — never interpolated into its source.",
      "A refine or transform callback that closes over its scope cannot be serialized ahead of time, so `jit generate` skips that artifact; a declarative `JIT.ops` chain has no closure and always generates.",
    ],
    mechanismsPt: [
      "`JIT.discriminatedUnion` despacha pelo campo discriminante antes de comparar qualquer outra coisa, então a união custa uma checagem em vez de tentar cada variante.",
      "`JIT.lazy` é o que faz um schema auto-referente ou cíclico funcionar: a referência é resolvida quando é necessária pela primeira vez, não enquanto a declaração ainda está sendo montada.",
      "`JIT.refine` recebe um predicado que entra na função compilada como binding externo — nunca interpolado no fonte dela.",
      "Um callback de refine ou transform que captura o escopo não pode ser serializado em build time, então o `jit generate` pula aquele artefato; uma cadeia declarativa `JIT.ops` não tem closure e sempre gera.",
    ],
    example:
      'const Node = JIT.object({\n  name: JIT.string(),\n  // lazy is what lets a schema reference itself\n  children: JIT.array(JIT.lazy(() => Node)),\n});\n\nconst Shape = JIT.discriminatedUnion("kind", [\n  JIT.object({ kind: JIT.literal("circle"), radius: JIT.number() }),\n  JIT.object({ kind: JIT.literal("square"), side: JIT.number() }),\n]);',
    page: "/docs/reference/functions/composition",
    edges: { schema: 0.6 },
  },
  {
    id: "aot",
    aliases: ["aot", "generate", "gerar", "geração", "build", "cli", "artifact", "artefato", "token", "define"],
    terms: ["aot", "generate", "importfree", "module", "cli", "artifact", "define", "entries", "output"],
    apis: [],
    factPt:
      "A geração AOT (jit generate) roda o mesmo compilador em tempo de build e escreve um módulo autocontido com zero imports de runtime. O motor NÃO é embarcado: o módulo gerado é o único código da jit no bundle de produção — o oposto do modo runtime, onde o compilador faz parte da aplicação.",
    mechanismsPt: [
      "A geração roda o mesmo compilador que o runtime usa e escreve as funções resultantes em disco como JavaScript ou TypeScript comum.",
      "O módulo emitido não importa nada: a classe de erro e os helpers de runtime são inlinados, então o motor nunca chega em produção e não tem como ser tree-shaken errado.",
      "A diferença para o modo runtime é QUANDO o compilador roda, e portanto se ele é embarcado. Build time: não é. Primeiro uso: é.",
      "Como nada é compilado em runtime, a saída não precisa de globalThis.Function e roda sob CSP estrita e em edge runtimes.",
      "Só os artefatos que um arquivo de declaração nomeia são emitidos, então uma operação que a aplicação nunca pede nunca é gerada nem empacotada.",
    ],
    fact: "AOT generation (jit generate) runs the same compiler at build time and writes a self-contained module with zero runtime imports. The engine does NOT ship: the generated module is the only jit code in the production bundle, which is the opposite of runtime mode, where the compiler is part of the application.",
    mechanisms: [
      "Generation runs the same compiler the runtime uses, then writes the resulting functions to disk as ordinary JavaScript or TypeScript.",
      "The emitted module imports nothing: the error class and runtime helpers are inlined, so the engine never reaches production and cannot be tree-shaken incorrectly.",
      "The difference from runtime mode is WHEN the compiler runs, and therefore whether it ships. Build time: it does not. First use: it does.",
      "Because nothing is compiled at runtime, the output needs no globalThis.Function and runs under a strict Content Security Policy and on edge runtimes.",
      "Only the artifacts a declaration file names are emitted, so an operation the application never asks for is never generated and never bundled.",
    ],
    example:
      '// user.jit.ts — read by `jit generate`, imports from /define\nimport { JIT } from "@jit-compiler/jit/define";\n\nexport const User = JIT.object({\n  id: JIT.string().uuid(),\n  email: JIT.string().email(),\n});\n\nexport const isUser = JIT.validate.is(User);\n\n// then: pnpm jit generate\n// and import from the emitted module, which has zero runtime imports',
    page: "/docs/aot/generation-and-tree-shaking",
    edges: { compilation: 0.6, workspace: 0.4, bundle: 0.5 },
  },
  {
    id: "runtime",
    aliases: ["runtime", "jit runtime", "em tempo de execução", "on the fly", "primeiro uso", "first use"],
    terms: ["runtime", "function", "cache", "compiled", "firstuse"],
    apis: [],
    factPt:
      "O modo runtime compila uma operação na primeira vez em que ela é usada, através de globalThis.Function, e guarda a função resultante em cache por identidade de schema. Nada é escrito em disco: a função compilada vive em memória pelo tempo de vida do processo.",
    mechanismsPt: [
      "A compilação acontece uma vez por par schema-e-operação, na primeira chamada, e toda chamada seguinte reusa a função em cache.",
      "Nesse modo o motor faz parte da aplicação, então os builders de schema e o compilador estão no bundle.",
      "Ele precisa de `globalThis.Function`, que uma Content Security Policy estrita proíbe — essa restrição é o motivo de o AOT existir, não um defeito do modo runtime.",
      "É o modo certo para um processo de vida longa e para schemas que só são conhecidos quando o programa roda.",
    ],
    fact: "Runtime mode compiles an operation the first time it is used, through globalThis.Function, and caches the resulting function by schema identity. Nothing is written to disk: the compiled function lives in memory for the life of the process.",
    mechanisms: [
      "The compile happens once per schema-and-operation pair, on first call, and every later call reuses the cached function.",
      "The engine is part of the application in this mode, so the schema builders and the compiler are in the bundle.",
      "It needs `globalThis.Function`, which a strict Content Security Policy forbids — that restriction is the reason AOT exists, not a flaw in runtime mode.",
      "It is the right mode for a long-lived process and for schemas that are not known until the program runs.",
    ],
    example:
      'const User = JIT.object({ id: JIT.string() });\nconst isUser = JIT.validate.is(User);\n\nisUser({ id: "a" });   // compiles through globalThis.Function here\nisUser({ id: "b" });   // cached from now on\n\nisUser.compile();      // optional eager warm-up; same callable',
    page: "/docs/concepts/compilation-model",
    edges: { compilation: 0.6, cache: 0.5, aot: 0.5 },
  },
  {
    id: "bundle",
    aliases: ["bundle", "treeshaking", "tree shaking", "tamanho", "size", "csp", "browser", "navegador", "edge"],
    terms: ["bundle", "treeshaking", "imports", "csp", "browser", "edge"],
    apis: [],
    fact: "Runtime JIT needs globalThis.Function, which strict Content Security Policy often blocks, and it also ships the schema builders and compiler. AOT does that work during the build and emits only ordinary JavaScript, so the bundle carries the generated functions and nothing else.",
    factPt:
      "O JIT em runtime precisa de globalThis.Function, que uma Content Security Policy estrita costuma bloquear, e além disso embarca os builders de schema e o compilador. O AOT faz esse trabalho durante o build e emite JavaScript comum, então o bundle carrega as funções geradas e mais nada.",
    mechanisms: [
      "The emitted module has zero runtime imports: the error class and helpers are inlined, so a bundler cannot accidentally pull the engine back in.",
      "Only the artifacts a declaration file names are emitted, so an operation the application never imports is never generated and never bundled.",
      "Because nothing compiles at runtime, the output needs no `globalThis.Function` and runs under strict CSP and on edge runtimes.",
    ],
    mechanismsPt: [
      "O módulo emitido tem zero imports de runtime: a classe de erro e os helpers são inlinados, então um bundler não tem como puxar o motor de volta sem querer.",
      "Só os artefatos que um arquivo de declaração nomeia são emitidos, então uma operação que a aplicação nunca importa nunca é gerada nem empacotada.",
      "Como nada compila em runtime, a saída não precisa de `globalThis.Function` e roda sob CSP estrita e em edge runtimes.",
    ],
    example:
      '// declared in a .jit.ts file, generated at build time\nimport { JIT } from "@jit-compiler/jit/define";\n\nexport const User = JIT.object({ email: JIT.string().email() });\nexport const isUser = JIT.validate.is(User);\n\n// the emitted module imports nothing, so it runs under a strict CSP:\n//   import { isUser } from "./generated/index.js";',
    page: "/docs/guides/browser-and-edge",
    edges: { aot: 0.7 },
  },
  {
    id: "schema-boundaries",
    aliases: ["input", "output", "update", "default", "readonly", "hydrate", "hidratar", "atualização"],
    terms: ["input", "typeof", "update", "default", "readonly", "hydrate"],
    apis: ["parse", "update", "class"],
    fact: "Input describes a boundary value before defaults are resolved, Typeof describes resolved state, and Update is an immutable patch that omits readonly fields. Runtime-class hydrate validates complete persisted state and never fills missing defaults.",
    factPt:
      "Input descreve o valor de fronteira antes de resolver defaults, Typeof descreve o estado resolvido e Update é um patch imutável que omite campos readonly. O hydrate de runtime classes valida o estado persistido completo e nunca preenche defaults ausentes.",
    mechanisms: [
      "A defaulted object property is optional in Input but required in Typeof.",
      "optional and nullish preserve undefined/null in the output; default resolves undefined to the configured value.",
      "Readonly remains effective through transparent wrappers such as readonly().default(), so it cannot reappear in Update.",
      "create accepts the boundary input and resolves defaults; hydrate rejects incomplete persisted state instead of manufacturing data.",
    ],
    mechanismsPt: [
      "Uma propriedade de objeto com default é opcional em Input, mas obrigatória em Typeof.",
      "optional e nullish preservam undefined/null na saída; default resolve undefined para o valor configurado.",
      "Readonly continua efetivo através de wrappers transparentes como readonly().default(), então não reaparece em Update.",
      "create aceita o input de fronteira e resolve defaults; hydrate rejeita estado persistido incompleto em vez de fabricar dados.",
    ],
    example:
      'const User = JIT.object({ id: JIT.string().readonly().default("generated"), name: JIT.string() });\nconst parseUser = JIT.validate.parse(User);\n\nparseUser({ name: "Ada" }); // { id: "generated", name: "Ada" }',
    page: "/docs/concepts/schemas-and-types#input-output-and-updates",
    edges: { validation: 0.5, query: 0.2 },
  },
  {
    id: "query",
    aliases: ["query", "consulta", "filter", "filtro", "search", "buscar", "where", "sort", "ordenar", "aggregate"],
    terms: ["query", "filter", "projection", "orderby", "groupby", "iterator", "visitor", "fused", "physical plan"],
    apis: ["cqrs", "from"],
    fact: "A query builder compiles to one fused loop over the collection: filters and projections are lowered into a single pass with no intermediate arrays.",
    factPt:
      "Um query builder compila para um único laço fundido sobre a coleção: filtros e projeções descem para uma só passada, sem arrays intermediários.",
    mechanisms: [
      "Filters and projections are lowered into one loop: the query preallocates a single output array, writes by cursor and trims once.",
      "`count`, `sum`, `avg`, `min` and `max` allocate no output array at all. `count` and `sum` return zero for empty input; the other three return undefined.",
      "`.params(shape)` is for values supplied per call and `JIT.cqrs.const(value)` for a compiler literal; ordinary closure values become safe external bindings, and no untrusted value is interpolated into generated source.",
      "`unique` keeps first occurrences, `keyed` returns a Map, `groupBy` returns arrays per key, and `orderBy` performs a global sort.",
      "Mutation operators rebuild collections immutably and require a filter, so a full-table update cannot happen by accident.",
    ],
    mechanismsPt: [
      "Filtros e projeções descem para um único laço: a query pré-aloca um array de saída, escreve por cursor e corta uma vez no fim.",
      "`count`, `sum`, `avg`, `min` e `max` não alocam array de saída nenhum. `count` e `sum` devolvem zero para entrada vazia; os outros três devolvem undefined.",
      "`.params(shape)` é para valores passados por chamada e `JIT.cqrs.const(value)` para um literal de compilação; valores de closure comuns viram bindings externos seguros, e nenhum valor não confiável é interpolado no fonte gerado.",
      "`unique` mantém as primeiras ocorrências, `keyed` devolve um Map, `groupBy` devolve arrays por chave, e `orderBy` faz uma ordenação global.",
      "Operadores de mutação reconstroem coleções de forma imutável e exigem um filtro, então um update de tabela inteira não acontece por acidente.",
    ],
    example:
      'const Users = JIT.array(\n  JIT.object({ id: JIT.string(), role: JIT.string(), score: JIT.number() })\n);\n\nconst topAdmins = JIT.cqrs.query(Users)\n  .params({ minimumScore: JIT.number() })\n  .where((q, params) => q.and(q.eq("role", "admin"), q.gte("score", params.minimumScore)))\n  .select("id", "score");',
    page: "/docs/runtime/queries",
    edges: { binary: 0.4, lazy: 0.5, join: 0.5 },
  },
  {
    id: "join",
    aliases: [
      "join",
      "juncao",
      "junção",
      "relacionar",
      "combinar tabelas",
      "inner join",
      "left join",
      "semi join",
      "anti join",
    ],
    terms: ["join", "hash join", "indexed join", "left key", "right key", "multiplicity"],
    apis: ["cqrs"],
    fact: "A CQRS join states inner, left, semi or anti semantics while schema facts select a hash build or a reusable keyed index; generated code never performs a nested linear search.",
    factPt:
      "Um join CQRS declara a semântica inner, left, semi ou anti, enquanto os fatos do schema escolhem um hash build ou um índice keyed reutilizável; o código gerado nunca faz busca linear aninhada.",
    mechanisms: [
      "HashJoin builds the right Map once and scans the left once, giving expected O(n + m + k) instead of O(n*m).",
      "A right collection declared with .keyed(key) reuses its WeakMap-cached index, reducing repeated joins to expected O(n + k) after the first build.",
      "Compatible .ordered(key, direction) facts on both inputs select a two-cursor MergeJoin and allocate no access index.",
      "Inner and left emit stable { left, right } pairs; semi and anti return left rows directly and allocate no pair objects.",
    ],
    mechanismsPt: [
      "HashJoin monta o Map da direita uma vez e percorre a esquerda uma vez, chegando a O(n + m + k) esperado em vez de O(n*m).",
      "Uma coleção direita declarada com .keyed(key) reutiliza seu índice em WeakMap, reduzindo joins repetidos para O(n + k) esperado depois da primeira construção.",
      "Fatos .ordered(key, direction) compatíveis nas duas entradas selecionam MergeJoin com dois cursores e sem alocar índice de acesso.",
      "Inner e left emitem pares estáveis { left, right }; semi e anti devolvem as linhas da esquerda diretamente e não alocam objetos de par.",
    ],
    example:
      'const Order = JIT.object({ id: JIT.number(), customerId: JIT.string() });\nconst Customer = JIT.object({ id: JIT.string(), name: JIT.string() });\n\nconst joinOrders = JIT.cqrs.query(Order)\n  .join(JIT.array(Customer).keyed("id"))\n  .on("customerId", "id");\n\njoinOrders(\n  [{ id: 1, customerId: "c1" }],\n  [{ id: "c1", name: "Ada" }],\n);',
    page: "/docs/reference/functions/query#joins",
    edges: { query: 0.8, cqrs: 0.6, compilation: 0.5 },
  },
  {
    id: "distinct",
    aliases: ["distinct", "deduplicar", "dedup", "duplicados", "unique values"],
    terms: ["distinct", "deduplicate", "structural hash", "compound key", "adjacent comparison"],
    apis: ["cqrs"],
    fact: "CQRS distinct preserves the first row and selects scalar lookup, compound trie, structural hash/equality or ordered adjacent comparison from schema facts.",
    factPt:
      "O distinct de CQRS preserva a primeira linha e seleciona lookup escalar, trie composta, hash/equality estrutural ou comparação adjacente ordenada a partir dos fatos do schema.",
    mechanisms: [
      "distinct() hashes the complete schema value and confirms hash collisions with compiled equality; it never uses JSON.stringify as a key.",
      "distinct(fields...) emits direct property reads and a nested Map trie, avoiding a tuple, array or compound string allocation per row.",
      "A matching .ordered(key) fact replaces the key table with O(1)-state adjacent comparison.",
    ],
    mechanismsPt: [
      "distinct() calcula o hash do valor completo e confirma colisões com equality compilada; ele nunca usa JSON.stringify como chave.",
      "distinct(fields...) emite acessos diretos e uma trie de Map, evitando alocar tupla, array ou string composta por linha.",
      "Um fato .ordered(key) compatível substitui a tabela por comparação adjacente com estado O(1).",
    ],
    example:
      'const User = JIT.object({ tenantId: JIT.string(), id: JIT.number(), name: JIT.string() });\n\nconst distinctUsers = JIT.cqrs.query(User).distinct("tenantId", "id");\n\ndistinctUsers([\n  { tenantId: "a", id: 1, name: "Ada" },\n  { tenantId: "a", id: 1, name: "Duplicate" },\n]);',
    page: "/docs/reference/functions/query#operators",
    edges: { query: 0.8, compilation: 0.5 },
  },
  {
    id: "lazy",
    aliases: ["lazy", "preguiçoso", "iterator", "generator", "stream", "chunk", "progressive"],
    terms: ["lazy", "iterator", "asynciterator", "visitor", "chunk", "stream", "ndjson"],
    apis: ["stream"],
    fact: "Eager arrays are the default; lazy consumption is an explicit terminal contract. A compiled query reaches .to.iterator(), .to.asyncIterator(), .to.visitor() or .lazy(), and incremental operators include flatMap, take/takeWhile, drop/dropWhile, unique, chunk, window, pairwise, scan and groupAdjacentBy.",
    factPt:
      "Arrays eager são o padrão; consumo lazy é um contrato terminal explícito. Uma query compilada alcança .to.iterator(), .to.asyncIterator(), .to.visitor() ou .lazy(), e os operadores incrementais incluem flatMap, take/takeWhile, drop/dropWhile, unique, chunk, window, pairwise, scan e groupAdjacentBy.",
    mechanisms: [
      "The terminal call is what chooses the backend — the same query builder produces an eager array, an iterator, an async iterator or a visitor.",
      "A lazy backend never materializes the full result, which is what makes `take(10)` over a large source stop early instead of filtering everything first.",
      "`JIT.stream` is the sibling for data arriving in chunks: its boundary scanner keeps only the parser state needed to find complete values, so a token split across a chunk edge is resumed rather than rejected.",
    ],
    mechanismsPt: [
      "A chamada terminal é o que escolhe o backend — o mesmo query builder produz um array eager, um iterator, um async iterator ou um visitor.",
      "Um backend lazy nunca materializa o resultado completo, e é isso que faz `take(10)` sobre uma fonte grande parar cedo em vez de filtrar tudo antes.",
      "`JIT.stream` é o irmão para dados que chegam em chunks: seu boundary scanner guarda só o estado de parser necessário para achar valores completos, então um token cortado na borda de um chunk é retomado, não rejeitado.",
    ],
    example:
      'const Users = JIT.array(JIT.object({ id: JIT.string(), active: JIT.boolean() }));\n\nconst query = JIT.cqrs.query(Users)\n  .where((q) => q.eq("active", true))\n  .select("id")\n  .limit(10);\n\n// the terminal call chooses the backend\nconst rows = query.to.iterator();',
    page: "/docs/runtime/lazy-execution",
    edges: { query: 0.5, json: 0.4 },
  },
  {
    id: "cqrs",
    aliases: ["cqrs", "read model", "read-model", "query contract", "filtro dinamico", "filtro dinâmico", "api query"],
    terms: ["cqrs", "contract", "dynamic filter", "sort", "pagination", "standard query", "~query"],
    apis: ["cqrs"],
    fact: "JIT.cqrs keeps read-model contracts separate from transport input: static queries reuse the compiled QueryProgram, while an input definition compiles its allowed filters, sort fields and offset pagination into a bounded normalizer.",
    factPt:
      "JIT.cqrs separa o contrato do read model da entrada de transporte: queries estáticas reutilizam o QueryProgram compilado, enquanto uma definição de input compila filtros permitidos, campos de ordenação e paginação offset em um normalizador limitado.",
    mechanisms: [
      "JIT.cqrs.query(Model) is a callable declarative read query; successive .where() calls combine with AND, successive .params() calls accumulate their typed shape, repeated select/order use the last declaration, limits use the smallest bound, and runtime/AOT/~query share the canonical plan.",
      "JIT.cqrs.input(Model, options) declares the permitted dynamic surface. JIT.cqrs.parse(definition) emits a direct parser for known fields and operators, validates the structural budget, rejects duplicate sort/select fields, and never treats a client field name as generated source.",
      "Sort fields and offset limits are checked before a query plan is formed, so application code receives normalized conditions rather than reparsing transport syntax in a hot query loop.",
    ],
    mechanismsPt: [
      "JIT.cqrs.query(Model) cria uma query de leitura declarativa e chamável; chamadas .where() sucessivas combinam com AND, .params() acumula tipos, select/order repetidos usam a última declaração, limits usam o menor limite e runtime/AOT/~query compartilham o plano canônico.",
      "JIT.cqrs.input(Model, options) declara a superfície dinâmica permitida. JIT.cqrs.parse(definition) emite um parser direto para campos e operadores conhecidos, valida o orçamento estrutural, rejeita campos repetidos de sort/select e nunca trata um campo enviado pelo cliente como fonte gerada.",
      "Campos de ordenação e limites offset são checados antes de formar um plano de query, então a aplicação recebe condições normalizadas em vez de reprocessar sintaxe de transporte dentro do loop quente.",
    ],
    example:
      'const User = JIT.object({ id: JIT.string(), active: JIT.boolean(), score: JIT.number() });\n\nconst activeUsers = JIT.cqrs\n  .query(User)\n  .where((q) => q.eq("active", true))\n  .select("id", "score")\n  .orderBy("score", "desc")\n  .limit(10);\n\nconst Search = JIT.cqrs.input(User, {\n  filter: { active: ["eq"], score: ["gte"] },\n  sort: ["score"],\n  pagination: { type: "offset", defaultLimit: 20, maxLimit: 100 },\n});\nconst parseSearch = JIT.cqrs.parse(Search);',
    page: "/docs/reference/functions/query#cqrs",
    edges: { query: 0.8, compilation: 0.5, aot: 0.3 },
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
    factPt:
      "Rowsets binários guardam lotes grandes de objetos planos em memória de largura fixa, então um scan lê typed views em vez de percorrer objetos.",
    mechanismsPt: [
      "As linhas ficam em memória de largura fixa, então um scan lê typed views em vez de percorrer objetos e perseguir ponteiros.",
      "Strings de enum e literais, e booleanos, são comparados como códigos inteiros dentro dos laços de query, não como strings.",
      "Uniões discriminadas de objetos usam tags inteiras densas, então um scan de união é uma comparação de inteiro em vez de comparação de string.",
      "O modo colunar mantém máscaras e lanes tipadas por campo em um único buffer, e os scans gerados usam um índice-base de coluna em cache, sem cursor de linha.",
    ],
    example:
      'const Event = JIT.object({\n  id: JIT.string(),\n  kind: JIT.enum(["click", "view", "purchase"]),\n  amount: JIT.number(),\n});\n\n// packed into fixed-width memory and scanned as typed views\nconst Events = JIT.array(Event).binary();\n\nconst revenue = JIT.cqrs.query(Events).filter((q) => q.eq("kind", "purchase")).sum("amount");',
    page: "/docs/runtime/binary-rowsets",
    edges: { memory: 0.6, query: 0.5 },
  },
  {
    id: "json",
    aliases: ["json", "stringify", "serializar", "serialize", "serialization", "encode", "decode"],
    terms: ["json", "stringify", "parse", "chunks", "escape", "wire"],
    apis: ["json"],
    fact: "JIT.json compiles serialization from the known shape: JIT.json.stringify(User) bakes known keys and punctuation into the generated source, JIT.json.parse(User).validate() decodes with native JSON.parse and runs the compiled validator in the same execution function, and JIT.json.stringifyChunks emits bounded chunks for large arrays.",
    factPt:
      "JIT.json compila a serialização a partir do formato conhecido: JIT.json.stringify(User) grava chaves e pontuação conhecidas direto no fonte gerado, JIT.json.parse(User).validate() decodifica com o JSON.parse nativo e roda o validador compilado na mesma função de execução, e JIT.json.stringifyChunks emite chunks limitados para arrays grandes.",
    mechanisms: [
      "Known JSON keys and punctuation are baked into the generated source, so serializing does not re-discover the shape.",
      "Strings take a fast clean-string path and fall back to native escaping only when a character actually needs it.",
      "`JIT.json.parse(schema).validate()` fuses decode and validation into one execution function, but JSON parsing always materializes the decoded value — fused does not mean zero-allocation.",
      "`stringifyChunks(users, { chunkBytes })` yields bounded pieces instead of building one large string.",
    ],
    mechanismsPt: [
      "Chaves e pontuação JSON conhecidas são gravadas no fonte gerado, então serializar não redescobre o formato.",
      "Strings passam por um caminho rápido de string limpa e só caem no escape nativo quando algum caractere realmente exige.",
      "`JIT.json.parse(schema).validate()` funde decode e validação em uma função de execução, mas o parse de JSON sempre materializa o valor decodificado — fundido não quer dizer sem alocação.",
      "`stringifyChunks(users, { chunkBytes })` devolve pedaços limitados em vez de montar uma string gigante.",
    ],
    example:
      "const User = JIT.object({ id: JIT.string(), email: JIT.string().email() });\n\nconst toJson = JIT.json.stringify(User);\nconst fromJson = JIT.json.parse(User).validate();\n\n// bounded chunks for a large array\nconst toChunks = JIT.json.stringifyChunks(JIT.array(User), { chunkBytes: 16 * 1024 });",
    page: "/docs/runtime/serialization",
    edges: { codec: 0.5, lazy: 0.3 },
  },
  {
    id: "codec",
    aliases: ["codec", "wire", "binary format", "formato", "encode", "version", "versão"],
    terms: ["codec", "encode", "decode", "wire", "version", "bitmask"],
    apis: ["codec", "binary"],
    fact: "Two different APIs share the word codec. JIT.codec(input, output, { decode, encode }) defines a value transformation inside a schema, for when the input and output TypeScript types differ. JIT.binary.codec(schema, { version }) compiles a binary transport, exposing encode, encodeInto and decode.",
    factPt:
      "Duas APIs diferentes dividem a palavra codec. JIT.codec(entrada, saida, { decode, encode }) define uma transformação de valor dentro de um schema, para quando os tipos TypeScript de entrada e saída diferem. JIT.binary.codec(schema, { version }) compila um transporte binário, expondo encode, encodeInto e decode.",
    mechanisms: [
      "In a value codec the input and output schemas make the direction explicit: decode/parse goes input to output, encode goes back.",
      "The binary wire format is versioned by its first byte, and that byte is a breaking-change boundary: decoder and encoder must agree on schema contract and version.",
      "Object optionals use a compact presence bitmask, integers are range-guarded and strings are UTF-8 length prefixed.",
      "`encodeInto(value, target)` reuses caller-owned memory, which matters in a high-frequency socket loop where allocating a Uint8Array per message is measurable.",
      "Binary rowsets are not codec payloads and must not be persisted as such — rowsets optimize process-local query memory and may change layout independently.",
    ],
    mechanismsPt: [
      "Num codec de valor os schemas de entrada e saída tornam a direção explícita: decode/parse vai da entrada para a saída, encode volta.",
      "O formato binário é versionado pelo primeiro byte, e esse byte é uma fronteira de breaking change: decoder e encoder precisam concordar em contrato de schema e versão.",
      "Opcionais de objeto usam uma bitmask compacta de presença, inteiros têm guarda de faixa e strings levam prefixo de comprimento UTF-8.",
      "`encodeInto(value, target)` reusa memória do chamador, o que importa num laço de socket de alta frequência onde alocar um Uint8Array por mensagem é mensurável.",
      "Rowsets binários não são payloads de codec e não devem ser persistidos como tal — rowsets otimizam memória de query local ao processo e podem mudar de layout de forma independente.",
    ],
    example:
      "// a value codec: the input and output TypeScript types differ\nconst IsoDate = JIT.codec(JIT.iso.datetime(), JIT.date(), {\n  decode: (value) => new Date(value),\n  encode: (value) => value.toISOString(),\n});\n\n// a binary transport, which is a different API\nconst Event = JIT.object({ id: JIT.string(), amount: JIT.number() });\nconst EventWire = JIT.binary.codec(Event, { version: 2 });",
    page: "/docs/reference/functions/codec",
    edges: { json: 0.4 },
  },
  {
    id: "security",
    aliases: ["mask", "mascarar", "pii", "redact", "sanitize", "sanitizar", "xss", "security", "segurança", "log"],
    terms: ["mask", "sanitize", "pii", "redact", "xss", "policy", "leak"],
    apis: ["security", "format"],
    fact: "Fields marked with .pii() or .sanitize() are rebuilt into a safe copy; only paths containing a marked field are touched, and untouched subtrees are shared by reference.",
    factPt:
      "Campos marcados com .pii() ou .sanitize() são reconstruídos em uma cópia segura; só os caminhos que contêm um campo marcado são tocados, e subárvores intocadas são compartilhadas por referência.",
    mechanisms: [
      "The marking lives on the declaration, so every path that masks this shape agrees about what is sensitive — the miss-one-call-site failure cannot happen.",
      "`JIT.security.mask` hides; `JIT.security.sanitize` cleans untrusted input. Both are compiled from the same marks.",
      "Sanitization runs inside the same specialized pass as validation, so a value is not traversed twice.",
      "Masking is surgical: only paths containing a marked field are rebuilt, and everything else is shared by reference rather than deep-copied.",
    ],
    mechanismsPt: [
      "A marcação vive na declaração, então todo caminho que mascara esse formato concorda sobre o que é sensível — a falha de esquecer um call site não tem como acontecer.",
      "`JIT.security.mask` esconde; `JIT.security.sanitize` limpa entrada não confiável. Os dois são compilados a partir das mesmas marcas.",
      "A sanitização roda dentro da mesma passada especializada da validação, então o valor não é percorrido duas vezes.",
      "O mascaramento é cirúrgico: só caminhos que contêm campo marcado são reconstruídos, e o resto é compartilhado por referência em vez de copiado.",
    ],
    example:
      "const User = JIT.object({\n  id: JIT.string().uuid(),\n  email: JIT.string().email().pii(),\n  name: JIT.string(),\n});\n\n// marked once on the declaration, applied everywhere\nconst safeForLogs = JIT.security.mask(User);",
    page: "/docs/reference/functions/mask",
    edges: { boundary: 0.5, validation: 0.3 },
  },
  {
    id: "boundary",
    aliases: ["boundary", "borda", "api", "endpoint", "request", "requisição", "input", "entrada", "dto"],
    terms: ["boundary", "inbound", "outbound", "dto", "whitelist", "payload"],
    apis: ["dto", "map", "transform"],
    fact: "At an application boundary the untrusted payload is decoded and validated in one compiled step: JIT.json.parse(CreateUser).validate() takes the raw request text and returns a typed value. A .strict() object rejects unknown keys, which is what catches client and server drifting apart.",
    factPt:
      "Na borda da aplicação o payload não confiável é decodificado e validado em um passo compilado: JIT.json.parse(CreateUser).validate() recebe o texto cru da requisição e devolve um valor tipado. Um objeto .strict() rejeita chaves desconhecidas, e é isso que pega cliente e servidor saindo de sincronia.",
    mechanisms: [
      "Inbound: `JIT.json.parse(Schema).validate()` decodes with native JSON.parse and runs the compiled validator in the same execution function.",
      "`.strict()` rejects unknown keys, so a field the client renamed fails loudly instead of arriving as undefined.",
      "Normalizing checks — `.trim()`, `.toLowerCase()` — run as part of the same pass, so a value is cleaned and validated in one traversal.",
      "Outbound: `JIT.dto` and `JIT.map` whitelist the destination shape, so a field added to the model does not silently start being returned.",
      "Keep a calendar date as a calendar string or decode it to Temporal.PlainDate; inventing a UTC midnight Date is the classic boundary bug.",
    ],
    mechanismsPt: [
      "Entrada: `JIT.json.parse(Schema).validate()` decodifica com o JSON.parse nativo e roda o validador compilado na mesma função de execução.",
      "`.strict()` rejeita chaves desconhecidas, então um campo que o cliente renomeou falha alto em vez de chegar como undefined.",
      "Checagens de normalização — `.trim()`, `.toLowerCase()` — rodam na mesma passada, então o valor é limpo e validado em uma travessia.",
      "Saída: `JIT.dto` e `JIT.map` fazem whitelist do formato de destino, então um campo novo no modelo não começa a vazar sozinho na resposta.",
      "Mantenha uma data de calendário como string de calendário ou decodifique para Temporal.PlainDate; inventar um Date à meia-noite UTC é o bug clássico de borda.",
    ],
    example:
      "const CreateUser = JIT.object({\n  name: JIT.string().trim().min(2).max(80),\n  email: JIT.string().trim().toLowerCase().email(),\n}).strict();\n\n// decode and validate in one compiled step; strict keys catch drift\nconst parseBody = JIT.json.parse(CreateUser).validate();",
    page: "/docs/guides/boundary-recipes",
    edges: { validation: 0.6, security: 0.4 },
  },
  {
    id: "update",
    aliases: ["update", "atualizar", "patch", "immutable", "imutável", "state", "estado", "reactive", "draft"],
    terms: ["update", "patch", "immutable", "draft", "reactive", "watch"],
    apis: ["update", "watch", "watchedList"],
    fact: "JIT.update(User) compiles an updater that applies a partial patch immutably: only changed branches are allocated, and unchanged children retain their identity.",
    factPt:
      "JIT.update(User) compila um updater que aplica um patch parcial de forma imutável: só os ramos alterados são alocados, e filhos inalterados mantêm sua identidade.",
    mechanisms: [
      "Only the paths a patch touches are rebuilt; every other subtree is the same object reference it was before, which is what makes an identity check enough to skip work downstream.",
      "There is no Proxy and no draft to finalize: the updater is generated from the known shape, so the patch is applied by direct field writes.",
      "`JIT.watch` and `JIT.watchedList` cover keyed collection changes — stateless snapshot diffs and stateful aggregates respectively.",
    ],
    mechanismsPt: [
      "Só os caminhos que o patch toca são reconstruídos; toda outra subárvore continua sendo a mesma referência de antes, e é isso que faz uma comparação de identidade bastar para pular trabalho adiante.",
      "Não há Proxy nem draft para finalizar: o updater é gerado a partir do formato conhecido, então o patch é aplicado por escrita direta de campo.",
      "`JIT.watch` e `JIT.watchedList` cobrem mudanças em coleções com chave — diffs de snapshot sem estado e agregados com estado, respectivamente.",
    ],
    example:
      'const User = JIT.object({\n  id: JIT.string(),\n  profile: JIT.object({ name: JIT.string(), city: JIT.string() }),\n});\n\nconst updateUser = JIT.update(User);\n\n// only the branches the patch touches are rebuilt\nconst next = updateUser(current, { profile: { name: "Grace" } });',
    page: "/docs/runtime/reactive-updates",
    edges: { compare: 0.5 },
  },
  {
    id: "compare",
    aliases: ["equal", "igual", "compare", "comparar", "diff", "hash", "clone", "clonar", "copy", "cópia"],
    terms: ["equal", "diff", "hash", "clone", "structural", "identity"],
    apis: ["compare", "clone"],
    fact: "JIT.compare.equal(schema) emits equality code from the known shape: objects use direct field access, arrays use indexed loops, tuples unroll fixed positions, and tagged unions dispatch on the tag before comparing variant fields. JIT.compare.diff reports the paths that differ and JIT.compare.hash produces a structural fingerprint.",
    factPt:
      "JIT.compare.equal(schema) emite código de igualdade a partir do formato conhecido: objetos usam acesso direto a campo, arrays usam laços indexados, tuplas desenrolam posições fixas, e uniões com tag despacham pela tag antes de comparar os campos da variante. JIT.compare.diff reporta os caminhos que diferem e JIT.compare.hash produz uma impressão digital estrutural.",
    mechanisms: [
      "Equality returns on the first difference and allocates no result object — there is no key enumeration because the keys were known when the function was written.",
      "A tagged union dispatches on its discriminant first, so mismatched variants cost one comparison instead of a field-by-field walk.",
      "`diff` gives the paths that changed, so a caller can act on what differed rather than only on the fact that something did.",
      "`hash` is the cheap way to skip repeated comparisons, and `.keyed(key)` or `.indexBy(key)` turn equality over a large keyed array into indexed lookup. The structural hash cache goes stale if a value is mutated in place.",
      "`JIT.clone` is the same idea for copying: a shape-specialized deep clone rather than a generic walk.",
    ],
    mechanismsPt: [
      "A igualdade retorna na primeira diferença e não aloca objeto de resultado — não há enumeração de chaves porque as chaves eram conhecidas quando a função foi escrita.",
      "Uma união com tag despacha primeiro pelo discriminante, então variantes diferentes custam uma comparação em vez de uma varredura campo a campo.",
      "`diff` dá os caminhos que mudaram, então quem chama pode agir sobre o que diferiu, não só sobre o fato de algo ter diferido.",
      "`hash` é o jeito barato de pular comparações repetidas, e `.keyed(key)` ou `.indexBy(key)` transformam igualdade sobre um array grande com chave em lookup indexado. O cache de hash estrutural fica obsoleto se um valor for mutado no lugar.",
      "`JIT.clone` é a mesma ideia para cópia: um deep clone especializado no formato, em vez de uma varredura genérica.",
    ],
    example:
      "const Order = JIT.object({\n  id: JIT.string(),\n  lines: JIT.array(JIT.object({ sku: JIT.string(), quantity: JIT.number() })),\n});\n\nconst same = JIT.compare.equal(Order);\nconst changes = JIT.compare.diff(Order);\nconst fingerprint = JIT.compare.hash(Order);",
    page: "/docs/reference/functions/equal",
    edges: { update: 0.4 },
  },
  {
    id: "errors",
    aliases: ["error", "erro", "issue", "exception", "throw", "falha", "fail"],
    terms: ["issue", "issues", "error", "path", "code", "message"],
    apis: ["validate"],
    fact: "JIT.validate.parse throws JITValidationError on failure. JIT.validate.safeParse returns a success union instead, and its failure carries a structured issue vector where each issue has a path, a code and a message. JIT.validate.issues returns that vector directly.",
    factPt:
      "JIT.validate.parse lança JITValidationError quando falha. JIT.validate.safeParse devolve uma união de sucesso no lugar, e a falha carrega um vetor estruturado de issues onde cada issue tem um path, um code e uma message. JIT.validate.issues devolve esse vetor diretamente.",
    mechanisms: [
      "An issue's `path` locates the offending field inside the value, which is what lets a form map an error back to an input.",
      "`code` is the machine-readable reason and `message` the human one; a custom message can be passed to most checks as their last argument.",
      "`is` reports nothing at all — it returns on the first failure without building the vector, which is why it is the hot-path choice.",
      "Building the issue vector is the cost `safeParse` pays over `is`; where the schema cannot rebuild its input, `safeParse` leads with the allocation-free check first.",
    ],
    mechanismsPt: [
      "O `path` de uma issue localiza o campo problemático dentro do valor, e é isso que permite a um formulário mapear o erro de volta para um input.",
      "`code` é o motivo legível por máquina e `message` o legível por humano; uma mensagem customizada pode ser passada para a maioria dos checks como último argumento.",
      "`is` não reporta nada — retorna na primeira falha sem montar o vetor, e é por isso que é a escolha de caminho quente.",
      "Montar o vetor de issues é o custo que `safeParse` paga a mais que `is`; onde o schema não precisa reconstruir a entrada, o `safeParse` começa pela checagem sem alocação.",
    ],
    example:
      'const User = JIT.object({ email: JIT.string().email(), age: JIT.number().int() });\n\nconst result = JIT.validate.safeParse(User)({ email: "nope", age: 1.5 });\n\nif (!result.success) {\n  // each issue carries a path, a code and a message\n  for (const issue of result.issues) console.log(issue.path, issue.code, issue.message);\n}',
    page: "/docs/reference/functions/validation",
    edges: { validation: 0.7 },
  },
  {
    id: "cache",
    aliases: ["cache", "identity", "identidade", "reuse", "reaproveitar", "invalidate"],
    terms: ["cache", "identity", "hash", "invalidation", "compiled"],
    apis: [],
    fact: "jit has three independent ways to avoid repeated work: the compile cache reuses generated functions keyed by schema identity, the structural hash cache reuses the hash of an object reference, and the collection index cache reuses a Map for one array and one key. None of them is a query-result cache — calling the same compiled query twice still executes it twice.",
    factPt:
      "A jit tem três formas independentes de evitar trabalho repetido: o cache de compilação reusa funções geradas, com chave na identidade do schema; o cache de hash estrutural reusa o hash de uma referência de objeto; e o cache de índice de coleção reusa um Map para um array e uma chave. Nenhum deles é cache de resultado de query — chamar a mesma query compilada duas vezes ainda a executa duas vezes.",
    mechanisms: [
      "The compile cache is keyed by schema identity, so reusing one declaration reuses every function compiled from it; building a fresh schema per request reuses nothing.",
      "The structural hash cache fits repeated comparisons of immutable values, and mutating a value in place makes its cached hash stale.",
      "The collection index cache fits repeated equality over large keyed arrays, and requires the array and key fields to stay immutable.",
      "Compilation caching removes code-generation work; hashes and indexes remove repeated traversal work. They are different costs and are cached separately.",
    ],
    mechanismsPt: [
      "O cache de compilação tem chave na identidade do schema, então reusar uma declaração reusa toda função compilada dela; criar um schema novo por requisição não reusa nada.",
      "O cache de hash estrutural serve para comparações repetidas de valores imutáveis, e mutar um valor no lugar deixa o hash em cache obsoleto.",
      "O cache de índice de coleção serve para igualdade repetida sobre arrays grandes com chave, e exige que o array e os campos-chave permaneçam imutáveis.",
      "O cache de compilação elimina trabalho de geração de código; hashes e índices eliminam trabalho de travessia repetida. São custos diferentes e são cacheados separadamente.",
    ],
    example:
      "// ONE declaration, reused — this is what the compile cache is keyed by\nconst User = JIT.object({ id: JIT.string() });\n\nconst isUser = JIT.validate.is(User);\nconst sameUser = JIT.compare.equal(User);\n\n// declaring a fresh schema per request reuses nothing and recompiles every time",
    page: "/docs/runtime/cache-hash-index",
    edges: { runtime: 0.5 },
  },
  {
    id: "access-control",
    aliases: ["access", "authorization", "authorize", "permission", "ability", "autorização", "permissão"],
    terms: ["access", "authorization", "default deny", "constraint", "projection", "mutation"],
    apis: ["JIT.access", "authorize", "assert", "explain", "fields"],
    fact: "JIT.access compiles default-deny can/cannot rules into direct action checks, and the same AccessPlan lowers into CQRS predicates, field projections, and mutation guards without a rule walker at runtime or any access-specific node in ~query.",
    factPt:
      "JIT.access compila regras can/cannot com default deny em checks diretos por action, e o mesmo AccessPlan baixa para predicados CQRS, projeções de campos e guards de mutação sem rule walker em runtime nem nó específico de access em ~query.",
    mechanisms: [
      "can() dispatches through a generated switch and cannot() is its exact negation; explain() and fields() are separate allocating paths.",
      "query.authorize() turns actor references into ordinary bindings and combines the permission predicate with where() in the same QueryProgram.",
      "JIT.project(...).authorize(...) emits direct conditional assignments, while authorized updates inspect only fields present in the patch before mutation.",
      "Unconditional allow disappears from a query, unconditional deny becomes an empty query, and ~query stays at version 1 with only ordinary query semantics.",
    ],
    mechanismsPt: [
      "can() despacha por um switch gerado e cannot() é sua negação exata; explain() e fields() são caminhos alocantes separados.",
      "query.authorize() transforma referências ao actor em bindings comuns e combina o predicado de permissão com where() no mesmo QueryProgram.",
      "JIT.project(...).authorize(...) emite atribuições condicionais diretas, enquanto updates autorizados inspecionam apenas os campos presentes no patch antes da mutação.",
      "Allow incondicional desaparece da query, deny incondicional vira query vazia, e ~query permanece V1 somente com semântica normal de query.",
    ],
    example:
      'const Actor = JIT.object({ id: JIT.number() });\nconst Post = JIT.object({ id: JIT.number(), authorId: JIT.number(), title: JIT.string() });\nconst access = JIT.access(Post).actor(Actor).can("read", (query, actor) => query.eq("authorId", actor.field("id")));\nconst ability = access({ id: 1 });\nconst read = JIT.cqrs.query(Post).authorize(ability, "read").select("id", "title");\n\nconsole.log(read([{ id: 1, authorId: 1, title: "draft" }, { id: 2, authorId: 2, title: "other" }]));',
    page: "/docs/reference/functions/access",
    edges: { query: 0.7 },
  },
  {
    id: "jsonschema",
    aliases: ["json schema", "jsonschema", "openapi", "swagger", "contract", "contrato", "draft"],
    terms: ["jsonschema", "openapi", "draft", "document", "dialect", "ref"],
    apis: ["jsonSchema"],
    fact: "JIT.jsonSchema bridges both directions so a contract has one source of truth whichever side it starts on: JIT.jsonSchema.to(Schema) produces a document, and JIT.jsonSchema.from(document) produces a schema.",
    factPt:
      "JIT.jsonSchema faz a ponte nos dois sentidos, para que um contrato tenha uma única fonte de verdade venha de que lado vier: JIT.jsonSchema.to(Schema) produz um documento, e JIT.jsonSchema.from(documento) produz um schema.",
    mechanisms: [
      "`to` derives the document from the declaration that already validates the request, so the published contract cannot describe something the endpoint does not enforce.",
      "`from` reads an existing published contract back into a schema, which is what makes it usable rather than something to copy by hand.",
      "Checks carry across: a `.email()` or an `.int32().positive()` becomes the corresponding constraint in the document instead of being lost.",
    ],
    mechanismsPt: [
      "`to` deriva o documento da mesma declaração que já valida a requisição, então o contrato publicado não tem como descrever algo que o endpoint não exige.",
      "`from` lê um contrato já publicado de volta para um schema, e é isso que o torna utilizável em vez de algo para copiar à mão.",
      "Os checks atravessam: um `.email()` ou um `.int32().positive()` vira a restrição correspondente no documento, em vez de se perder.",
    ],
    example:
      "const CreateUser = JIT.object({\n  email: JIT.string().email(),\n  age: JIT.number().int().min(18),\n});\n\n// the same declaration that validates the request describes it\nconst document = JIT.jsonSchema.to(CreateUser);\n\n// and an existing contract can come back the other way\nconst fromContract = JIT.jsonSchema.from(document);",
    page: "/docs/reference/functions/json-schema",
    edges: { schema: 0.5 },
  },
  {
    id: "migration",
    aliases: ["migrate", "migrar", "migração", "upgrade", "atualizar versão", "2.0", "breaking", "removed", "removido"],
    terms: ["migrating", "removed", "replaced", "legacy", "facade"],
    apis: [],
    fact: "2.0 removed the JIT.validator, JIT.model, JIT.mapper and JIT.serializer facades. Each operation is a callable artifact, and an aggregate is a plain object of artifacts.",
    factPt:
      "A 2.0 removeu as fachadas JIT.validator, JIT.model, JIT.mapper e JIT.serializer. Cada operação é um artefato chamável, e um agregado é um objeto simples de artefatos.",
    mechanisms: [
      "`JIT.validator(User)` became the `JIT.validate.*` namespace: `is`, `parse`, `safeParse`, `issues`, `async`.",
      "`JIT.compare.equal`, `JIT.compare.diff` and `JIT.compare.hash` remain the canonical structural leaves; their `.compile()` call is optional warm-up.",
      "`JIT.mask` and `JIT.sanitize` became `JIT.security.mask` and `JIT.security.sanitize`.",
      "An aggregate is now written as an ordinary object literal of artifacts rather than through a facade constructor.",
      "Names that appear only in the migration guide are counter-examples, not usable code.",
    ],
    mechanismsPt: [
      "`JIT.validator(User)` virou o namespace `JIT.validate.*`: `is`, `parse`, `safeParse`, `issues`, `async`.",
      "`JIT.compare.equal`, `JIT.compare.diff` e `JIT.compare.hash` continuam sendo as operações estruturais canônicas; `.compile()` é apenas aquecimento opcional.",
      "`JIT.mask` e `JIT.sanitize` viraram `JIT.security.mask` e `JIT.security.sanitize`.",
      "Um agregado agora é escrito como um objeto literal comum de artefatos, não por um construtor de fachada.",
      "Nomes que aparecem só no guia de migração são contraexemplos, não código utilizável.",
    ],
    example:
      "// 2.0 — one callable artifact per operation\nconst User = JIT.object({ id: JIT.string() });\n\nconst isUser = JIT.validate.is(User); // was JIT.validator(User).is\nconst sameUser = JIT.compare.equal(User);\nconst safeUser = JIT.security.mask(User); // was JIT.mask(User)\n\nconst artifacts = { isUser, sameUser, safeUser };",
    page: "/docs/guides/migrating-to-2",
    edges: { self: 0.3 },
  },
  {
    id: "workspace",
    aliases: ["workspace", "playground", "lab", "editor", "run", "rodar", "executar", "try", "testar"],
    terms: ["workspace", "editor", "run", "generate", "artifact"],
    apis: [],
    fact: "The workspace runs a schema against real values, or generates the import-free module plus a signed reference the CLI can pull into a project.",
    factPt:
      "O workspace roda um schema contra valores reais, ou gera o módulo sem imports mais uma referência assinada que o CLI consegue puxar para dentro de um projeto.",
    mechanisms: [
      "Run executes the schema in the browser against the values in the input pane; Generate produces the import-free module. They are buttons in the workspace, not methods on a schema.",
      "The editor holds an ordinary module that imports JIT from `@jit-compiler/jit/runtime`, so what runs there is what would run in an application.",
    ],
    mechanismsPt: [
      "Run executa o schema no navegador contra os valores do painel de entrada; Generate produz o módulo sem imports. São botões do workspace, não métodos de um schema.",
      "O editor guarda um módulo comum que importa a JIT de `@jit-compiler/jit/runtime`, então o que roda ali é o que rodaria numa aplicação.",
    ],
    example:
      "// paste this into the workspace editor and press Run\nconst User = JIT.object({\n  id: JIT.string().uuid(),\n  email: JIT.string().email(),\n});\n\nconst isUser = JIT.validate.is(User);",
    page: "/workspace",
    edges: { aot: 0.5 },
  },
  {
    id: "comparison",
    aliases: ["zod", "valibot", "typebox", "typia", "ajv", "yup", "versus", "vs", "comparar com", "alternativa"],
    terms: ["zod", "valibot", "typebox", "typia", "comparison", "standard"],
    apis: [],
    fact: "There is no universally best schema library. The right choice depends on whether the primary artifact is a runtime schema, a small modular parser, a JSON Schema document, a transformed TypeScript type, or a family of compiled data operations — which is jit's answer.",
    factPt:
      "Não existe uma melhor biblioteca de schema universal. A escolha certa depende de qual é o artefato principal: um schema em runtime, um parser pequeno e modular, um documento JSON Schema, um tipo TypeScript transformado, ou uma família de operações de dados compiladas — que é a resposta da jit.",
    mechanisms: [
      "Zod 4 and Valibot are schema-first with no default compiler; TypeBox has a compiler available; Typia is type-first and compiles ahead of time as its primary model.",
      "jit is schema-first, supports runtime and dynamic schema creation, and compiles specialized code ahead of time as well — the combination is what distinguishes it rather than any single row.",
      "jit's differentiator is breadth over one declaration: not just validation but equality, cloning, diffing, queries, masking, serialization and a binary codec from the same schema.",
      "If validation is all you need and it is not in your profile, the reason to move is the shared-declaration argument, not speed.",
    ],
    mechanismsPt: [
      "Zod 4 e Valibot são schema-first sem compilador por padrão; TypeBox tem um compilador disponível; Typia é type-first e compila ahead-of-time como modelo principal.",
      "A jit é schema-first, suporta criação de schema em runtime e dinâmica, e também compila código especializado em build time — é a combinação que a distingue, não uma linha isolada.",
      "O diferencial da jit é abrangência sobre uma declaração: não só validação, mas igualdade, clonagem, diff, queries, mascaramento, serialização e um codec binário a partir do mesmo schema.",
      "Se validação é tudo que você precisa e ela não aparece no seu profile, o motivo para mudar é o argumento da declaração compartilhada, não velocidade.",
    ],
    example:
      "// jit's distinguishing move: many operations from ONE declaration\nconst User = JIT.object({ id: JIT.string(), email: JIT.string().email() });\n\nconst isUser = JIT.validate.is(User);      // what a validator library gives you\nconst sameUser = JIT.compare.equal(User);  // and a deep-equal library\nconst cloneUser = JIT.clone(User);         // and a clone library\nconst toJson = JIT.json.stringify(User);   // and a serializer",
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
    factPt:
      "A jit se instala como o pacote npm @jit-compiler/jit; schemas são escritos contra `@jit-compiler/jit/runtime`, e um arquivo que a geração AOT lê importa de `@jit-compiler/jit/define`.",
    mechanisms: [
      "`pnpm add @jit-compiler/jit`, then import JIT from `@jit-compiler/jit/runtime` and declare a schema.",
      "`pnpm jit init` writes the AOT config and `jit generate` emits the module; the CLI subcommands are init, generate, watch, check and mcp.",
      "A declaration file that AOT reads imports from `@jit-compiler/jit/define` instead of `/runtime` — that import is what marks it as a generation source.",
    ],
    mechanismsPt: [
      "`pnpm add @jit-compiler/jit`, depois importe JIT de `@jit-compiler/jit/runtime` e declare um schema.",
      "`pnpm jit init` escreve a config do AOT e `jit generate` emite o módulo; os subcomandos do CLI são init, generate, watch, check e mcp.",
      "Um arquivo de declaração que o AOT lê importa de `@jit-compiler/jit/define` em vez de `/runtime` — esse import é o que o marca como fonte de geração.",
    ],
    example:
      '// pnpm add @jit-compiler/jit\nimport { JIT } from "@jit-compiler/jit/runtime";\n\nconst User = JIT.object({\n  id: JIT.string().uuid(),\n  email: JIT.string().email(),\n});\n\nconst isUser = JIT.validate.is(User);',
    page: "/docs/quick-start",
    edges: { self: 0.4, aot: 0.3 },
  },
  {
    id: "schema-migration",
    aliases: [
      "schema migration",
      "event migration",
      "version chain",
      "jit migrate",
      "migrar evento",
      "versão do evento",
    ],
    terms: ["migrate", "version", "mapper", "event", "switch"],
    apis: ["migrate"],
    fact: "JIT.migrate compiles versioned object schemas into one switch; each .to() edge reuses MapperPlan, old inputs run only the remaining edges, and current-version input returns by reference.",
    factPt:
      "JIT.migrate compila schemas de objeto versionados em um switch; cada edge .to() reutiliza MapperPlan, entradas antigas rodam só os edges restantes e a versão atual volta por referência.",
    mechanisms: [
      "Every schema declares a string or number literal field named version, so dispatch is known before execution.",
      "The input type is the union of every declared version and the output type is always the current schema.",
      "Runtime and AOT emit the same switch and mapper bodies; there is no runtime edge registry.",
    ],
    mechanismsPt: [
      "Todo schema declara um campo literal version string ou number, então o dispatch é conhecido antes da execução.",
      "O tipo de entrada é a união de todas as versões declaradas e o tipo de saída é sempre o schema atual.",
      "Runtime e AOT emitem o mesmo switch e os mesmos mappers; não existe registry de edges em runtime.",
    ],
    example:
      'const V1 = JIT.object({ version: JIT.literal(1), name: JIT.string() });\nconst V2 = JIT.object({ version: JIT.literal(2), fullName: JIT.string() });\n\nconst migrate = JIT.migrate(V1).to(V2, { fullName: { from: "name" } });\n\nmigrate({ version: 1, name: "Ada" });',
    page: "/docs/reference/functions/migrate",
    edges: { compilation: 0.5, aot: 0.4 },
  },
  {
    id: "csv",
    aliases: ["csv", "comma separated", "arquivo csv", "planilha csv", "rfc 4180"],
    terms: ["csv", "rfc4180", "column", "delimiter", "quote", "visitor"],
    apis: ["csv"],
    fact: "JIT.csv parses RFC 4180 incrementally, converts known scalar columns, validates each row, and exposes result, iterator and visitor sinks plus schema-ordered stringify.",
    factPt:
      "JIT.csv faz parse incremental de RFC 4180, converte colunas escalares conhecidas, valida cada linha e expõe sinks result, iterator e visitor, além de stringify na ordem do schema.",
    mechanisms: [
      "A quote/CRLF/UTF-8 state machine survives arbitrary chunk boundaries; split(',') is never used.",
      "Headers resolve once, then generated code reads record positions and constructs the known row shape directly.",
      "Iterator and visitor do not retain a result array; AOT emits the scanner and validator without importing JIT.",
    ],
    mechanismsPt: [
      "Uma máquina de estados de quote/CRLF/UTF-8 sobrevive a cortes arbitrários de chunk; split(',') nunca é usado.",
      "O header é resolvido uma vez, depois o código gerado lê posições e constrói o formato conhecido diretamente.",
      "Iterator e visitor não retêm array de resultado; o AOT emite scanner e validator sem importar a JIT.",
    ],
    example:
      'const User = JIT.object({ id: JIT.number().int(), name: JIT.string() });\nconst parse = JIT.csv.parse(User);\n\nparse("id,name\\r\\n1,\\"Ada, Lovelace\\"");',
    page: "/docs/reference/functions/csv",
    edges: { lazy: 0.5, boundary: 0.4 },
  },
  {
    id: "ndjson",
    aliases: ["ndjson", "json lines", "jsonl", "line delimited json", "json por linha"],
    terms: ["ndjson", "jsonl", "line", "stream", "filter", "projection"],
    apis: ["ndjson"],
    fact: "JIT.ndjson validates one document per line and can fuse where, select and the NDJSON sink into one incremental pass without result or projection arrays.",
    factPt:
      "JIT.ndjson valida um documento por linha e pode fundir where, select e o sink NDJSON em uma passada incremental sem arrays de resultado ou projeção.",
    mechanisms: [
      "The UTF-8 line scanner retains only the current line, and iterator/visitor expose validated rows as they finish.",
      "Fused where conditions become direct field comparisons and ProjectionTree drives the serializer from the original row, avoiding a projected object.",
      "JIT.stream.ndjson remains the stateful write/end/items interface; JIT.ndjson is the callable reconstructive transport plan.",
    ],
    mechanismsPt: [
      "O scanner UTF-8 retém só a linha atual, e iterator/visitor expõem linhas validadas assim que terminam.",
      "Condições where fundidas viram comparações diretas e ProjectionTree dirige o serializer a partir da linha original, evitando objeto projetado.",
      "JIT.stream.ndjson continua sendo a interface stateful write/end/items; JIT.ndjson é o plano de transporte chamável e reconstruível.",
    ],
    example:
      'const Event = JIT.object({ id: JIT.number(), active: JIT.boolean() });\nconst activeIds = JIT.ndjson.parse(Event)\n  .where((q) => q.eq("active", true))\n  .select("id")\n  .to.ndjson();\n\nactiveIds("{\\"id\\":1,\\"active\\":true}\\n");',
    page: "/docs/reference/functions/ndjson",
    edges: { json: 0.6, lazy: 0.5, query: 0.4 },
  },
  {
    id: "mcp",
    aliases: ["mcp", "agent", "agente", "tool", "ferramenta", "claude", "cursor"],
    terms: ["mcp", "stdio", "tools", "resources", "prompts"],
    apis: [],
    fact: "@jit-compiler/jit ships jit-mcp, a local MCP stdio server that uses the same declaration discovery and generator as the CLI, keeping the agent workflow inspectable and scoped to the workspace.",
    factPt:
      "O @jit-compiler/jit inclui o jit-mcp, um servidor MCP local via stdio que usa a mesma descoberta de declarações e o mesmo gerador do CLI, mantendo o fluxo do agente inspecionável e restrito ao workspace.",
    mechanisms: [
      "It is configured as an mcpServers entry running `pnpm exec jit-mcp`, and needs no MCP SDK dependency of its own.",
      "The read-only tools cover project context, an AOT doctor, documentation search, declaration inspection and a generation preview; jit_api_surface reflects the real JIT namespace so an agent cannot invent a name.",
      "Writing is explicit: jit_aot_generate requires write=true, and previewing first is the read-only path.",
    ],
    mechanismsPt: [
      "É configurado como uma entrada em mcpServers rodando `pnpm exec jit-mcp`, e não precisa de dependência própria de SDK MCP.",
      "As ferramentas somente-leitura cobrem contexto de projeto, um doctor de AOT, busca na documentação, inspeção de declarações e preview de geração; jit_api_surface reflete o namespace JIT real para o agente não inventar nome.",
      "Escrever é explícito: jit_aot_generate exige write=true, e o preview é o caminho somente-leitura.",
    ],
    example:
      '// .mcp.json — the server uses the same generator as the CLI\n// {\n//   "mcpServers": { "jit": { "command": "pnpm", "args": ["exec", "jit-mcp"] } }\n// }\n\n// the schemas it inspects are ordinary declarations\nconst User = JIT.object({ id: JIT.string().uuid() });\nexport const isUser = JIT.validate.is(User);',
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
  node.aliases.map((alias) => ({
    words: alias.split(/\s+/).map(fold),
    id: node.id,
  }))
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
function questionWords(question: string): {
  words: string[];
  sentence: string;
} {
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
