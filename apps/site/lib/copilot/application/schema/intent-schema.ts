/**
 * The model's JSON, validated by jit itself — §44.
 *
 * The plan is explicit about this and it is worth stating why it is not merely
 * neat: the copilot's whole claim is that the library is the source of truth,
 * and a hand-written validator for the model's output would be a second,
 * weaker truth sitting right at the point where untrusted text enters the
 * system. Using `safeParse` means the protocol is checked by the same engine
 * the answer is about, and a change to jit's own semantics cannot silently
 * stop applying here.
 *
 * What comes out is either a `SchemaIntent` or a list of issues written the
 * way the retry instruction needs them — path first, then what was wrong.
 */
import { JIT } from "@jit-compiler/jit/runtime";
import {
  MAX_INTENT_DEPTH,
  MAX_INTENT_FIELDS,
  SCHEMA_FIELD_TYPES,
  type SchemaField,
  type SchemaIntent,
} from "../../core/entities/schema-intent";

/** A JSON scalar a validator argument or a default may carry. */
const Scalar = JIT.union(JIT.string(), JIT.number(), JIT.boolean());

const Validator = JIT.object({
  type: JIT.string().min(1).max(40),
  value: Scalar.optional(),
});

const Default = JIT.union(
  JIT.object({ type: JIT.literal("value"), value: JIT.union(Scalar, JIT.null()) }),
  JIT.object({ type: JIT.literal("crypto.randomUUID") }),
  JIT.object({ type: JIT.literal("now") })
);

/**
 * One node, checked one level at a time.
 *
 * The obvious shape for this is `JIT.lazy(() => Field)`, and it is not usable
 * here: a lazy self-reference sitting directly under `.optional()` in an
 * object shape makes the validator emitter inline itself until the stack ends.
 * (Under an array it is fine, which is why `fields` could have kept it and
 * `items` could not.)
 *
 * Validating one level and walking the tree here is better anyway. jit still
 * checks every node — the same schema, applied at each of them — and the walk
 * that was already needed for the depth limit now also owns the paths, so an
 * issue three levels down reads `fields.address.fields.city` instead of a
 * chain of array indices.
 */
const Node = JIT.object({
  name: JIT.string().min(1).max(64),
  type: JIT.enum([...SCHEMA_FIELD_TYPES]),
  optional: JIT.boolean().optional(),
  nullable: JIT.boolean().optional(),
  validators: JIT.array(Validator).optional(),
  default: Default.optional(),
  /** Checked by this same schema on the next pass of the walk. */
  fields: JIT.array(JIT.any()).optional(),
  items: JIT.any().optional(),
  values: JIT.array(JIT.string().min(1)).optional(),
  description: JIT.string().max(200).optional(),
});

const Root = JIT.object({
  kind: JIT.literal("object"),
  name: JIT.string().min(1).max(64).optional(),
  fields: JIT.array(JIT.any()).min(1),
});

/** What `safeParse` hands back, with only the parts this file reads. */
type ParseOutcome = { success: true; data: unknown } | { success: false; issues?: RawIssue[] };
type RawIssue = { path?: (string | number)[]; message?: string; code?: string };

export type IntentParseResult =
  | { ok: true; intent: SchemaIntent }
  | { ok: false; issues: string[]; stage: "json" | "shape" };

/**
 * The first JSON object in a model reply.
 *
 * Small models wrap JSON in a fence, or in a sentence, or in both, and none of
 * that is a reason to lose the answer. Brace matching rather than a regex,
 * because a nested object ends the match early otherwise — and quoted braces
 * inside a description would end it in the wrong place.
 */
export function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const character = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

/** `fields.email.validators[0]: expected one of the enum values` */
function describe(issue: RawIssue, path: string): string {
  const tail = (issue.path ?? []).map((part) => (typeof part === "number" ? `[${part}]` : `.${part}`)).join("");
  return `${path}${tail}: ${issue.message ?? issue.code ?? "invalid"}`;
}

/**
 * Validates one node and everything under it, breadth by depth.
 *
 * Returns nothing: issues accumulate, because a model that got two fields
 * wrong should be told about both in the single retry it gets (§58).
 */
function validateNode(value: unknown, path: string, depth: number, issues: string[]): void {
  if (depth > MAX_INTENT_DEPTH) {
    issues.push(`${path}: nested deeper than ${MAX_INTENT_DEPTH} levels`);
    return;
  }

  const parsed = Node.safeParse(value) as unknown as ParseOutcome;
  if (!parsed.success) {
    for (const issue of parsed.issues ?? []) issues.push(describe(issue, path));
    return;
  }

  const field = parsed.data as SchemaField;

  if (field.type === "object" && (field.fields?.length ?? 0) === 0) {
    issues.push(`${path}: an object field must declare its own fields`);
  }
  if (field.type === "array" && field.items === undefined) {
    issues.push(`${path}: an array field must declare items`);
  }
  if (field.type === "enum" && (field.values?.length ?? 0) === 0) {
    issues.push(`${path}: an enum field must declare values`);
  }

  if (field.fields) validateFields(field.fields, path, depth + 1, issues);
  if (field.items !== undefined) validateNode(field.items, `${path}[]`, depth + 1, issues);
}

function validateFields(fields: readonly unknown[], path: string, depth: number, issues: string[]): void {
  if (fields.length > MAX_INTENT_FIELDS) {
    issues.push(`${path}: ${fields.length} fields, more than the ${MAX_INTENT_FIELDS} allowed`);
  }

  const seen = new Set<string>();

  for (const [index, entry] of fields.entries()) {
    const name = (entry as { name?: unknown })?.name;
    const at = typeof name === "string" && name ? `${path}.${name}` : `${path}[${index}]`;

    if (typeof name === "string") {
      if (seen.has(name)) issues.push(`${at}: declared twice`);
      seen.add(name);
    }

    validateNode(entry, at, depth, issues);
  }
}

/**
 * Text in, intent or issues out. Never throws.
 *
 * The stages are reported apart because the retry that follows differs:
 * unparseable JSON asks for JSON, and a shape violation quotes the field.
 */
export function parseSchemaIntent(text: string): IntentParseResult {
  const json = extractJson(text);
  if (!json) return { ok: false, stage: "json", issues: ["no JSON object in the reply"] };

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    return { ok: false, stage: "json", issues: [error instanceof Error ? error.message : "invalid JSON"] };
  }

  const root = Root.safeParse(value) as unknown as ParseOutcome;
  if (!root.success) {
    return { ok: false, stage: "shape", issues: (root.issues ?? []).map((issue) => describe(issue, "")) };
  }

  const issues: string[] = [];
  const data = root.data as { kind: "object"; name?: string; fields: unknown[] };
  validateFields(data.fields, "fields", 1, issues);

  if (issues.length > 0) return { ok: false, stage: "shape", issues };

  /**
   * Proved node by node above, so the assertion states what jit established
   * rather than assuming it: every node matched `Node`, and every nested one
   * was reached by the same walk.
   */
  return { ok: true, intent: data as SchemaIntent };
}
