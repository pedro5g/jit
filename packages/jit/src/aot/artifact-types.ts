import { relative, resolve } from "node:path";

import type { ExecutionPlan } from "../compiler/execution-plan.js";
import { resolveWrappers } from "../compiler/resolvers/resolve-wrappers.js";
import type {
  QueryAggregateNode,
  QueryCompositeAggregateNode,
  QueryNode,
  QueryTerminalNode,
} from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import type { CompiledArtifact } from "../runtime/artifact-registry.js";
import { emitTypeScriptType } from "./emit-type.js";

export function declarationImportType(
  outDir: string,
  sourceFile: string,
  name: string,
  artifact: CompiledArtifact
): string | undefined {
  const reference = readBackType(outDir, sourceFile, artifact);

  return reference?.(name);
}

export function memberImportType(
  outDir: string,
  sourceFile: string,
  group: string,
  prop: string,
  artifact: CompiledArtifact
): string | undefined {
  const reference = readBackType(outDir, sourceFile, artifact);

  return reference?.(`${group}[${JSON.stringify(prop)}]`);
}

function readBackType(
  outDir: string,
  sourceFile: string,
  artifact: CompiledArtifact
): ((path: string) => string) | undefined {
  if (
    artifact.kind !== "query-plan" &&
    artifact.kind !== "join-plan" &&
    artifact.kind !== "query" &&
    artifact.kind !== "mapper" &&
    artifact.kind !== "watch"
  ) {
    return undefined;
  }

  const specifier = JSON.stringify(typeImportSpecifier(outDir, sourceFile));

  // A query builder also carries its chain operators; only the call
  // signature survives into the generated function.
  return (path) =>
    artifact.kind === "query-plan" || artifact.kind === "join-plan"
      ? `__JitCall<typeof import(${specifier}).${path}>`
      : `typeof import(${specifier}).${path}`;
}

export function joinPlanType(
  artifact: Extract<CompiledArtifact, { readonly kind: "join-plan" }>,
  typeNames: TypeNames
): string {
  const left = namedType(artifact.plan.leftSchema, typeNames);
  const right = namedType(artifact.plan.rightSchema, typeNames);
  const leftRow = queryArtifactRowType(artifact.plan.leftSchema, typeNames);
  const rightRow = queryArtifactRowType(artifact.plan.rightSchema, typeNames);
  const result =
    artifact.plan.kind === "semi" || artifact.plan.kind === "anti"
      ? `${leftRow}[]`
      : artifact.plan.kind === "left"
        ? `{ readonly left: ${leftRow}; readonly right: ${rightRow} | undefined }[]`
        : `{ readonly left: ${leftRow}; readonly right: ${rightRow} }[]`;
  return `(left: ${left}, right: ${right}) => ${result}`;
}

function queryArtifactRowType(schema: ATS.AnyTypeSchema, typeNames: TypeNames): string {
  const base = resolveWrappers(schema).base;
  const row = base.type === TypeName.array ? (base.def as ATS.ElementDef).element : base;
  return namedType(row, typeNames);
}

export function queryPlanType(
  artifact: Extract<CompiledArtifact, { readonly kind: "query-plan" }>,
  typeNames: TypeNames
): string {
  const input = namedType(artifact.schema, typeNames);

  switch (artifact.mode) {
    case "iterator":
      return `(value: ${input}) => IterableIterator<unknown>`;
    case "async-iterator":
      return `(value: ${input}) => AsyncIterableIterator<unknown>`;
    case "visitor":
      return `(value: ${input}, consume: (item: unknown) => void) => number`;
    default:
      return `(value: ${input}) => ${eagerQueryResultType(artifact, typeNames)}`;
  }
}

/**
 * The eager result is an array only until a node reduces it. A terminal or an
 * aggregate answers with a scalar, and the generated signature has to say so —
 * it is the public boundary of an otherwise `@ts-nocheck` module.
 */
