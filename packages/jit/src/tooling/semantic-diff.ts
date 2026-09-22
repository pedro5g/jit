import type {
  AgentDeclaration,
  DeclarationCheck,
  DeclarationProjectV1,
  DeclarationSchema,
} from "./declaration-protocol.js";

/** A machine-readable semantic change reported before an artifact is regenerated. */
export interface SemanticDeclarationChange {
  readonly symbol: string;
  readonly change:
    | "declared"
    | "removed"
    | "declaration-changed"
    | "module-moved"
    | "validation-tightened"
    | "validation-relaxed"
    | "validation-changed";
  readonly path: readonly string[];
}

/** Compares two declaration revisions without inspecting generated source. */
export function diffDeclarationProjects(
  previous: DeclarationProjectV1 | undefined,
  current: DeclarationProjectV1
): readonly SemanticDeclarationChange[] {
  if (previous === undefined) return coarseChanges(current);
  const names = [...new Set([...Object.keys(previous.declarations), ...Object.keys(current.declarations)])].sort(
    compareText
  );
  const changes: SemanticDeclarationChange[] = [];
  for (const name of names) {
    const before = previous.declarations[name];
    const after = current.declarations[name];
    if (before === undefined && after !== undefined) {
      changes.push(change(name, "declared", []));
      continue;
    }
    if (before !== undefined && after === undefined) {
      changes.push(change(name, "removed", []));
      continue;
    }
    if (before !== undefined && after !== undefined) changes.push(...diffDeclaration(name, before, after));
  }
  return changes.length > 0 ? changes : coarseChanges(current);
}

/** Adds declarations whose boundary depends on a changed declaration. */
export function propagateDeclarationChanges(
  current: DeclarationProjectV1,
  changes: readonly SemanticDeclarationChange[]
): readonly SemanticDeclarationChange[] {
  const result = [...changes];
  const known = new Set(result.map((change) => change.symbol));
  const changed = new Set(result.filter((change) => change.change !== "removed").map((change) => change.symbol));

  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const [name, declaration] of Object.entries(current.declarations)) {
      if (known.has(name) || !schemaReferences(declaration.schema, changed)) continue;
      result.push(change(name, "declaration-changed", []));
      known.add(name);
      changed.add(name);
      expanded = true;
    }
  }

  return result.sort(
    (left, right) => compareText(left.symbol, right.symbol) || compareText(left.path.join("."), right.path.join("."))
  );
}

function coarseChanges(project: DeclarationProjectV1): readonly SemanticDeclarationChange[] {
  return Object.keys(project.declarations)
    .sort(compareText)
    .map((symbol) => change(symbol, "declaration-changed", []));
}

function diffDeclaration(
  symbol: string,
  before: AgentDeclaration,
  after: AgentDeclaration
): readonly SemanticDeclarationChange[] {
  const changes: SemanticDeclarationChange[] = [];
  if (before.module !== after.module) changes.push(change(symbol, "module-moved", []));
  const schemaChanges = diffSchema(symbol, before.schema, after.schema, []);
  changes.push(...schemaChanges);
  if (schemaChanges.length === 0 && !sameDeclarationMetadata(before, after)) {
    changes.push(change(symbol, "declaration-changed", []));
  }
  return changes;
}

function diffSchema(
  symbol: string,
  before: DeclarationSchema,
  after: DeclarationSchema,
  path: readonly string[]
): readonly SemanticDeclarationChange[] {
  if (before.type !== after.type) return [change(symbol, "validation-changed", path)];
  return diffSameSchemaType(symbol, before, after, path);
}

