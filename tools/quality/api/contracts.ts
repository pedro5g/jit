import type { FluentOperation } from "../ast/fluent.js";
import { combinationFields } from "./combinations.js";
import { contractNotes } from "./contract-notes.js";

type Capability = string;
export type RepeatSemantics = "forbid" | "accumulate" | "idempotent" | "explicit-replace";
type AliasSemantics = "accumulate" | "forbid" | "explicit-replace";
type ContractAudit = "reviewed" | "inferred";

export interface OperationCombination {
  readonly operation: string;
  readonly expected: "valid" | "invalid";
  readonly notes: string;
}

export interface OperationContract {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  readonly semanticKey: string;
  readonly aliases?: readonly string[];
  readonly aliasSemantics?: AliasSemantics;
  readonly audit: ContractAudit;
  readonly requires: readonly Capability[];
  readonly provides: readonly Capability[];
  readonly consumes?: readonly Capability[];
  readonly exclusiveGroup?: string;
  readonly conflicts?: readonly string[];
  readonly repeat: RepeatSemantics;
  readonly terminal?: boolean;
  readonly fusesWith?: readonly string[];
  readonly combinesWith?: readonly OperationCombination[];
  readonly notes: string;
}

const BASE_OPERATIONS = new Set([
  "is",
  "safeParse",
  "parse",
  "safeParseAsync",
  "parseAsync",
  "optional",
  "required",
  "nullable",
  "nullish",
  "readonly",
  "promise",
  "default",
  "brand",
  "pipe",
  "or",
  "and",
  "xor",
  "not",
  "when",
  "where",
  "refine",
  "coerce",
  "apply",
  "meta",
  "entity",
  "keyed",
  "groupBy",
  "sortBy",
  "uniqueBy",
  "indexBy",
  "ordered",
  "hash",
  "pii",
  "binary",
  "sanitize",
  "min",
  "max",
  "gte",
  "lte",
  "between",
  "daysOfWeek",
  "monthsOfYear",
  "truncateTo",
  "length",
  "oneOf",
  "startsWith",
  "endsWith",
  "includes",
  "regex",
  "email",
  "uuid",
  "url",
  "httpUrl",
  "jwt",
  "stringFormat",
  "noEmpty",
  "trim",
  "normalize",
  "lowercase",
  "toLowerCase",
  "uppercase",
  "toUpperCase",
  "positive",
  "negative",
  "nonnegative",
  "nonpositive",
  "moreThan",
  "gt",
  "lessThan",
  "lt",
  "multipleOf",
  "step",
  "finite",
  "safe",
  "int",
  "int32",
  "float32",
  "float64",
  "nonEmpty",
  "guid",
  "cuid",
  "cuid2",
  "ulid",
  "xid",
  "ksuid",
  "nanoid",
  "duration",
  "emoji",
  "ipv4",
  "ipv6",
  "cidrv4",
  "cidrv6",
  "base64",
  "base64url",
  "hostname",
  "domain",
  "e164",
  "hex",
  "date",
  "mac",
  "time",
  "datetime",
  "digest",
  "format",
  "cpf",
  "cnpj",
  "phoneBR",
  "partial",
  "strict",
  "loose",
  "catchall",
  "keyof",
  "transform",
  "pick",
  "omit",
  "extend",
  "merge",
  "implement",
  "implementAsync",
  "decode",
  "encode",
  "compile",
  "validate",
  "assert",
  "construction",
  "extends",
  "factories",
  "timestamps",
  "softDelete",
  "versioning",
  "methods",
  "events",
  "identity",
  "create",
  "hydrate",
  "where",
  "select",
  "project",
  "orderBy",
  "distinct",
  "join",
  "lookup",
  "aggregate",
  "group",
  "map",
  "filter",
  "update",
  "patch",
  "reconcile",
  "explain",
  "inspect",
  "execute",
  "first",
  "some",
  "every",
  "count",
  "toArray",
  "iterator",
  "visitor",
  "result",
  "diff",
  "watch",
  "derive",
  "read",
  "write",
  "end",
  "items",
  "add",
  "remove",
  "change",
  "assertions",
  "assertion",
  "extensions",
  "extendPrototype",
  "factory",
  "constructor",
  "codec",
  "json",
  "binaryRowset",
  "from",
  "to",
  "unsafe",
  "safeParseJson",
  "parseJson",
]);

const EXTENDED_OPERATIONS = new Set([
  "abstract",
  "accessors",
  "asyncIterator",
  "authorize",
  "actor",
  "array",
  "avg",
  "bigint",
  "boolean",
  "by",
  "can",
  "cannot",
  "case",
  "changes",
  "chunk",
  "delete",
  "drop",
  "dropWhile",
  "field",
  "findIndex",
  "flatMap",
  "get",
  "getter",
  "groupAdjacentBy",
  "grouped",
  "inputs",
  "install",
  "instant",
  "issues",
  "lazy",
  "limit",
  "many",
  "mask",
  "ndjson",
  "number",
  "on",
  "pairwise",
  "params",
  "plainDate",
  "plainDateTime",
  "plainMonthDay",
  "plainTime",
  "plainYearMonth",
  "private",
  "protected",
  "public",
  "removeWhere",
  "replaceWhere",
  "rule",
  "scan",
  "setter",
  "string",
  "stringify",
  "stringifyChunks",
  "sum",
  "take",
  "takeWhile",
  "thenBy",
  "unique",
  "updateWhere",
  "value",
  "window",
  "with",
  "zonedDateTime",
]);