function eagerQueryResultType(
  artifact: Extract<CompiledArtifact, { readonly kind: "query-plan" }>,
  typeNames: TypeNames
): string {
  let terminal: QueryTerminalNode | undefined;
  let aggregate: QueryAggregateNode | undefined;
  let composite: QueryCompositeAggregateNode | undefined;
  let select: readonly string[] | undefined;

  for (const node of artifact.program.nodes as readonly QueryNode[]) {
    if (node.kind === "terminal") terminal = node;
    else if (node.kind === "aggregate") aggregate = node;
    else if (node.kind === "aggregate:composite") composite = node;
    else if (node.kind === "select:fields") select = node.fields;
  }

  if (composite) {
    const fields = composite.fields.map(
      (field) =>
        `readonly ${JSON.stringify(field.name)}: ${field.op === "sum" || field.op === "count" ? "number" : "number | undefined"}`
    );
    const aggregates = `{ ${fields.join("; ")} }`;
    // A grouped composite keeps the record shape and reduces the rows under it.
    const grouped = (artifact.program.nodes as readonly QueryNode[]).some((node) => node.kind === "groupBy");

    return grouped ? `Record<PropertyKey, ${aggregates}>` : aggregates;
  }

  if (terminal) {
    if (terminal.op === "some" || terminal.op === "every") return "boolean";
    if (terminal.op === "findIndex") return "number";

    const row = queryRowType(artifact, typeNames);
    const projected = select ? `Pick<${row}, ${select.map((field) => JSON.stringify(field)).join(" | ")}>` : row;

    return `${projected} | undefined`;
  }
  if (aggregate) return aggregate.op === "sum" || aggregate.op === "count" ? "number" : "number | undefined";
  return "unknown[]";
}

function queryRowType(
  artifact: Extract<CompiledArtifact, { readonly kind: "query-plan" }>,
  typeNames: TypeNames
): string {
  const schema = resolveWrappers(artifact.schema).base;
  const row =
    schema.type === TypeName.array
      ? (schema.def as ATS.ElementDef).element
      : schema.type === TypeName.runtimeType
        ? (schema.def as ATS.RuntimeTypeDef).innerType
        : schema;

  return namedType(row, typeNames);
}

export function sortPlanType(
  artifact: Extract<CompiledArtifact, { readonly kind: "sort-plan" }>,
  typeNames: TypeNames
): string {
  const schema = resolveWrappers(artifact.schema).base;
  const row =
    schema.type === TypeName.array
      ? (schema.def as ATS.ElementDef).element
      : schema.type === TypeName.runtimeType
        ? (schema.def as ATS.RuntimeTypeDef).innerType
        : schema;
  const value = namedType(row, typeNames);

  return `((value: readonly ${value}[]) => ${value}[]) & { readonly compare: (left: ${value}, right: ${value}) => number; readonly inPlace: (value: ${value}[]) => ${value}[] }`;
}

export function indexPlanType(
  artifact: Extract<CompiledArtifact, { readonly kind: "index-plan" }>,
  typeNames: TypeNames
): string {
  const schema = resolveWrappers(artifact.schema).base;
  const row =
    schema.type === TypeName.array
      ? (schema.def as ATS.ElementDef).element
      : schema.type === TypeName.runtimeType
        ? (schema.def as ATS.RuntimeTypeDef).innerType
        : schema;
  const value = namedType(row, typeNames);
  const leaf = artifact.descriptor.shape === "grouped" ? `${value}[]` : value;
  // Compound keys nest one Map per level; key types stay `unknown` because the
  // generated module is read back through the declaration, not the schema.
  let index = `Map<unknown, ${leaf}>`;

  for (let level = artifact.descriptor.keys.length - 1; level > 0; level--) {
    index = `Map<unknown, ${index}>`;
  }
  return `((value: readonly ${value}[]) => ${index}) & { readonly cached: (value: readonly ${value}[]) => ${index} }`;
}

