import { fold } from "./tokenize";

/**
 * What to actually do about a problem.
 *
 * The rest of the pipeline answers questions about the library. This answers
 * questions about the reader's program — "meu array tem muitos registros e
 * filtrar está lento" is not a question about `JIT.cqrs.query`, and retrieval
 * cannot turn it into one, because the query page never uses the word "lento".
 * Someone who knows the library reads that sentence and immediately knows the
 * answer is a fused `JIT.cqrs.query`, and can say why.
 *
 * Each entry is that knowledge written down: the symptom in the words a reader
 * uses, the problem restated precisely, the combination of APIs that solves it,
 * a runnable example, and the mechanism behind it. The examples are executed
 * against the real library by the test suite, so an example that stops
 * compiling fails the build rather than reaching a reader.
 */

export interface Solution {
  id: string;
  /**
   * Word sets that identify the problem. Every word in a set must be present
   * for that set to fire; any set firing matches the solution. Written this
   * way because "lento" alone is not a query problem and "array" alone is not
   * a performance problem — it is the pair that means something.
   */
  triggers: string[][];
  /** The problem restated as the library sees it. */
  problem: string;
  /** The APIs that solve it, in the order they appear in the example. */
  apis: string[];
  /** Runnable, and verified to run. */
  example: string;
  /** Why this is the answer — the mechanism, not a claim. */
  why: string[];
  page: string;
}

