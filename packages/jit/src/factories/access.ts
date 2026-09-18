import {
  type AccessRule,
  compileAccess,
  registerAccessAbility,
  resolveAccessDescriptor,
  unconditionalFields,
} from "../compiler/access.js";
import type { QueryCompareNode, QueryConditionNode } from "../core/ast/index.js";
import type * as ATS from "../core/ats/index.js";
import type { SchemaInput } from "../core/builder/index.js";
import { unwrapSchema } from "../core/builder/index.js";
import { registerArtifact } from "../runtime/artifact-registry.js";

type Field<TValue> = Extract<keyof TValue, string>;

/**
 * A reference to one of the actor's fields, resolved when the ability is built.
 *
 * @example
 * ```ts
 * const ability = JIT.access(Document)
 *   .actor(Actor)
 *   .can("read", (query, actor) => query.eq("ownerId", actor.field("id")))({ id: "ada" });
 * ability.can("read", { ownerId: "ada" }); // true
 * ```
 */
export interface ActorRef<TActor> {
  /** References an actor field for use in a subject condition. */
  field<TKey extends Field<TActor>>(key: TKey): { readonly kind: "param"; readonly name: TKey };
}

/**
 * The condition builder, over the subject.
 *
 * This is the query condition builder: the same operators, the same AST. A rule
 * is a filter over one row, so there is no reason for it to be a different
 * language — and reusing it is what lets a rule be pushed into a query later.
 *
 * @example
 * ```ts
 * const ownsDocument = (query, actor) => query.eq("ownerId", actor.field("id"));
 * ```
 */
export interface AccessConditionBuilder<TSubject, TActor> {
  /** Requires a subject field to equal a literal or actor field. */
  eq<TKey extends Field<TSubject>>(key: TKey, value: AccessOperand<TSubject[TKey], TActor>): QueryCompareNode;
  /** Requires a subject field not to equal a literal or actor field. */
  neq<TKey extends Field<TSubject>>(key: TKey, value: AccessOperand<TSubject[TKey], TActor>): QueryCompareNode;
  /** Requires a subject field to be greater than a literal or actor field. */
  gt<TKey extends Field<TSubject>>(key: TKey, value: AccessOperand<TSubject[TKey], TActor>): QueryCompareNode;
  /** Requires a subject field to be greater than or equal to a literal or actor field. */
  gte<TKey extends Field<TSubject>>(key: TKey, value: AccessOperand<TSubject[TKey], TActor>): QueryCompareNode;
  /** Requires a subject field to be less than a literal or actor field. */
  lt<TKey extends Field<TSubject>>(key: TKey, value: AccessOperand<TSubject[TKey], TActor>): QueryCompareNode;
  /** Requires a subject field to be less than or equal to a literal or actor field. */
  lte<TKey extends Field<TSubject>>(key: TKey, value: AccessOperand<TSubject[TKey], TActor>): QueryCompareNode;
  /** Combines conditions with logical AND. */
  and(left: QueryConditionNode, right: QueryConditionNode, ...rest: readonly QueryConditionNode[]): QueryConditionNode;
  /** Combines conditions with logical OR. */
  or(left: QueryConditionNode, right: QueryConditionNode, ...rest: readonly QueryConditionNode[]): QueryConditionNode;
  /** Negates one condition. */
  not(inner: QueryConditionNode): QueryConditionNode;
}

type AccessOperand<TValue, TActor> = TValue | { readonly kind: "param"; readonly name: Field<TActor> };

/**
 * Builds the condition for an access rule.
 *
 * @example
 * ```ts
 * const ownsDocument: AccessPredicate<{ ownerId: string }, { id: string }> = (query, actor) =>
 *   query.eq("ownerId", actor.field("id"));
 * ```
 */
export type AccessPredicate<TSubject, TActor> = (
  query: AccessConditionBuilder<TSubject, TActor>,
  actor: ActorRef<TActor>
) => QueryConditionNode;

/**
 * Optional field, condition and diagnostic metadata for one access rule.
 *
 * @example
 * ```ts
 * const rule: AccessRuleOptions<{ ownerId: string; title: string }, { id: string }> = {
 *   fields: ["title"],
 *   when: (query, actor) => query.eq("ownerId", actor.field("id")),
 *   id: "document-owner",
 * };
 * ```
 */