/**
 * A lookup answers one row or nothing. The key type comes from the row's own
 * declared field, so the generated declaration is as precise as the schema.
 */
export function lookupPlanType(
  artifact: Extract<CompiledArtifact, { readonly kind: "lookup-plan" }>,
  typeNames: TypeNames
): string {
  const schema = resolveWrappers(artifact.schema).base;
  const row =
    schema.type === TypeName.array
      ? (schema.def as ATS.ElementDef).element
      : schema.type === TypeName.runtimeType
        ? (schema.def as ATS.RuntimeTypeDef).innerType
        : schema;
  const value = namedType(row, typeNames);
  const key = `${value}[${JSON.stringify(artifact.lookup.key)}]`;

  return `(value: readonly ${value}[], key: ${key}) => ${value} | undefined`;
}

export function migrationPlanType(
  artifact: Extract<CompiledArtifact, { readonly kind: "migration-plan" }>,
  typeNames: TypeNames
): string {
  const inputs = artifact.descriptor.schemas.map((schema) => namedType(schema, typeNames));
  const output = inputs[inputs.length - 1] ?? "unknown";

  return `(value: ${inputs.join(" | ") || "unknown"}) => ${output}`;
}

export function csvPlanType(
  artifact: Extract<CompiledArtifact, { readonly kind: "csv-plan" }>,
  typeNames: TypeNames
): string {
  const row = namedType(artifact.descriptor.schema, typeNames);

  if (artifact.descriptor.operation === "stringify") {
    return artifact.descriptor.sink === "iterator"
      ? `(value: readonly ${row}[]) => IterableIterator<string>`
      : `(value: readonly ${row}[]) => string`;
  }
  if (artifact.descriptor.sink === "iterator")
    return `(input: string | Uint8Array | Iterable<string | Uint8Array>) => IterableIterator<${row}>`;
  if (artifact.descriptor.sink === "visitor")
    return `(input: string | Uint8Array | Iterable<string | Uint8Array>, consume: (row: ${row}, index: number) => void) => number`;
  return `(input: string | Uint8Array | Iterable<string | Uint8Array>) => ${row}[]`;
}

export function ndjsonPlanType(
  artifact: Extract<CompiledArtifact, { readonly kind: "ndjson-plan" }>,
  typeNames: TypeNames
): string {
  const row = namedType(artifact.descriptor.outputSchema, typeNames);

  if (artifact.descriptor.operation === "stringify") {
    return artifact.descriptor.sink === "iterator"
      ? `(value: readonly ${row}[]) => IterableIterator<string>`
      : `(value: readonly ${row}[]) => string`;
  }
  const input = "string | Uint8Array | Iterable<string | Uint8Array>";
  if (artifact.descriptor.sink === "iterator") return `(input: ${input}) => IterableIterator<${row}>`;
  if (artifact.descriptor.sink === "visitor")
    return `(input: ${input}, consume: (row: ${row}, index: number) => void) => number`;
  if (artifact.descriptor.sink === "ndjson") return `(input: ${input}) => string`;
  return `(input: ${input}) => ${row}[]`;
}

/** The projection's own schema already describes the result, so it types itself. */
export function projectPlanType(
  artifact: Extract<CompiledArtifact, { readonly kind: "project-plan" }>,
  typeNames: TypeNames
): string {
  return `(value: ${namedType(artifact.schema, typeNames)}) => ${emitTypeScriptType(artifact.tree.schema, typeNames)}`;
}

/** The mask's width follows its representation, and `has` accepts only watched paths. */
export function changedPlanType(
  artifact: Extract<CompiledArtifact, { readonly kind: "changed-plan" }>,
  typeNames: TypeNames
): string {
  const value = namedType(artifact.schema, typeNames);
  const mask = artifact.descriptor.representation === "bigint" ? "bigint" : "number";
  const paths = artifact.descriptor.fields.map((field) => JSON.stringify(field.path)).join(" | ");

  return `((left: ${value}, right: ${value}) => ${mask}) & { has(mask: ${mask}, path: ${paths}): boolean; readonly fields: readonly (${paths})[] }`;
}

