import type { QueryConditionNode, QueryValueNode } from "../core/ast/index.js";
import { JITError } from "../errors/index.js";
import { type AccessDescriptor, accessProjectionFields, composeAccessCondition } from "./access.js";
import type { QueryBoundary } from "./query-boundary.js";
import { emitPropertyAccess } from "./source/access.js";

/**
 * What one actor may ask a public boundary for.
 *
 * The boundary says what a consumer is allowed to express and access says what
 * this actor is allowed to reach; the effective request is their intersection.
 * Neither the rules nor an access node reach the adapter — only the ordinary
 * filter, projection, ordering and pagination of the V1 protocol do.
 */
export interface ApiAuthorization {
  /** Fields the actor may read, or `undefined` when the action reads them all. */
  readonly fields: readonly string[] | undefined;
  /** Source of the actor's row predicate, in the portable condition shape. */
  readonly conditionSource: string | undefined;
  /** Declared rule values; they travel as bindings, never interpolated. */
  readonly bindings: readonly unknown[];
  /** True when no request by this actor can be authorized at all. */
  readonly denied: boolean;
}

/**
 * Resolves the static half of the intersection once, against the plan.
 *
 * The actor is not known here: rules that reference actor fields compile into
 * a specialized builder that reads them directly, so a request pays one object
 * construction rather than a walk over the rule set.
 */
export function resolveApiAuthorization(
  boundary: QueryBoundary,
  descriptor: AccessDescriptor,
  action: string
): ApiAuthorization {
  if (!descriptor.actions.includes(action)) {
    throw new JITError("INVALID_QUERY", `API query authorization action ${JSON.stringify(action)} has no access rule`);
  }
  const composed = composeAccessCondition(descriptor, action);
  if (composed.kind === "deny") {
    return Object.freeze({
      fields: Object.freeze([]),
      conditionSource: undefined,
      bindings: Object.freeze([]),
      denied: true,
    });
  }
  const allowed = accessProjectionFields(descriptor, action);
  const fields = allowed === undefined ? undefined : Object.freeze([...allowed]);
  if (fields !== undefined && fields.length === 0) {
    return Object.freeze({ fields, conditionSource: undefined, bindings: Object.freeze([]), denied: true });
  }
  for (const field of boundary.fields) {
    // A filter over a field the actor cannot read is an oracle: it answers
    // questions about a hidden column one request at a time.
    if (fields !== undefined && !fields.includes(field.path[0] as string)) {
      throw new JITError(
        "INVALID_QUERY",
        `API query filter field ${JSON.stringify(field.path.join("."))} is not readable by access action ${JSON.stringify(action)}`
      );
    }
  }
  if (composed.condition === undefined) {
    return Object.freeze({ fields, conditionSource: undefined, bindings: Object.freeze([]), denied: false });
  }
  const bindings: unknown[] = [];
  const conditionSource = emitStandardCondition(composed.condition, bindings);
  return Object.freeze({ fields, conditionSource, bindings: Object.freeze(bindings), denied: false });
}

/**
 * Intersects one parsed request with the authorization, in generated source.
 *
 * `request` and `actor` are in scope; the result is the effective request an
 * adapter receives. Every branch that the plan already settled statically is
 * absent from the emitted body.
 */
export function emitApiAuthorizationBody(authorization: ApiAuthorization, action: string): string {
  const deny = `throw new __AccessDeniedError(${JSON.stringify(action)}, undefined, "access-denied", undefined);`;
  if (authorization.denied) return deny;

  const parts: string[] = [];
  const { fields } = authorization;
  if (fields !== undefined) {
    const readable = fields.map((field) => JSON.stringify(field));
    const unreadable = (value: string) => readable.map((field) => `${value} !== ${field}`).join(" && ") || "true";
    parts.push(
      `const sort = request.sort; for (let i = 0; i < sort.length; i++) { const field = sort[i].path[0]; if (${unreadable(
        "field"
      )}) { ${deny} } }`
    );
    parts.push(
      `let select = request.select; if (select === undefined) select = ${JSON.stringify(fields)}; else { const kept = []; for (let i = 0; i < select.length; i++) { const field = select[i]; if (!(${unreadable("field")})) kept[kept.length] = field; } if (kept.length === 0) { ${deny} } select = kept; }`
    );
  } else {
    parts.push("const sort = request.sort;");
    parts.push("const select = request.select;");
  }
  parts.push(
    'const conditions = request.filter; let filter; for (let i = 0; i < conditions.length; i++) { const condition = conditions[i]; const compare = { kind: "compare", operator: condition.kind, left: { kind: "field", path: condition.path }, right: { kind: "literal", value: condition.value } }; filter = filter === undefined ? compare : { kind: "logical", operator: "and", left: filter, right: compare }; }'
  );
  if (authorization.conditionSource !== undefined) {
    parts.push(
      `const guard = ${authorization.conditionSource}; filter = filter === undefined ? guard : { kind: "logical", operator: "and", left: filter, right: guard };`
    );
  }
  parts.push(
    "const pagination = request.pagination; return { ...(filter === undefined ? {} : { filter }), sort, ...(select === undefined ? {} : { select }), ...(pagination === undefined ? {} : { pagination }) };"
  );
  return parts.join(" ");
}

function emitStandardCondition(condition: QueryConditionNode, bindings: unknown[]): string {
  if (condition.kind === "logical") {
    return `{ kind: "logical", operator: ${JSON.stringify(condition.op)}, left: ${emitStandardCondition(
      condition.left,
      bindings
    )}, right: ${emitStandardCondition(condition.right, bindings)} }`;
  }
  if (condition.kind === "not") return `{ kind: "not", inner: ${emitStandardCondition(condition.inner, bindings)} }`;
  return `{ kind: "compare", operator: ${JSON.stringify(condition.op)}, left: ${emitStandardValue(
    condition.left,
    bindings
  )}, right: ${emitStandardValue(condition.right, bindings)} }`;
}

function emitStandardValue(value: QueryValueNode, bindings: unknown[]): string {
  if (value.kind === "field") return `{ kind: "field", path: ${JSON.stringify([value.key])} }`;
  // A declared rule value travels as an external binding, never interpolated.
  if (value.kind === "literal") {
    bindings.push(value.value);
    return `{ kind: "literal", value: __q${bindings.length - 1} }`;
  }
  // An actor reference resolves to the actor's own value at request time, so it
  // reaches the adapter as a literal rather than as an unresolved parameter.
  if (value.kind === "param") return `{ kind: "literal", value: ${emitPropertyAccess("actor", value.name)} }`;
  return `{ kind: "binding", name: ${JSON.stringify(value.name)} }`;
}