export interface AccessRuleOptions<TSubject, TActor> {
  readonly fields?: readonly Field<TSubject>[];
  readonly when?: AccessPredicate<TSubject, TActor>;
  readonly id?: string;
  readonly reason?: string;
}

/**
 * The structured explanation returned by an authorization decision.
 *
 * @example
 * ```ts
 * const explanation: AccessExplanation<{ id: string }> = ability.explain("read", { id: "doc-1" });
 * explanation.allowed; // true or false
 * ```
 */
export interface AccessExplanation<TSubject> {
  readonly allowed: boolean;
  readonly field?: Field<TSubject>;
  readonly reason?: string;
  readonly ruleId?: string;
  readonly matchedProhibition?: boolean;
}

/**
 * The compiled answer for one actor.
 *
 * @example
 * ```ts
 * const ability = plan({ id: "ada" });
 * ability.can("read", { ownerId: "ada" }); // true
 * ability.cannot("delete", { ownerId: "ada" }); // true when no delete rule exists
 * ```
 */
export interface Ability<TSubject, TAction extends string> {
  /** Returns whether the actor may perform `action`. */
  can(action: TAction, subject?: TSubject, field?: Field<TSubject>): boolean;
  /** Returns whether the actor is denied `action`. */
  cannot(action: TAction, subject?: TSubject, field?: Field<TSubject>): boolean;
  /** Returns the subject when authorization succeeds; otherwise throws. */
  assert(action: TAction, subject: TSubject, field?: Field<TSubject>): TSubject;
  /** Explains the matching authorization decision. */
  explain(action: TAction, subject?: TSubject, field?: Field<TSubject>): AccessExplanation<TSubject>;
  /** Lists fields unconditionally allowed for an action. */
  fields(action: TAction, subject?: TSubject): readonly Field<TSubject>[];
}

/**
 * A schema-bound, immutable authorization plan.
 *
 * @example
 * ```ts
 * const plan = JIT.access(Document)
 *   .actor(Actor)
 *   .can("read", (query, actor) => query.eq("ownerId", actor.field("id")));
 * const ability = plan({ id: "ada" });
 * ```
 */
export interface AccessPlan<TSubject, TActor, TAction extends string> {
  /** Builds an actor-bound ability. */
  (actor: TActor): Ability<TSubject, TAction>;
  /** Adds an allow rule for `action`. */
  can<const TNext extends string>(
    action: TNext,
    rule?: AccessPredicate<TSubject, TActor> | AccessRuleOptions<TSubject, TActor>
  ): AccessPlan<TSubject, TActor, TAction | TNext>;
  /** Adds a deny rule for `action`; deny wins when both rules match. */
  cannot<const TNext extends string>(
    action: TNext,
    rule?: AccessPredicate<TSubject, TActor> | AccessRuleOptions<TSubject, TActor>
  ): AccessPlan<TSubject, TActor, TAction | TNext>;
  /** Every action any rule mentions. */
  readonly actions: readonly TAction[];
  /**
   * The fields an action may touch when that can be settled without a subject,
   * or `undefined` when it may touch all of them. A conditional rule cannot be
   * resolved here, so it contributes nothing.
   */
  fields(action: TAction): readonly Field<TSubject>[] | undefined;
}

/**
 * Starts an authorization plan for a subject schema.
 *
 * @example
 * ```ts
 * const plan = JIT.access(Document)
 *   .actor(Actor)
 *   .can("read", (query, actor) => query.eq("ownerId", actor.field("id")));
 * ```
 */
export interface AccessBuilder<TSubject> extends AccessPlan<TSubject, unknown, never> {
  /** Declares the actor's shape, which is what `actor.field()` is checked against. */
  actor<TActorSchema extends ATS.AnyTypeSchema>(
    schema: SchemaInput<TActorSchema>
  ): AccessPlan<TSubject, ATS.TypeofSchema<TActorSchema>, never>;
}