function diffSameSchemaType(
  symbol: string,
  before: DeclarationSchema,
  after: DeclarationSchema,
  path: readonly string[]
): readonly SemanticDeclarationChange[] {
  switch (before.type) {
    case "object":
      return diffObjectSchema(symbol, before, after as Extract<DeclarationSchema, { readonly type: "object" }>, path);
    case "array": {
      const next = after as Extract<DeclarationSchema, { readonly type: "array" }>;
      return diffSchema(symbol, before.element, next.element, path);
    }
    case "union": {
      const next = after as Extract<DeclarationSchema, { readonly type: "union" }>;
      return sameJson(before.options, next.options) ? [] : [change(symbol, "validation-changed", path)];
    }
    case "literal": {
      const next = after as Extract<DeclarationSchema, { readonly type: "literal" }>;
      return sameJson(before.value, next.value) ? [] : [change(symbol, "validation-changed", path)];
    }
    case "ref": {
      const next = after as Extract<DeclarationSchema, { readonly type: "ref" }>;
      return before.name === next.name ? [] : [change(symbol, "validation-changed", path)];
    }
    default: {
      const next = after as Extract<DeclarationSchema, { readonly type: "string" | "number" | "boolean" | "bigint" }>;
      return diffChecks(symbol, before.checks ?? [], next.checks ?? [], path);
    }
  }
}

function diffObjectSchema(
  symbol: string,
  before: Extract<DeclarationSchema, { readonly type: "object" }>,
  after: Extract<DeclarationSchema, { readonly type: "object" }>,
  path: readonly string[]
): readonly SemanticDeclarationChange[] {
  const fields = [...new Set([...Object.keys(before.fields), ...Object.keys(after.fields)])].sort(compareText);
  const changes: SemanticDeclarationChange[] = [];
  for (const field of fields) {
    const beforeField = before.fields[field];
    const afterField = after.fields[field];
    const fieldPath = [...path, field];
    if (beforeField === undefined && afterField !== undefined) {
      changes.push(change(symbol, "validation-tightened", fieldPath));
    } else if (beforeField !== undefined && afterField === undefined) {
      changes.push(change(symbol, "validation-relaxed", fieldPath));
    } else if (beforeField !== undefined && afterField !== undefined) {
      changes.push(...diffSchema(symbol, beforeField, afterField, fieldPath));
    }
  }
  return changes;
}

function diffChecks(
  symbol: string,
  before: readonly DeclarationCheck[],
  after: readonly DeclarationCheck[],
  path: readonly string[]
): readonly SemanticDeclarationChange[] {
  const beforeByKind = new Map(before.map((check) => [check.kind, check]));
  const afterByKind = new Map(after.map((check) => [check.kind, check]));
  const kinds = [...new Set([...beforeByKind.keys(), ...afterByKind.keys()])].sort(compareText);
  const changes: SemanticDeclarationChange[] = [];
  for (const kind of kinds) {
    const previous = beforeByKind.get(kind);
    const current = afterByKind.get(kind);
    if (previous === undefined && current !== undefined) changes.push(change(symbol, "validation-tightened", path));
    else if (previous !== undefined && current === undefined) changes.push(change(symbol, "validation-relaxed", path));
    else if (previous !== undefined && current !== undefined && !sameJson(previous.value, current.value)) {
      changes.push(change(symbol, classifyCheckChange(kind, previous.value, current.value), path));
    }
  }
  return changes;
}

function schemaReferences(schema: DeclarationSchema, names: ReadonlySet<string>): boolean {
  if (schema.type === "ref") return names.has(schema.name);
  if (schema.type === "object") return Object.values(schema.fields).some((child) => schemaReferences(child, names));
  if (schema.type === "array") return schemaReferences(schema.element, names);
  if (schema.type === "union") return schema.options.some((option) => schemaReferences(option, names));
  return false;
}

function classifyCheckChange(
  kind: string,
  before: DeclarationCheck["value"],
  after: DeclarationCheck["value"]
): SemanticDeclarationChange["change"] {
  if (typeof before !== "number" || typeof after !== "number") return "validation-changed";
  if (kind === "min" || kind === "minLength") return after > before ? "validation-tightened" : "validation-relaxed";
  if (kind === "max" || kind === "maxLength") return after < before ? "validation-tightened" : "validation-relaxed";
  return "validation-changed";
}

function sameDeclarationMetadata(before: AgentDeclaration, after: AgentDeclaration): boolean {
  return before.kind === after.kind && before.identity === after.identity && sameJson(before.extends, after.extends);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function change(
  symbol: string,
  kind: SemanticDeclarationChange["change"],
  path: readonly string[]
): SemanticDeclarationChange {
  return { symbol, change: kind, path };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