export const SOLUTIONS: Solution[] = [
  {
    id: "deduplicate-object-array",
    triggers: [
      ["remover", "duplicados"],
      ["deduplicar", "array"],
      ["distinct", "object"],
      ["unique", "compound"],
    ],
    problem:
      "JSON.stringify and compound string keys allocate temporary data for every row, while repeated equality scans can become O(n²).",
    apis: ["JIT.cqrs.query", "distinct"],
    example: `import { JIT } from "@jit-compiler/jit/runtime";

const User = JIT.object({ tenantId: JIT.string(), id: JIT.number(), name: JIT.string() });
const distinctUsers = JIT.cqrs.query(User).distinct("tenantId", "id");

distinctUsers([
  { tenantId: "a", id: 1, name: "Ada" },
  { tenantId: "a", id: 1, name: "Duplicate" },
]);`,
    why: [
      "The compiler emits direct tenantId/id reads and a nested Map trie, so no tuple or compound string is allocated per row.",
      "For complete-row distinct, schema-specialized hash narrows candidates and compiled equality confirms collisions.",
      "A matching ordered fact lets the planner use adjacent comparison with O(1) retained deduplication state.",
    ],
    page: "/docs/reference/functions/query#operators",
  },
  {
    id: "nested-array-join",
    triggers: [
      ["join", "array"],
      ["join", "lento"],
      ["join", "slow"],
      ["find", "dentro", "loop"],
      ["relacionar", "lista"],
      ["combinar", "colecao"],
    ],
    problem:
      "Relating two arrays with find/filter inside the outer loop re-scans the right side for every left row, making the operation O(n*m).",
    apis: ["JIT.cqrs.query", "join", "on", "keyed"],
    example: `import { JIT } from "@jit-compiler/jit/runtime";

const Order = JIT.object({ id: JIT.number(), customerId: JIT.string() });
const Customer = JIT.object({ id: JIT.string(), name: JIT.string() });

const joinOrders = JIT.cqrs
  .query(Order)
  .join(JIT.array(Customer).keyed("id"))
  .on("customerId", "id");

joinOrders(
  [{ id: 1, customerId: "c1" }],
  [{ id: "c1", name: "Ada" }],
);`,
    why: [
      "A hash join builds the right access path once and scans the left once, replacing O(n*m) nested search with expected O(n + m + k).",
      "The keyed fact opts into a WeakMap-cached right index, so repeated calls over the same right array skip the build and cost expected O(n + k).",
      "If both inputs already declare compatible ordering, the planner uses two merge cursors and allocates no access index.",
      "The generated loop reads leftRow.customerId directly and contains no generic join dispatcher or per-left-row callback.",
    ],
    page: "/docs/reference/functions/query#joins",
  },
  {
    id: "slow-filter-large-collection",
    triggers: [
      ["lento", "filtr"],
      ["lentidao", "filtr"],
      ["devagar", "filtr"],
      ["slow", "filter"],
      ["array", "grande"],
      ["lista", "grande"],
      ["muito", "registro"],
      ["milhare", "item"],
      ["performance", "filter"],
      ["query", "lento"],
    ],
    problem:
      "Filtering a large collection with Array.prototype.filter allocates an intermediate array per stage and re-reads every element for each stage.",
    apis: ["JIT.cqrs.query", "where", "select"],
    example: `import { JIT } from "@jit-compiler/jit/runtime";

const Users = JIT.array(
  JIT.object({
    id: JIT.string(),
    role: JIT.string(),
    score: JIT.number(),
    email: JIT.string(),
  })
);

// one compiled pass: filter and projection are fused, no intermediate array
const findTopAdmins = JIT.cqrs.query(Users)
  .params({ minimumScore: JIT.number() })
  .where((q, params) => q.and(q.eq("role", "admin"), q.gte("score", params.minimumScore)))
  .select("id", "email");

findTopAdmins(users, { minimumScore: 50 });`,
    why: [
      "The filter and the projection are lowered into a single loop, so the collection is walked once instead of once per stage.",
      "No intermediate array is allocated: the query preallocates one output, writes by cursor and trims once at the end.",
      'The predicate is compiled to straight-line comparisons on known fields — `row.role === "admin"` — instead of calling a closure per element.',
      "This query remains a scan today; index and binary-search access paths are selected only after the physical-planner milestone can prove the predicate matches a declared fact.",
      "Aggregates go further: `.count()`, `.sum()`, `.avg()`, `.min()` and `.max()` allocate no output array at all.",
    ],
    page: "/docs/runtime/queries",
  },
  {
    id: "validation-in-hot-path",
    triggers: [
      ["validac", "lento"],
      ["validation", "slow"],
      ["valid", "hot"],
      ["valid", "aloca"],
      ["valid", "allocat"],
      ["validar", "rapido"],
      ["parse", "overhead"],
      ["gc", "valid"],
    ],
    problem:
      "Validation is on a hot path and the cost being paid is the issue vector — the structured error report is built whether or not anything is wrong.",
    apis: ["JIT.validate.is", "JIT.validate.safeParse", "JIT.validate.issues"],
    example: `import { JIT } from "@jit-compiler/jit/runtime";

const User = JIT.object({
  id: JIT.string().uuid(),
  email: JIT.string().email(),
  age: JIT.number().int().min(0),
});

// hot path: a type predicate, allocates nothing, returns on first failure
const isUser = JIT.validate.is(User);
if (isUser(payload)) {
  // payload is typed as the schema's output here
}

// boundary: you need to tell the caller what was wrong
const parseUser = JIT.validate.safeParse(User, { maxIssues: 100 });
const result = parseUser(payload);
if (!result.success) {
  result.issues; // path is PropertyKey[]; code drives logic; message is presentation
}`,
    why: [
      "`is` is a type predicate: it returns a boolean, allocates nothing, and stops at the first failing check.",
      "`safeParse` leads with that same allocation-free check wherever the schema cannot rebuild its input, and only pays for the annotated traversal when it actually has to report something.",
      "Checks inside both are ordered cheapest-first — typeof, then null, then numeric range, then length, then regex — so a value that fails on its type costs one comparison.",
      "Use `is` where you only need a yes or no, and `safeParse` where the caller needs the reason. Paying for issues you never read is the cost being described.",
      "At large untrusted boundaries, maxIssues bounds allocation and stops traversal at the limit rather than slicing a fully collected vector.",
    ],
    page: "/docs/runtime/validation",
  },
  {
    id: "pii-in-logs",
    triggers: [
      ["pii", "log"],
      ["dado", "sensivel"],
      ["mascarar", "campo"],
      ["mask", "log"],
      ["vazand", "dado"],
      ["leak", "log"],
      ["redact", "field"],
      ["lgpd"],
      ["gdpr"],
    ],
    problem:
      "Sensitive fields reach logs or an outbound response because masking is applied by hand at each call site, and one of them is always missed.",
    apis: ["pii", "JIT.security.mask", "JIT.security.sanitize"],
    example: `import { JIT } from "@jit-compiler/jit/runtime";

// the field is marked once, on the schema — not at each log call
const User = JIT.object({
  id: JIT.string().uuid(),
  email: JIT.string().email().pii(),
  document: JIT.string().pii(),
  name: JIT.string(),
});

const safeForLogs = JIT.security.mask(User);

logger.info(safeForLogs(user));`,
    why: [
      "The field is marked once on the declaration, so every path that masks this shape agrees about what is sensitive — the miss-one-call-site failure cannot happen.",
      "Masking is surgical: only the paths that contain a marked field are rebuilt, and untouched subtrees are shared by reference rather than deep-copied.",
      "`JIT.security.sanitize` is the sibling for untrusted input — the same marking mechanism, applied to cleaning rather than hiding.",
    ],
    page: "/docs/reference/functions/mask",
  },
  {
    id: "csp-and-bundle",
    triggers: [
      ["csp"],
      ["content", "security", "policy"],
      ["bundle", "grande"],
      ["bundle", "size"],
      ["edge", "runtime"],
      ["unsafe", "eval"],
      ["navegador", "compil"],
      ["browser", "compil"],
      ["cloudflare", "worker"],
    ],
    problem:
      "Runtime compilation needs `globalThis.Function`, which a strict Content Security Policy forbids, and it puts the compiler itself in the client bundle.",
    apis: ["jit init", "jit generate"],
    example: `// 1. declare what to generate, importing from /define rather than /runtime
import { JIT } from "@jit-compiler/jit/define";

export const User = JIT.object({
  id: JIT.string().uuid(),
  email: JIT.string().email(),
});

export const isUser = JIT.validate.is(User);

// 2. pnpm jit generate
// 3. import the emitted module — it has zero runtime imports
//    import { isUser } from "./generated/user";`,
    why: [
      "The same compiler runs, at build time instead of first use, and writes ordinary JavaScript or TypeScript to disk.",
      "The emitted module imports nothing: the error class and the runtime helpers are inlined, so the engine never reaches production.",
      "Because nothing is compiled at runtime, the output needs no `globalThis.Function` and runs under a strict CSP and on edge runtimes.",
      "Only the artifacts the declaration file names are emitted, so an operation the application never asks for is never generated and never bundled.",
    ],
    page: "/docs/guides/browser-and-edge",
  },
  {
    id: "detect-change",
    triggers: [
      ["detect", "mudanc"],
      ["detect", "chang"],
      ["compar", "estado"],
      ["compare", "state"],
      ["deep", "equal"],
      ["igual", "profund"],
      ["rerender", "desnecessari"],
      ["dirty", "check"],
      ["diff", "objeto"],
    ],
    problem:
      "Two versions of the same shape have to be compared, and a generic deep-equal walks both values with no idea what the shape is.",
    apis: ["JIT.compare.equal", "JIT.compare.diff", "JIT.compare.hash"],
    example: `import { JIT } from "@jit-compiler/jit/runtime";

const Order = JIT.object({
  id: JIT.string(),
  total: JIT.number(),
  lines: JIT.array(JIT.object({ sku: JIT.string(), quantity: JIT.number() })),
});

const same = JIT.compare.equal(Order);
const changes = JIT.compare.diff(Order);
const fingerprint = JIT.compare.hash(Order);

if (!same(previous, next)) {
  changes(previous, next); // the paths that actually differ
}`,
    why: [
      "`equal` is compiled for this shape: it reads known fields directly and returns on the first difference, with no key enumeration and no result object.",
      "`diff` reports the paths that changed, so a caller can act on the difference instead of on the fact that there was one.",
      "`hash` gives a structural fingerprint, which is the cheap way to skip work when the comparison itself is the thing being repeated.",
    ],
    page: "/docs/reference/functions/equal",
  },
  {
    id: "large-analytical-scan",
    triggers: [
      ["milhao", "linha"],
      ["milhoe", "registro"],
      ["million", "row"],
      ["analytic", "scan"],
      ["memoria", "muito"],
      ["memory", "heavy"],
      ["batch", "grande"],
      ["columnar"],
      ["rowset"],
    ],
    problem:
      "A very large batch of flat objects is being scanned, and the cost is the objects themselves: pointer chasing, per-row allocation, and string comparisons in the inner loop.",
    apis: ["JIT.process", "JIT.binary"],
    example: `import { JIT } from "@jit-compiler/jit/runtime";

const Event = JIT.object({
  id: JIT.string(),
  kind: JIT.enum(["click", "view", "purchase"]),
  amount: JIT.number(),
});

// rows are packed into fixed-width memory and scanned as typed views
const Events = JIT.array(Event).binary();

const revenue = JIT.cqrs.query(Events)
  .filter((q) => q.eq("kind", "purchase"))
  .sum("amount");`,
    why: [
      "Rows live in fixed-width memory, so a scan reads typed views instead of walking objects and chasing pointers.",
      "Enum and literal strings, and booleans, are compared as integer codes inside the loop rather than as strings.",
      "Discriminated unions get dense integer tags, so a union scan is an integer compare.",
      "Columnar mode keeps masks and per-field typed lanes in one buffer, and generated scans use a cached column base index with no row cursor.",
    ],
    page: "/docs/runtime/binary-rowsets",
  },
  {
    id: "migrate-versioned-events",
    triggers: [
      ["migrar", "versao"],
      ["migrate", "version"],
      ["evento", "antigo"],
      ["event", "upgrade"],
    ],
    problem:
      "Several historical object or event versions must reach the current shape without walking a runtime registry of migration callbacks.",
    apis: ["JIT.migrate", "to"],
    example: `import { JIT } from "@jit-compiler/jit/runtime";

const V1 = JIT.object({ version: JIT.literal(1), name: JIT.string() });
const V2 = JIT.object({ version: JIT.literal(2), fullName: JIT.string() });

const migrate = JIT.migrate(V1).to(V2, { fullName: { from: "name" } });
migrate({ version: 1, name: "Ada" });`,
    why: [
      "Literal schema versions compile into one switch, so dispatch does not scan an edge list.",
      "Each edge reuses MapperPlan and only edges after the input version execute.",
      "Current-version input returns by reference, while runtime and AOT share the same switch.",
    ],
    page: "/docs/reference/functions/migrate",
  },
  {
    id: "ingest-csv",
    triggers: [
      ["csv", "validar"],
      ["csv", "parse"],
      ["csv", "stream"],
      ["arquivo", "csv"],
    ],
    problem:
      "A CSV feed needs correct quoting, scalar conversion and row validation without splitting incorrectly or retaining the complete output.",
    apis: ["JIT.csv.parse", "to.visitor"],
    example: `import { JIT } from "@jit-compiler/jit/runtime";

const User = JIT.object({ id: JIT.number().int(), name: JIT.string() });
const visit = JIT.csv.parse(User).to.visitor();
const rows = [];

visit('id,name\\r\\n1,"Ada, Lovelace"', (row) => rows.push(row));`,
    why: [
      "The RFC 4180 state machine survives quoted delimiters, embedded newlines and chunk boundaries.",
      "Known columns are converted and passed to the specialized validator in one row path.",
      "The visitor sink retains scanner state and the current row, not a result array.",
    ],
    page: "/docs/reference/functions/csv",
  },
  {
    id: "filter-ndjson-feed",
    triggers: [
      ["ndjson", "filter"],
      ["ndjson", "filtrar"],
      ["jsonl", "transform"],
      ["json", "linha", "projetar"],
    ],
    problem:
      "An NDJSON feed is parsed, validated, filtered, projected and serialized again, and ordinary array stages materialize every boundary.",
    apis: ["JIT.ndjson.parse", "where", "select", "to.ndjson"],
    example: `import { JIT } from "@jit-compiler/jit/runtime";

const Event = JIT.object({ id: JIT.number(), active: JIT.boolean() });
const activeIds = JIT.ndjson
  .parse(Event)
  .where((query) => query.eq("active", true))
  .select("id")
  .to.ndjson();

activeIds('{"id":1,"active":true}\\n{"id":2,"active":false}\\n');`,
    why: [
      "One line scan performs JSON parsing, specialized validation, direct-field filtering and schema-specialized serialization.",
      "The fused sink builds neither a result array nor projected objects.",
      "Iterator and visitor remain available when the destination is a consumer rather than another NDJSON boundary.",
    ],
    page: "/docs/reference/functions/ndjson",
  },
  {
    id: "validate-while-downloading",
    triggers: [
      ["stream", "valid"],
      ["ndjson"],
      ["chunk", "valid"],
      ["enquanto", "baixa"],
      ["while", "download"],
      ["progressiv"],
      ["payload", "enorme"],
      ["arquivo", "grande", "json"],
    ],
    problem:
      "A large JSON or NDJSON payload has to be validated, and buffering the whole thing before checking it holds the entire document in memory first.",
    apis: ["JIT.stream"],
    example: `import { JIT } from "@jit-compiler/jit/runtime";

// the schema describes ONE line, not the whole array
const Row = JIT.object({ id: JIT.string(), amount: JIT.number() });

const lines = JIT.stream(Row, {
  format: "ndjson",
  onItem(row, index) {
    // validated as it arrives, before the next chunk lands
    consume(row, index);
  },
});

socket.on("data", (chunk) => lines.write(chunk));
socket.on("end", () => lines.end());`,
    why: [
      "Validation runs per chunk, so the document is never fully materialized to be checked.",
      "The boundary scanner is a state machine that survives a token cut across a chunk edge — a value split down the middle of a number or a string is resumed, not rejected.",
    ],
    page: "/docs/reference/functions/stream",
  },
  {
    id: "authorize-query-without-filter-callback",
    triggers: [
      ["filtrar", "permissão"],
      ["query", "autorização"],
      ["authorize", "rows"],
      ["permission", "projection"],
    ],
    problem:
      "Calling ability.can from Array.filter repeats action dispatch for every row and does not automatically constrain fields that may leave the boundary.",
    apis: ["JIT.access", "JIT.cqrs.query", "authorize", "select"],
    example: `import { JIT } from "@jit-compiler/jit/runtime";

const Actor = JIT.object({ id: JIT.number() });
const Post = JIT.object({ id: JIT.number(), authorId: JIT.number(), title: JIT.string() });
const access = JIT.access(Post)
  .actor(Actor)
  .can("read", (query, actor) => query.eq("authorId", actor.field("id")));
const ability = access({ id: 1 });
const read = JIT.cqrs.query(Post).authorize(ability, "read").select("id", "title");

console.log(read([
  { id: 1, authorId: 1, title: "mine" },
  { id: 2, authorId: 2, title: "other" },
]));`,
    why: [
      "The AccessPlan lowers into the ordinary query predicate, so the eager backend emits one loop without calling ability.can for each row.",
      "Field constraints intersect the query projection before a result crosses the boundary, and ~query contains only normal V1 query semantics.",
    ],
    page: "/docs/reference/functions/access",
  },
  {
    id: "openapi-contract",
    triggers: [
      ["openapi"],
      ["swagger"],
      ["json", "schema"],
      ["contrato", "api"],
      ["api", "contract"],
      ["document", "endpoint"],
    ],
    problem:
      "The API contract and the validation logic are written twice, so they drift and the published document stops describing what the endpoint actually accepts.",
    apis: ["JIT.jsonSchema.to", "JIT.jsonSchema.from"],
    example: `import { JIT } from "@jit-compiler/jit/runtime";

const CreateUser = JIT.object({
  email: JIT.string().email(),
  age: JIT.number().int().min(18),
});

// the same declaration that validates the request describes it
const document = JIT.jsonSchema.to(CreateUser);

// and an existing document can come back the other way
const fromContract = JIT.jsonSchema.from(document);`,
    why: [
      "The document is derived from the declaration that already validates the request, so the contract cannot describe something the endpoint does not enforce.",
      "`from` reads the other direction, which is what makes an existing published contract usable as a schema rather than a thing to copy by hand.",
    ],
    page: "/docs/reference/functions/json-schema",
  },
];

