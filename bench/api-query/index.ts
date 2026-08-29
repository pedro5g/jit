import { z } from "zod";
import { emitCqrsAotParserSource } from "../../packages/jit/src/factories/cqrs.js";
import { JIT } from "../../packages/jit/src/index.js";
import { getArtifact } from "../../packages/jit/src/runtime/artifact-registry.js";
import { runSuite } from "../shared/persist.js";
import { registerScenario } from "../shared/scenario.js";

void emitCqrsAotParserSource;

const User = JIT.object({
  id: JIT.string(),
  age: JIT.number(),
  status: JIT.string(),
  score: JIT.number(),
  createdAt: JIT.string(),
});

const Listing = JIT.api.query(User, {
  filter: {
    id: true,
    status: ["eq", "neq"],
    age: ["gte", "lte"],
    score: ["gte", "lte"],
    createdAt: ["gte", "lte"],
  },
  select: ["id", "age", "status", "score", "createdAt"],
  sort: ["age", "score", "createdAt"],
  pagination: { type: "offset", defaultLimit: 20, maxLimit: 100 },
  limits: { maxConditions: 10, maxSortFields: 3, maxSelectFields: 5 },
});

const parse = JIT.api.parse(Listing);
const artifact = getArtifact(Listing);
if (artifact?.kind !== "cqrs-input") throw new Error("missing boundary artifact");
const aotParse = globalThis.Function(artifact.source)() as (input: unknown) => unknown;

/**
 * The shape this benchmark is really about.
 *
 * A REST filter parser written by hand is normally generic: it looks a field
 * up in a config object, looks the operator up in a registry, and walks the
 * request recursively. That is the work the compiled boundary removes.
 */
const CONFIG: Record<string, true | readonly string[]> = {
  id: true,
  status: ["eq", "neq"],
  age: ["gte", "lte"],
  score: ["gte", "lte"],
  createdAt: ["gte", "lte"],
};
const SORTABLE = new Set(["age", "score", "createdAt"]);
const SELECTABLE = new Set(["id", "age", "status", "score", "createdAt"]);

function genericParse(input: unknown) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid request");
  const source = input as Record<string, unknown>;
  const conditions: { kind: string; path: string[]; value: unknown }[] = [];
  const filter = source.filter;
  if (filter !== undefined) {
    if (filter === null || typeof filter !== "object" || Array.isArray(filter)) throw new Error("invalid filter");
    for (const [field, raw] of Object.entries(filter as Record<string, unknown>)) {
      const configured = CONFIG[field];
      if (configured === undefined) throw new Error(`field ${field} is not allowed`);
      if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
        if (configured === true) throw new Error(`field ${field} only allows equality`);
        for (const [operator, value] of Object.entries(raw as Record<string, unknown>)) {
          const kind = operator.startsWith("$") ? operator.slice(1) : operator;
          if (!configured.includes(kind)) throw new Error(`operator ${kind} is not allowed`);
          conditions.push({ kind, path: field.split("."), value });
        }
      } else conditions.push({ kind: "eq", path: field.split("."), value: raw });
      if (conditions.length > 10) throw new Error("too many conditions");
    }
  }
  const sort: { path: string[]; direction: "asc" | "desc" }[] = [];
  if (typeof source.sort === "string") {
    for (const token of source.sort.split(",")) {
      const descending = token.startsWith("-");
      const field = descending ? token.slice(1) : token;
      if (!SORTABLE.has(field)) throw new Error(`sort field ${field} is not allowed`);
      sort.push({ path: [field], direction: descending ? "desc" : "asc" });
    }
  }
  let select: string[] | undefined;
  if (typeof source.fields === "string") {
    select = source.fields.split(",");
    for (const field of select) if (!SELECTABLE.has(field)) throw new Error(`select field ${field} is not allowed`);
  }
  const page = typeof source.page === "number" ? source.page : 1;
  const limit = typeof source.limit === "number" ? source.limit : 20;
  if (limit > 100) throw new Error("limit too large");
  return {
    filter: conditions,
    sort,
    ...(select === undefined ? {} : { select }),
    pagination: { kind: "offset" as const, offset: (page - 1) * limit, limit },
  };
}