/**
 * Compiled authorization.
 *
 * Rules are declared against a schema, so the actions are known and the checks
 * are a switch over string literals rather than a scan of a rule array. Nothing
 * is denied by omission alone: an action with no rule is refused, and a
 * `cannot` overrides a `can` that matched the same action and field.
 *
 * @example
 * ```ts
 * const Document = JIT.object({ ownerId: JIT.string() });
 * const Actor = JIT.object({ id: JIT.string() });
 * const ability = JIT.access(Document)
 *   .actor(Actor)
 *   .can("read", (query, actor) => query.eq("ownerId", actor.field("id")))({ id: "ada" });
 * ability.can("read", { ownerId: "ada" }); // true
 * ```
 */
export function access<TSchema extends ATS.AnyTypeSchema>(
  schema: SchemaInput<TSchema>
): AccessBuilder<ATS.TypeofSchema<TSchema>> {
  return createPlan(unwrapSchema(schema), undefined, []) as AccessBuilder<ATS.TypeofSchema<TSchema>>;
}

type AnyPlan = AccessPlan<unknown, unknown, string> & {
  actor?: (schema: SchemaInput<ATS.AnyTypeSchema>) => AnyPlan;
};

function createPlan(
  subject: ATS.AnyTypeSchema,
  actor: ATS.AnyTypeSchema | undefined,
  rules: readonly AccessRule[]
): AnyPlan {
  const descriptor = resolveAccessDescriptor(subject, actor, rules);
  const compiled = compileAccess<unknown, Ability<unknown, string>>(descriptor);
  const plan = ((actorValue: unknown) => {
    const ability = compiled(actorValue);
    registerAccessAbility(ability as object, descriptor, actorValue);
    return ability;
  }) as AnyPlan;
  const add = (effect: "can" | "cannot") => (action: string, rule?: unknown) =>
    createPlan(subject, actor, [...rules, toRule(effect, action, rule)]);

  Object.defineProperties(plan, {
    actor: { value: (next: SchemaInput<ATS.AnyTypeSchema>) => createPlan(subject, unwrapSchema(next), rules) },
    can: { value: add("can") },
    cannot: { value: add("cannot") },
    actions: { value: descriptor.actions },
    fields: { value: (action: string) => unconditionalFields(descriptor, action) },
  });
  registerArtifact(plan, { kind: "access-plan", schema: subject, descriptor });
  return plan;
}

function toRule(effect: "can" | "cannot", action: string, rule: unknown): AccessRule {
  if (rule === undefined) return { effect, action };
  if (typeof rule === "function") {
    return {
      effect,
      action,
      condition: (rule as (query: unknown, actor: unknown) => QueryConditionNode)(CONDITION, ACTOR),
    };
  }

  const options = rule as AccessRuleOptions<Record<string, unknown>, Record<string, unknown>>;

  return {
    effect,
    action,
    fields: options.fields,
    metadata:
      options.id === undefined && options.reason === undefined
        ? undefined
        : Object.freeze({
            ...(options.id === undefined ? {} : { id: options.id }),
            ...(options.reason === undefined ? {} : { reason: options.reason }),
          }),
    condition:
      options.when === undefined
        ? undefined
        : (options.when as (query: unknown, actor: unknown) => QueryConditionNode)(CONDITION, ACTOR),
  };
}

/** The subject side of a comparison is a field; the other side is a literal or an actor reference. */
const CONDITION = Object.freeze({
  ...Object.fromEntries(
    (["eq", "neq", "gt", "gte", "lt", "lte"] as const).map((op) => [
      op,
      (key: string, value: unknown) => ({
        kind: "compare" as const,
        op,
        left: { kind: "field" as const, key },
        right: isActorRef(value) ? value : { kind: "literal" as const, value },
      }),
    ])
  ),
  and: (...nodes: QueryConditionNode[]) => fold("and", nodes),
  or: (...nodes: QueryConditionNode[]) => fold("or", nodes),
  not: (inner: QueryConditionNode) => ({ kind: "not" as const, inner }),
}) as unknown as AccessConditionBuilder<Record<string, unknown>, Record<string, unknown>>;

const ACTOR: ActorRef<Record<string, unknown>> = Object.freeze({
  field: (key: string) => ({ kind: "param" as const, name: key }),
}) as never;

function isActorRef(value: unknown): value is { readonly kind: "param"; readonly name: string } {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "param";
}

function fold(op: "and" | "or", nodes: readonly QueryConditionNode[]): QueryConditionNode {
  return nodes.reduce((left, right) => ({ kind: "logical" as const, op, left, right }));
}
