import type { QueryBoundary } from "../compiler/query-boundary.js";
import { queryBoundaryFilters } from "../compiler/query-boundary.js";
import { QUERY_COST_WEIGHTS, queryBoundaryMaxCost, queryOperatorCost } from "../compiler/query-cost.js";
import { JITError } from "../errors/index.js";
import type { CqrsInputCondition, ParsedCqrsInput } from "./cqrs.js";

const queryBoundaries = new WeakMap<object, QueryBoundary>();

/** @internal Associates a public input boundary with its frozen semantic descriptor. */
export function registerCqrsBoundary(value: object, boundary: QueryBoundary): void {
  queryBoundaries.set(value, boundary);
}

/** @internal Reads the semantic descriptor associated with a public input boundary. */
export function getCqrsBoundary(value: object): QueryBoundary | undefined {
  return queryBoundaries.get(value);
}

/** @internal Builds the reference parser for one frozen boundary. */
export function cqrsParseReference(boundary: QueryBoundary) {
  // Built once with the boundary: the fallback path re-validates a request, it
  // does not rebuild the allowlist for every request. Condition paths reuse the
  // descriptor's frozen segments instead of splitting the key again.
  const shorthand = queryBoundaryFilters(boundary);
  const allowed = new Map(
    boundary.fields.map((field, index) => {
      const [path, operators] = shorthand[index] as [string, true | readonly string[]];
      return [path, { path: field.path, operators }] as const;
    })
  );
  return (input: unknown): ParsedCqrsInput => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new JITError("INVALID_QUERY", "API query input must be an object");
    }
    const source = input as Record<string, unknown>;
    const allowedInputKeys = new Set([
      "filter",
      "fields",
      "sort",
      ...(boundary.pagination?.type === "offset" ? ["page", "limit"] : []),
      ...(boundary.pagination?.type === "cursor" ? ["after", "before", "limit"] : []),
    ]);
    for (const key of Object.keys(source)) {
      if (!allowedInputKeys.has(key)) {
        throw new JITError("INVALID_QUERY", `API query input field ${JSON.stringify(key)} is not allowed`);
      }
    }
    const filter = source.filter;
    if (filter === undefined) return normalizeCqrsTail(source, boundary, [], { cost: 0 });
    if (filter === null || typeof filter !== "object" || Array.isArray(filter)) {
      throw new JITError("INVALID_QUERY", "API query filter must be an object");
    }
    const record = filter as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length > boundary.limits.maxFilters) {
      throw new JITError("INVALID_QUERY", "API query filter exceeds the configured structural limit");
    }
    const conditions: CqrsInputCondition[] = [];
    const budget = { cost: 0 };
    for (let index = 0; index < keys.length; index++) {
      const field = keys[index] as string;
      const configured = allowed.get(field);
      if (configured === undefined)
        throw new JITError("INVALID_QUERY", `Filter field ${JSON.stringify(field)} is not allowed`);
      const raw = record[field];
      if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
        if (configured.operators === true) {
          throw new JITError("INVALID_QUERY", `Filter field ${JSON.stringify(field)} only allows equality`);
        }
        for (const [operator, value] of Object.entries(raw as Record<string, unknown>)) {
          const kind = operator.startsWith("$") ? operator.slice(1) : operator;
          if (!configured.operators.includes(kind)) {
            throw new JITError(
              "INVALID_QUERY",
              `Filter operator ${JSON.stringify(kind)} is not allowed for ${JSON.stringify(field)}`
            );
          }
          conditions.push({ kind, path: configured.path, value });
          chargeCqrsCondition(boundary, conditions.length, budget, queryOperatorCost(kind));
        }
      } else {
        conditions.push({ kind: "eq", path: configured.path, value: raw });
        chargeCqrsCondition(boundary, conditions.length, budget, QUERY_COST_WEIGHTS.equality);
      }
    }
    return normalizeCqrsTail(source, boundary, conditions, budget);
  };
}

/**
 * Charges one condition against both budgets as it is produced.
 *
 * The counters are checked here rather than after the loop so an amplifying
 * request stops at the condition that breaks the budget; the remaining request
 * keys are never read.
 */
function chargeCqrsCondition(boundary: QueryBoundary, produced: number, budget: { cost: number }, cost: number): void {
  if (produced > boundary.limits.maxConditions) {
    throw new JITError("INVALID_QUERY", "API query filter exceeds the configured condition limit");
  }
  budget.cost += cost;
  if (budget.cost > boundary.limits.maxCost) {
    throw new JITError("INVALID_QUERY", "API query exceeds the configured complexity budget");
  }
}