export function patchPlanType(
  artifact: Extract<CompiledArtifact, { readonly kind: "patch-plan" }>,
  typeNames: TypeNames
): string {
  const value = namedType(artifact.schema, typeNames);

  return artifact.mode === "merge"
    ? `(value: ${value}, patch: unknown) => ${value}`
    : `(value: ${value}, operations: readonly { readonly op: string; readonly path: string; readonly value?: unknown; readonly from?: string }[]) => ${value}`;
}

/** Actions are literals, so the generated ability only admits ones a rule declared. */
export function accessPlanType(
  artifact: Extract<CompiledArtifact, { readonly kind: "access-plan" }>,
  typeNames: TypeNames
): string {
  const subject = namedType(artifact.schema, typeNames);
  const actor = artifact.descriptor.actor === undefined ? "unknown" : namedType(artifact.descriptor.actor, typeNames);
  const actions = artifact.descriptor.actions.map((action) => JSON.stringify(action)).join(" | ") || "never";
  const check = `(action: ${actions}, subject?: ${subject}, field?: keyof ${subject} & string) => boolean`;

  const fields = `(action: ${actions}, subject?: ${subject}) => readonly (keyof ${subject} & string)[]`;
  const explain = `(action: ${actions}, subject?: ${subject}, field?: keyof ${subject} & string) => { readonly allowed: boolean; readonly reason?: string; readonly ruleId?: string; readonly matchedProhibition?: boolean }`;

  return `(actor: ${actor}) => { can: ${check}; cannot: ${check}; assert(action: ${actions}, subject: ${subject}, field?: keyof ${subject} & string): ${subject}; explain: ${explain}; fields: ${fields} }`;
}

/** Rule IDs and the optional input object remain literal/structural in generated TypeScript. */
export function rulesPlanType(
  artifact: Extract<CompiledArtifact, { readonly kind: "rules-plan" }>,
  typeNames: TypeNames
): string {
  const descriptor = artifact.descriptor;
  const subject = namedType(artifact.schema, typeNames);
  const ids = descriptor.ids.map((id) => JSON.stringify(id)).join(" | ") || "never";
  const outcomes = descriptor.rules
    .map((rule) => rule.outcome)
    .filter((outcome) => outcome !== undefined)
    .map((outcome) => namedType(outcome.type, typeNames));
  const outcome = outcomes.length === 0 ? "never" : [...new Set(outcomes)].join(" | ");
  const inputs = descriptor.inputs;
  const input = inputs === undefined ? "" : `, inputs: ${namedType(inputs, typeNames)}`;
  const list = `subjects: readonly ${subject}[]`;
  const consume = `consume: (rule: ${ids}, outcome: (${outcome}) | undefined) => void`;
  const manyConsume = `consume: (rule: ${ids}, outcome: (${outcome}) | undefined, index: number) => void`;
  const signatures = {
    test: `(rule: ${ids}, subject: ${subject}${input}) => boolean`,
    some: `(subject: ${subject}${input}) => boolean`,
    first: `(subject: ${subject}${input}) => ${ids} | undefined`,
    match: `(subject: ${subject}${input}) => (${ids})[]`,
    run: `(subject: ${subject}${input}) => (${outcome})[]`,
    explain: `(subject: ${subject}${input}) => { readonly matched: readonly (${ids})[]; readonly evaluated: readonly (${ids})[] }`,
    predicate: `(subject: ${subject}${input}) => boolean`,
    visitor: `(subject: ${subject}${input}, ${consume}) => number`,
    iterator: `(subject: ${subject}${input}) => IterableIterator<${outcome}>`,
    many: `(${list}${input}) => (${outcome})[]`,
    "many-visitor": `(${list}${input}, ${manyConsume}) => number`,
    "many-iterator": `(${list}${input}) => IterableIterator<${outcome}>`,
  } as const;

  if (artifact.sink !== "plan") return signatures[artifact.sink];

  // The signature is parenthesized: without it the intersection would attach to
  // the return type instead of to the callable itself.
  const manyPlan = `((${signatures.many})) & { readonly to: { visitor(): ${signatures["many-visitor"]}; iterator(): ${signatures["many-iterator"]} } }`;

  return [
    "{",
    `readonly test: ${signatures.test};`,
    `readonly some: ${signatures.some};`,
    `readonly first: ${signatures.first};`,
    `readonly match: ${signatures.match};`,
    `readonly run: ${signatures.run};`,
    `readonly explain: ${signatures.explain};`,
    `readonly predicate: (rule: ${ids}) => ${signatures.predicate};`,
    `readonly many: () => ${manyPlan};`,
    `readonly to: { visitor(): ${signatures.visitor}; iterator(): ${signatures.iterator} };`,
    `readonly ids: readonly (${ids})[];`,
    "}",
  ].join(" ");
}