/**
 * Solutions whose symptoms the question actually shows.
 *
 * Matched on folded words with prefix tolerance, the same way concepts are, so
 * "lentidão ao filtrar" reaches the trigger written as `["lento", "filtr"]`.
 */
export function resolveSolutions(question: string): Solution[] {
  const words = question
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(fold);
  if (words.length === 0) return [];

  // Both sides are folded, and the prefix test runs in both directions: the
  // reader writes "lento" and "registros", which fold to "lent" and "registr",
  // while a trigger is written the way a person would say it. Comparing a
  // folded word against an unfolded trigger silently matches nothing, which is
  // the quietest possible way for this whole layer to do nothing at all.
  const has = (raw: string) => {
    const trigger = fold(raw);

    return words.some((word) => {
      if (word === trigger) return true;
      if (trigger.length < 4 || word.length < 4) return false;
      return word.startsWith(trigger) || trigger.startsWith(word);
    });
  };

  return SOLUTIONS.filter((solution) => solution.triggers.some((set) => set.every(has)));
}

/**
 * The matched solution as a block for the prompt.
 *
 * Only one is ever carried. A small model given two recipes writes a third
 * that is neither, and the second-best recipe is not worth that risk.
 */
export function solutionBlock(solutions: Solution[]): string | null {
  const solution = solutions[0];
  if (!solution) return null;

  return [
    "PROVEN SOLUTION — this is the answer to what they described. Use it; it is verified against the real library.",
    `Problem: ${solution.problem}`,
    `APIs: ${solution.apis.join(", ")}`,
    "Working code — reproduce it, adapting only the field names to what the reader described:",
    "```ts",
    solution.example,
    "```",
    "Why it works, explain these rather than asserting the result:",
    ...solution.why.map((line) => `- ${line}`),
    `More: ${solution.page}`,
  ].join("\n");
}