const CHECKS = new Set([
  "min",
  "max",
  "gte",
  "lte",
  "between",
  "daysOfWeek",
  "monthsOfYear",
  "truncateTo",
  "length",
  "oneOf",
  "startsWith",
  "endsWith",
  "includes",
  "regex",
  "email",
  "uuid",
  "url",
  "httpUrl",
  "jwt",
  "stringFormat",
  "noEmpty",
  "trim",
  "normalize",
  "lowercase",
  "toLowerCase",
  "uppercase",
  "toUpperCase",
  "positive",
  "negative",
  "nonnegative",
  "nonpositive",
  "moreThan",
  "gt",
  "lessThan",
  "lt",
  "multipleOf",
  "step",
  "finite",
  "safe",
  "int",
  "int32",
  "float32",
  "float64",
  "nonEmpty",
  "guid",
  "cuid",
  "cuid2",
  "ulid",
  "xid",
  "ksuid",
  "nanoid",
  "duration",
  "emoji",
  "ipv4",
  "ipv6",
  "cidrv4",
  "cidrv6",
  "base64",
  "base64url",
  "hostname",
  "domain",
  "e164",
  "hex",
  "date",
  "mac",
  "time",
  "datetime",
  "digest",
  "format",
  "cpf",
  "cnpj",
  "phoneBR",
]);

const TERMINALS = new Set([
  "binary",
  "execute",
  "first",
  "some",
  "every",
  "count",
  "toArray",
  "iterator",
  "visitor",
  "end",
  "items",
]);
const SINGLETONS = new Set([
  "email",
  "default",
  "optional",
  "nullable",
  "nullish",
  "readonly",
  "promise",
  "brand",
  "coerce",
  "entity",
  "keyed",
  "groupBy",
  "sortBy",
  "uniqueBy",
  "indexBy",
  "ordered",
  "hash",
  "binary",
  "validate",
  "construction",
  "extends",
  "timestamps",
  "softDelete",
  "versioning",
  "factories",
  "public",
  "protected",
  "private",
]);

const SEMANTIC_ALIASES: Readonly<Record<string, string>> = {
  gte: "validation.minimum",
  min: "validation.minimum",
  lte: "validation.maximum",
  max: "validation.maximum",
  gt: "validation.exclusive-minimum",
  moreThan: "validation.exclusive-minimum",
  lt: "validation.exclusive-maximum",
  lessThan: "validation.exclusive-maximum",
  lowercase: "normalization.lowercase",
  toLowerCase: "normalization.lowercase",
  uppercase: "normalization.uppercase",
  toUpperCase: "normalization.uppercase",
};

const REVIEWED_OPERATIONS = new Set([...BASE_OPERATIONS, ...EXTENDED_OPERATIONS]);
const PARSE_OPERATIONS = new Set(["parse", "parseAsync", "safeParse", "safeParseAsync", "parseJson", "decode"]);
const VISIBILITY_OPERATIONS = new Set(["public", "protected", "private"]);

export function contractForOperation(operation: FluentOperation): OperationContract | undefined {
  if (!BASE_OPERATIONS.has(operation.name) && !EXTENDED_OPERATIONS.has(operation.name)) return undefined;
  const terminal = TERMINALS.has(operation.name);
  const family = familyFor(operation);
  const semanticKey = semanticKeyFor(family, operation.name);
  const repeat = repeatFor(operation.name);
  return {
    id: `jit.${family}.${operation.name}`,
    name: operation.name,
    family,
    semanticKey,
    audit: auditFor(operation.name),
    ...aliasesFor(semanticKey, operation.name),
    requires: requirementsFor(operation.name),
    provides: providesFor(operation.name, family),
    repeat,
    notes: contractNotes(operation.name, repeat, terminal),
    ...terminalFields(terminal),
    ...visibilityFields(operation.name),
    ...fusionFields(operation.name),
    ...combinationFields(family, operation.name),
  };
}

function repeatFor(name: string): RepeatSemantics {
  if (CHECKS.has(name)) return name === "email" ? "forbid" : "accumulate";
  return SINGLETONS.has(name) ? "forbid" : "accumulate";
}

function familyFor(operation: FluentOperation): string {
  return operation.family === "builder" && CHECKS.has(operation.name) ? "validation-check" : operation.family;
}

function semanticKeyFor(family: string, name: string): string {
  if (family === "validation-check") return SEMANTIC_ALIASES[name] ?? `${family}:${name}`;
  return `${family}:${name}`;
}

function aliasesFor(
  semanticKey: string,
  name: string
): Pick<OperationContract, "aliases" | "aliasSemantics"> | Record<never, never> {
  const aliases = Object.entries(SEMANTIC_ALIASES)
    .filter(([alias, key]) => key === semanticKey && alias !== name)
    .map(([alias]) => alias)
    .sort();
  return aliases.length > 0 ? { aliases, aliasSemantics: "accumulate" } : {};
}

function auditFor(name: string): ContractAudit {
  return REVIEWED_OPERATIONS.has(name) ? "reviewed" : "inferred";
}

function requirementsFor(name: string): readonly Capability[] {
  return name === "validate" ? ["parse-stage"] : [];
}

function providesFor(name: string, family: string): readonly Capability[] {
  if (name === "validate") return ["validated"];
  if (PARSE_OPERATIONS.has(name)) return ["parse-stage"];
  return [`${family}:${name}`];
}

function terminalFields(terminal: boolean): Pick<OperationContract, "terminal"> | Record<never, never> {
  return terminal ? { terminal: true } : {};
}

function visibilityFields(
  name: string
): Pick<OperationContract, "exclusiveGroup" | "conflicts"> | Record<never, never> {
  return VISIBILITY_OPERATIONS.has(name) ? { exclusiveGroup: "visibility", conflicts: ["visibility"] } : {};
}

function fusionFields(name: string): Pick<OperationContract, "fusesWith"> | Record<never, never> {
  return name === "validate" ? { fusesWith: ["parse", "json.parse", "binary.decode", "ndjson.parse"] } : {};
}