export type TypeNames = ReadonlyMap<ATS.AnyTypeSchema, string> | undefined;

/** Relative type-import path from generated TypeScript to its declaration. */
function typeImportSpecifier(outDir: string, sourceFile: string): string {
  const relativePath = relative(
    resolve(/* turbopackIgnore: true */ outDir),
    resolve(/* turbopackIgnore: true */ sourceFile)
  )
    .split("\\")
    .join("/");
  const mapped = relativePath
    .replace(/\.mts$/, ".mjs")
    .replace(/\.cts$/, ".cjs")
    .replace(/\.ts$/, ".js");

  return mapped.startsWith(".") ? mapped : `./${mapped}`;
}

/** A declared schema keeps its name; anything else is inlined structurally. */
export function namedType(schema: ATS.AnyTypeSchema | undefined, typeNames: TypeNames, fallback = "unknown"): string {
  if (!schema) return fallback;
  return typeNames?.get(schema) ?? emitTypeScriptType(schema, typeNames);
}

export function standaloneType(
  artifact: Extract<CompiledArtifact, { readonly kind: "validator" }>,
  typeNames: TypeNames
): string {
  return validatorType(artifact.op, namedType(artifact.schema, typeNames));
}

function validatorType(op: Extract<CompiledArtifact, { readonly kind: "validator" }>["op"], valueType: string): string {
  switch (op) {
    case "is":
      return `(value: unknown) => value is ${valueType}`;
    case "parse":
      return `(value: unknown) => ${valueType}`;
    case "safeParse":
      return `(value: unknown) => { readonly success: true; readonly data: ${valueType} } | { readonly success: false; readonly issues: readonly { readonly path: string; readonly code: string; readonly expected: string; readonly message: string; readonly received?: string }[] }`;
    case "parseAsync":
      return `(value: unknown) => Promise<${valueType}>`;
    case "safeParseAsync":
      return `(value: unknown) => Promise<{ readonly success: true; readonly data: ${valueType} } | { readonly success: false; readonly issues: readonly { readonly path: string; readonly code: string; readonly expected: string; readonly message: string; readonly received?: string }[] }>`;
  }
}

export function operationType(
  artifact: Extract<CompiledArtifact, { readonly kind: "operation" }>,
  typeNames: TypeNames
): string {
  return operationSignature(artifact.op, namedType(artifact.schema, typeNames));
}