function normalizeCqrsTail(
  source: Record<string, unknown>,
  boundary: QueryBoundary,
  filter: readonly CqrsInputCondition[],
  budget: { cost: number } = { cost: 0 }
): ParsedCqrsInput {
  const select = normalizeCqrsSelect(source, boundary);
  const { pagination } = boundary;
  const allowedSort = new Set<string>(pagination?.type === "cursor" ? pagination.by : boundary.sorting);
  if (source.sort !== undefined && (typeof source.sort !== "string" || source.sort.length === 0)) {
    throw new JITError("INVALID_QUERY", "API query sort must be a non-empty string");
  }
  const sort =
    typeof source.sort === "string"
      ? source.sort.split(",").map((token) => {
          const descending = token.startsWith("-");
          const field = descending ? token.slice(1) : token;
          if (!allowedSort.has(field))
            throw new JITError("INVALID_QUERY", `Sort field ${JSON.stringify(field)} is not allowed`);
          return {
            path: [field],
            direction: descending ? ("desc" as const) : ("asc" as const),
          };
        })
      : [];
  const sortFields = new Set<string>();
  for (const entry of sort) {
    const field = entry.path[0] as string;
    if (field.length === 0) throw new JITError("INVALID_QUERY", "API query sort field cannot be empty");
    if (sortFields.has(field)) throw new JITError("INVALID_QUERY", `API query sort repeats ${JSON.stringify(field)}`);
    sortFields.add(field);
  }
  if (sort.length > boundary.limits.maxSortFields) {
    throw new JITError("INVALID_QUERY", "API query sort exceeds the configured structural limit");
  }
  budget.cost += QUERY_COST_WEIGHTS.sort * sort.length;
  if (budget.cost > boundary.limits.maxCost) {
    throw new JITError("INVALID_QUERY", "API query exceeds the configured complexity budget");
  }
  if (!pagination) return { filter, sort, ...(select === undefined ? {} : { select }) };
  if (pagination.type === "cursor") {
    if (sort.length > 0 && !sameCursorOrdering(sort, pagination.by)) {
      throw new JITError("INVALID_QUERY", "Cursor pagination requires its configured stable ordering");
    }
    const after = source.after === undefined ? undefined : decodeCqrsCursor(source.after, pagination.by.length);
    const before = source.before === undefined ? undefined : decodeCqrsCursor(source.before, pagination.by.length);
    if (after !== undefined && before !== undefined) {
      throw new JITError("INVALID_QUERY", "Cursor pagination accepts either after or before, not both");
    }
    const limit = typeof source.limit === "number" ? source.limit : pagination.defaultLimit;
    if (!Number.isInteger(limit) || limit < 1 || limit > pagination.maxLimit) {
      throw new JITError("INVALID_QUERY", "Invalid cursor pagination");
    }
    return {
      filter,
      sort: pagination.by.map((field) => ({
        path: [field],
        direction: "asc" as const,
      })),
      ...(select === undefined ? {} : { select }),
      pagination: {
        kind: "cursor",
        limit,
        ...(after === undefined ? {} : { after }),
        ...(before === undefined ? {} : { before }),
      },
    };
  }
  const page = typeof source.page === "number" ? source.page : 1;
  const limit = typeof source.limit === "number" ? source.limit : pagination.defaultLimit;
  const offset = (page - 1) * limit;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > pagination.maxLimit ||
    !Number.isSafeInteger(offset)
  ) {
    throw new JITError("INVALID_QUERY", "Invalid offset pagination");
  }
  if (offset > pagination.maxOffset) {
    throw new JITError("INVALID_QUERY", "API query offset exceeds the configured pagination limit");
  }
  return {
    filter,
    sort,
    ...(select === undefined ? {} : { select }),
    pagination: { kind: "offset", offset, limit },
  };
}

function normalizeCqrsSelect(source: Record<string, unknown>, boundary: QueryBoundary): readonly string[] | undefined {
  if (source.fields === undefined) return undefined;
  if (boundary.projection.length === 0 || typeof source.fields !== "string") {
    throw new JITError("INVALID_QUERY", "API query sparse fields are not allowed");
  }
  if (source.fields.length === 0) throw new JITError("INVALID_QUERY", "API query select field cannot be empty");
  const fields = source.fields.split(",");
  if (fields.length > boundary.limits.maxSelectFields) {
    throw new JITError("INVALID_QUERY", "API query select exceeds the configured structural limit");
  }
  const allowed = new Set(boundary.projection);
  const selected = new Set<string>();
  for (const field of fields) {
    if (field.length === 0) throw new JITError("INVALID_QUERY", "API query select field cannot be empty");
    if (!allowed.has(field))
      throw new JITError("INVALID_QUERY", `Select field ${JSON.stringify(field)} is not allowed`);
    if (selected.has(field)) throw new JITError("INVALID_QUERY", `API query select repeats ${JSON.stringify(field)}`);
    selected.add(field);
  }
  return fields;
}