/** The same generic shape, with the semantic budget the boundary also enforces. */
function genericBudgetedParse(input: unknown) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid request");
  const source = input as Record<string, unknown>;
  const filter = source.filter;
  const conditions: { kind: string; path: string[]; value: unknown }[] = [];
  let cost = 0;
  if (filter !== undefined) {
    if (filter === null || typeof filter !== "object" || Array.isArray(filter)) throw new Error("invalid filter");
    for (const [field, raw] of Object.entries(filter as Record<string, unknown>)) {
      const configured = BUDGETED_CONFIG[field];
      if (configured === undefined) throw new Error(`field ${field} is not allowed`);
      if (raw === null || typeof raw !== "object" || Array.isArray(raw))
        throw new Error(`field ${field} needs an operator`);
      for (const [operator, value] of Object.entries(raw as Record<string, unknown>)) {
        const kind = operator.startsWith("$") ? operator.slice(1) : operator;
        if (!configured.includes(kind)) throw new Error(`operator ${kind} is not allowed`);
        conditions.push({ kind, path: field.split("."), value });
        cost += kind === "eq" || kind === "neq" ? 1 : 2;
        if (cost > 4) throw new Error("complexity budget exceeded");
      }
    }
  }
  return { filter: conditions, sort: [] };
}

const BUDGETED_CONFIG: Record<string, readonly string[]> = {
  age: ["gte", "lte"],
  score: ["gte", "lte"],
  createdAt: ["gte", "lte"],
};

/** Validate-then-normalize: the other common shape, with a schema library. */
const range = z.object({ $gte: z.number().optional(), $lte: z.number().optional() }).strict();
const RequestSchema = z
  .object({
    filter: z
      .object({
        id: z.string().optional(),
        status: z.object({ $eq: z.string().optional(), $neq: z.string().optional() }).strict().optional(),
        age: range.optional(),
        score: range.optional(),
        createdAt: z.object({ $gte: z.string().optional(), $lte: z.string().optional() }).strict().optional(),
      })
      .strict()
      .optional(),
    fields: z.string().optional(),
    sort: z.string().optional(),
    page: z.number().optional(),
    limit: z.number().max(100).optional(),
  })
  .strict();

function validatedParse(input: unknown) {
  return genericParse(RequestSchema.parse(input));
}

const equality = { filter: { id: "u_1" } };
const fiveFilters = {
  filter: {
    id: "u_1",
    status: { $eq: "active" },
    age: { $gte: 18, $lte: 65 },
    score: { $gte: 10 },
    createdAt: { $gte: "2026-01-01" },
  },
};
const full = {
  filter: { status: { $eq: "active" }, age: { $gte: 18, $lte: 65 } },
  fields: "id,age,status",
  sort: "-score,age",
  page: 3,
  limit: 25,
};

registerScenario({
  op: "api query parse",
  name: "single equality filter",
  args: [equality],
  jit: parse as (...args: never[]) => unknown,
  competitors: [
    { name: "JIT AOT", fn: aotParse as (...args: never[]) => unknown },
    { name: "generic config-driven parser", fn: genericParse as (...args: never[]) => unknown },
    { name: "zod validate + generic normalize", fn: validatedParse as (...args: never[]) => unknown },
    {
      name: "handwritten",
      fn: (value: typeof equality) => ({
        filter: [{ kind: "eq", path: ["id"], value: value.filter.id }],
        sort: [],
        pagination: { kind: "offset" as const, offset: 0, limit: 20 },
      }),
      biased: "assumes an already valid exact input and enforces no allowlist, budget or pagination bound",
    },
  ],
});

registerScenario({
  op: "api query parse",
  name: "five filters",
  args: [fiveFilters],
  jit: parse as (...args: never[]) => unknown,
  competitors: [
    { name: "JIT AOT", fn: aotParse as (...args: never[]) => unknown },
    { name: "generic config-driven parser", fn: genericParse as (...args: never[]) => unknown },
    { name: "zod validate + generic normalize", fn: validatedParse as (...args: never[]) => unknown },
  ],
});

registerScenario({
  op: "api query parse",
  name: "projection, sort and offset pagination",
  args: [full],
  jit: parse as (...args: never[]) => unknown,
  competitors: [
    { name: "JIT AOT", fn: aotParse as (...args: never[]) => unknown },
    { name: "generic config-driven parser", fn: genericParse as (...args: never[]) => unknown },
    { name: "zod validate + generic normalize", fn: validatedParse as (...args: never[]) => unknown },
  ],
});