function operationSignature(
  op: Extract<CompiledArtifact, { readonly kind: "operation" }>["op"],
  valueType: string
): string {
  switch (op) {
    case "hash":
      return `(value: ${valueType}) => number`;
    case "equal":
      return `(left: ${valueType}, right: ${valueType}) => boolean`;
    case "clone":
      return `(value: ${valueType}) => ${valueType}`;
    case "diff":
      return `(left: ${valueType}, right: ${valueType}) => readonly { readonly type: "add" | "remove" | "update"; readonly path: readonly PropertyKey[]; readonly value?: unknown }[]`;
    case "mask":
    case "sanitize":
      return `(value: ${valueType}) => ${valueType}`;
    case "stringify":
      return `(value: ${valueType}) => string`;
    case "fromJSON":
      return `(json: string) => ${valueType}`;
    case "format":
      return `(value: string) => string`;
    case "codec":
      return `{ readonly encode: (value: ${valueType}) => Uint8Array; readonly encodeInto: (value: ${valueType}, target: Uint8Array) => number; readonly decode: (bytes: Uint8Array | ArrayBuffer) => ${valueType} }`;
    case "jsonSchema":
      return "{ readonly [key: string]: unknown }";
    case "mock":
      return `(options?: { readonly seed?: number }) => ${valueType}`;
    case "update":
      // The patch is a deep-partial applied at run time, so it stays loose
      // here rather than restating the whole shape a second time.
      return `(value: ${valueType}, patch: unknown) => ${valueType}`;
  }
}

export function executionPlanType(plan: ExecutionPlan, typeNames: TypeNames): string {
  const valueType = namedType(plan.schema, typeNames);
  const last = plan.stages[plan.stages.length - 1];
  const operation = plan.stages.find((stage) => stage.kind === "operation");
  const map = plan.stages.find((stage) => stage.kind === "map");
  const query = plan.stages.find((stage) => stage.kind === "query");
  const aggregate = plan.stages.find((stage) => stage.kind === "aggregate");
  const hasJsonDecode = plan.stages.some((stage) => stage.kind === "json.decode");
  const hasBinaryDecode = plan.stages.some((stage) => stage.kind === "binary.decode");
  const valueSource = plan.stages.find((stage) => stage.kind === "value");

  if (operation?.kind === "operation") return operationSignature(operation.operation, valueType);

  if (last?.kind === "validate") {
    if (last.operation === "parse" && hasJsonDecode) return `(json: string) => ${valueType}`;
    if (last.operation === "parse" && hasBinaryDecode) return `(bytes: Uint8Array | ArrayBuffer) => ${valueType}`;
    return validatorType(last.operation === "issues" ? "safeParse" : last.operation, valueType);
  }

  const inputType = hasJsonDecode
    ? "string"
    : hasBinaryDecode
      ? "Uint8Array | ArrayBuffer"
      : valueSource?.kind === "value" && valueSource.schema
        ? namedType(valueSource.schema, typeNames)
        : map?.kind === "map"
          ? map.many
            ? `readonly ${namedType(map.source, typeNames)}[]`
            : namedType(map.source, typeNames)
          : query?.kind === "query"
            ? namedType(query.source, typeNames)
            : valueType;

  if (last?.kind === "json.encode") {
    return last.mode === "chunks"
      ? `(value: ${inputType}) => IterableIterator<string>`
      : `(value: ${inputType}) => string`;
  }
  if (last?.kind === "binary.encode") return `(value: ${inputType}) => Uint8Array`;
  if (aggregate?.kind === "aggregate") {
    const output = aggregate.operation === "count" || aggregate.operation === "sum" ? "number" : "number | undefined";
    return `(value: ${inputType}) => ${output}`;
  }
  if (hasJsonDecode) return `(json: string) => ${valueType}`;
  if (hasBinaryDecode) return `(bytes: Uint8Array | ArrayBuffer) => ${valueType}`;
  if (map?.kind === "map") return `(value: ${inputType}) => ${valueType}`;
  if (query?.kind === "query") return `(value: ${inputType}) => ${valueType}`;
  if (plan.stages.some((stage) => stage.kind === "transform" || stage.kind === "update" || stage.kind === "security")) {
    return `(value: ${inputType}) => ${valueType}`;
  }
  return "unknown";
}