function sameCursorOrdering(
  sort: readonly {
    readonly path: readonly string[];
    readonly direction: "asc" | "desc";
  }[],
  fields: readonly string[]
): boolean {
  return (
    sort.length === fields.length &&
    sort.every((entry, index) => entry.direction === "asc" && entry.path[0] === fields[index])
  );
}

/** Encodes a JSON-safe cursor tuple. The tuple shape is validated by the parser that owns it. */
export function encodeCqrsCursor(values: readonly unknown[]): string {
  return globalThis.btoa(
    encodeURIComponent(JSON.stringify(values)).replace(/%([0-9A-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
  );
}

/** @internal Decodes a cursor for the runtime parser. */
export function decodeCqrsCursor(value: unknown, size: number): readonly unknown[] {
  if (typeof value !== "string") throw new JITError("INVALID_QUERY", "Cursor must be an opaque string");
  try {
    const bytes = globalThis.atob(value);
    let escaped = "";
    for (let index = 0; index < bytes.length; index++)
      escaped += `%${bytes.charCodeAt(index).toString(16).padStart(2, "0")}`;
    const decoded: unknown = JSON.parse(decodeURIComponent(escaped));
    if (!Array.isArray(decoded) || decoded.length !== size) throw new Error("Invalid cursor tuple");
    return decoded;
  } catch {
    throw new JITError("INVALID_QUERY", "Malformed cursor");
  }
}

/** Specializes one boundary into direct request source; the descriptor is the only input. */
export function emitCqrsInputParser(boundary: QueryBoundary): string {
  const fields = queryBoundaryFilters(boundary);
  const { maxFilters, maxConditions, maxSortFields, maxSelectFields } = boundary.limits;
  const sortFields = boundary.sorting;
  const selectFields = boundary.projection;
  const pagination = boundary.pagination ?? undefined;
  const allowedFields = fields.map(([field]) => JSON.stringify(field));
  const inputFields = [
    "filter",
    "fields",
    "sort",
    ...(pagination?.type === "offset" ? ["page", "limit"] : []),
    ...(pagination?.type === "cursor" ? ["after", "before", "limit"] : []),
  ].map((field) => JSON.stringify(field));
  const conditionCapacity = Math.max(
    1,
    ...fields.map(([, configured]) => (configured === true ? 1 : configured.length * 2))
  );
  // A guard that cannot fire is not emitted. Both budgets are static, so the
  // worst request the allowlist can express is known here: when it already fits,
  // the hot path keeps the shape it had before the budget existed.
  const worstConditions = fields.reduce(
    (total, [, configured]) => total + (configured === true ? 1 : configured.length * 2),
    0
  );
  const countGuarded = worstConditions > maxConditions;
  const costGuarded = queryBoundaryMaxCost(boundary) > boundary.limits.maxCost;
  const guard = (cost: number) =>
    `${countGuarded ? ` if (j > ${maxConditions}) return __reference(input);` : ""}${
      costGuarded ? ` cost += ${cost}; if (cost > ${boundary.limits.maxCost}) return __reference(input);` : ""
    }`;
  const fieldBodies = fields.map(([field, configured]) => {
    const access = `[${JSON.stringify(field)}]`;
    const operators = configured === true ? [] : configured;
    const operatorBodies = operators
      .flatMap((operator) => {
        const kind = JSON.stringify(operator);
        const path = JSON.stringify(field.split("."));
        return [
          `if (raw[${JSON.stringify(`$${operator}`)}] !== undefined) { matched += 1; out[j++] = { kind: ${kind}, path: ${path}, value: raw[${JSON.stringify(`$${operator}`)}] };${guard(queryOperatorCost(operator))} }`,
          `if (raw[${JSON.stringify(operator)}] !== undefined) { matched += 1; out[j++] = { kind: ${kind}, path: ${path}, value: raw[${JSON.stringify(operator)}] };${guard(queryOperatorCost(operator))} }`,
        ];
      })
      .join(" ");
    return `if (filter${access} !== undefined) { const raw = filter${access}; if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) { ${operatorBodies ? `let matched = 0; ${operatorBodies} if (Object.keys(raw).length !== matched) return __reference(input);` : "return __reference(input);"} } else { out[j++] = { kind: "eq", path: ${JSON.stringify(field.split("."))}, value: raw };${guard(QUERY_COST_WEIGHTS.equality)} } }`;
  });
  const allowedSort = sortFields.map((field) => JSON.stringify(field));
  const allowedSelect = selectFields.map((field) => JSON.stringify(field));
  const selectSource = `const selectText = input.fields; let select; if (selectText !== undefined) { if (typeof selectText !== "string" || selectText.length === 0) return __reference(input); const selected = selectText.split(","); if (selected.length > ${maxSelectFields}) return __reference(input); const seen = new Set(); for (let i = 0; i < selected.length; i++) { const field = selected[i]; if (field.length === 0 || seen.has(field) || (${allowedSelect.map((field) => `field !== ${field}`).join(" && ") || "true"})) return __reference(input); seen.add(field); } select = selected; }`;
  const sortSource = `const sortText = input.sort; let sort = []; if (sortText !== undefined) { if (typeof sortText !== "string" || sortText.length === 0) return __reference(input); const tokens = sortText.split(","); if (tokens.length > ${maxSortFields}) return __reference(input); const seen = new Set(); sort = new Array(tokens.length); for (let i = 0; i < tokens.length; i++) { const token = tokens[i]; const descending = token.charCodeAt(0) === 45; const field = descending ? token.slice(1) : token; if (field.length === 0 || seen.has(field) || (${allowedSort.map((field) => `field !== ${field}`).join(" && ") || "true"})) return __reference(input); seen.add(field); sort[i] = { path: [field], direction: descending ? "desc" : "asc" }; } }${costGuarded ? ` cost += ${QUERY_COST_WEIGHTS.sort} * sort.length; if (cost > ${boundary.limits.maxCost}) return __reference(input);` : ""}`;
  const paginationSource = !pagination
    ? "return select === undefined ? { filter: out, sort } : { filter: out, sort, select };"
    : pagination.type === "offset"
      ? `const page = typeof input.page === "number" ? input.page : 1; const limit = typeof input.limit === "number" ? input.limit : ${pagination.defaultLimit}; const offset = (page - 1) * limit; if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > ${pagination.maxLimit} || !Number.isSafeInteger(offset) || offset > ${pagination.maxOffset}) return __reference(input); return select === undefined ? { filter: out, sort, pagination: { kind: "offset", offset, limit } } : { filter: out, sort, select, pagination: { kind: "offset", offset, limit } };`
      : `if (typeof sortText === "string" && sortText.length > 0 && sortText !== ${JSON.stringify(pagination.by.join(","))}) return __reference(input); sort = ${JSON.stringify(pagination.by.map((field) => ({ path: [field], direction: "asc" })))}; const afterText = input.after; const beforeText = input.before; if (afterText !== undefined && beforeText !== undefined) return __reference(input); const after = afterText === undefined ? undefined : __decodeCursor(afterText, ${pagination.by.length}); const before = beforeText === undefined ? undefined : __decodeCursor(beforeText, ${pagination.by.length}); const limit = typeof input.limit === "number" ? input.limit : ${pagination.defaultLimit}; if (!Number.isInteger(limit) || limit < 1 || limit > ${pagination.maxLimit}) return __reference(input); return select === undefined ? { filter: out, sort, pagination: { kind: "cursor", limit, ...(after === undefined ? {} : { after }), ...(before === undefined ? {} : { before }) } } : { filter: out, sort, select, pagination: { kind: "cursor", limit, ...(after === undefined ? {} : { after }), ...(before === undefined ? {} : { before }) } };`;
  return `return function parse(input) { if (input === null || typeof input !== "object" || Array.isArray(input)) return __reference(input); const inputKeys = Object.keys(input); for (let i = 0; i < inputKeys.length; i++) { if (${inputFields.map((field) => `inputKeys[i] !== ${field}`).join(" && ") || "true"}) return __reference(input); } ${costGuarded ? "let cost = 0; " : ""}let out; if (input.filter === undefined) out = []; else { const filter = input.filter; if (filter === null || typeof filter !== "object" || Array.isArray(filter)) return __reference(input); const keys = Object.keys(filter); if (keys.length > ${maxFilters}) return __reference(input); for (let i = 0; i < keys.length; i++) { if (${allowedFields.map((field) => `keys[i] !== ${field}`).join(" && ") || "true"}) return __reference(input); } out = new Array(keys.length * ${conditionCapacity}); let j = 0; ${fieldBodies.join(" ")} if (j !== out.length) out.length = j; } ${selectSource} ${sortSource} ${paginationSource} };`;
}

/** Import-free variant consumed by the AOT emitter; invalid syntax throws directly. */
export function emitCqrsAotParserSource(boundary: QueryBoundary): string {
  const parser = emitCqrsInputParser(boundary)
    .split("return __reference(input);")
    .join('throw new Error("Invalid API query input");')
    .split("__decodeCursor")
    .join("decodeCursor");
  return `function decodeCursor(value, size) { if (typeof value !== "string") throw new Error("Malformed cursor"); try { const bytes = atob(value); let escaped = ""; for (let i = 0; i < bytes.length; i++) escaped += "%" + bytes.charCodeAt(i).toString(16).padStart(2, "0"); const decoded = JSON.parse(decodeURIComponent(escaped)); if (!Array.isArray(decoded) || decoded.length !== size) throw new Error("Malformed cursor"); return decoded; } catch { throw new Error("Malformed cursor"); } } ${parser}`;
}