/** Rejection is the hot path for an amplifying client, so it is measured too. */
function refusing<TFn extends (input: never) => unknown>(fn: TFn) {
  return (input: never) => {
    try {
      return fn(input);
    } catch (error) {
      return error;
    }
  };
}

const unknownField = { filter: { passwordHash: "x" } };

registerScenario({
  op: "api query reject",
  name: "undeclared field, first key",
  args: [unknownField],
  jit: refusing(parse) as (...args: never[]) => unknown,
  competitors: [
    { name: "JIT AOT", fn: refusing(aotParse) as (...args: never[]) => unknown },
    { name: "generic config-driven parser", fn: refusing(genericParse) as (...args: never[]) => unknown },
    { name: "zod validate + generic normalize", fn: refusing(validatedParse) as (...args: never[]) => unknown },
  ],
});

const Budgeted = JIT.api.query(User, {
  filter: { age: ["gte", "lte"], score: ["gte", "lte"], createdAt: ["gte", "lte"] },
  limits: { maxCost: 4 },
});
const parseBudgeted = JIT.api.parse(Budgeted);
const overBudgetEarly = {
  filter: { age: { $gte: 1, $lte: 2 }, score: { $gte: 1, $lte: 2 }, createdAt: { $gte: "a", $lte: "b" } },
};
const overBudgetLate = {
  filter: { age: { $gte: 1 }, score: { $gte: 1 }, createdAt: { $gte: "a", $lte: "b" } },
};

registerScenario({
  op: "api query reject",
  name: "budget exceeded on the first field",
  args: [overBudgetEarly],
  jit: refusing(parseBudgeted) as (...args: never[]) => unknown,
  competitors: [
    { name: "generic config-driven parser", fn: refusing(genericBudgetedParse) as (...args: never[]) => unknown },
  ],
});

registerScenario({
  op: "api query reject",
  name: "budget exceeded on the last field",
  args: [overBudgetLate],
  jit: refusing(parseBudgeted) as (...args: never[]) => unknown,
  competitors: [
    { name: "generic config-driven parser", fn: refusing(genericBudgetedParse) as (...args: never[]) => unknown },
  ],
});

const Actor = JIT.object({ id: JIT.string() });
const readable = JIT.access(User)
  .actor(Actor)
  .can("read", {
    fields: ["id", "age", "status", "score", "createdAt"],
    when: (query, actor) => query.or(query.eq("status", "active"), query.eq("id", actor.field("id"))),
  });
const authorize = JIT.api.authorize(Listing, readable, "read");
const actor = { id: "u_1" };

registerScenario({
  op: "api query authorize",
  name: "boundary intersected with actor access",
  args: [full, actor],
  jit: authorize as (...args: never[]) => unknown,
  competitors: [
    {
      name: "parse then intersect by hand",
      fn: (input: unknown, who: typeof actor) => {
        const request = genericParse(input);
        let filter: unknown;
        for (const condition of request.filter) {
          const compare = {
            kind: "compare" as const,
            operator: condition.kind,
            left: { kind: "field" as const, path: condition.path },
            right: { kind: "literal" as const, value: condition.value },
          };
          filter = filter === undefined ? compare : { kind: "logical", operator: "and", left: filter, right: compare };
        }
        const guard = {
          kind: "logical" as const,
          operator: "or" as const,
          left: {
            kind: "compare" as const,
            operator: "eq",
            left: { kind: "field" as const, path: ["status"] },
            right: { kind: "literal" as const, value: "active" },
          },
          right: {
            kind: "compare" as const,
            operator: "eq",
            left: { kind: "field" as const, path: ["id"] },
            right: { kind: "literal" as const, value: who.id },
          },
        };
        return {
          filter: filter === undefined ? guard : { kind: "logical", operator: "and", left: filter, right: guard },
          sort: request.sort,
          select: request.select,
          pagination: request.pagination,
        };
      },
      biased: "hardcodes one actor's rules instead of resolving them from an access plan",
    },
  ],
});

await runSuite("api-query");
