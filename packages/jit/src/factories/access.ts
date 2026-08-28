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

/** A reference to one of the actor's fields, resolved when the ability is built. */
export interface ActorRef<TActor> {
  field<TKey extends Field<TActor>>(key: TKey): { readonly kind: "param"; readonly name: TKey };
}

/**
 * The condition builder, over the subject.
 *
 * This is the query condition builder: the same operators, the same AST. A rule
 * is a filter over one row, so there is no reason for it to be a different
 * language — and reusing it is what lets a rule be pushed into a query later.
 */
export interface AccessConditionBuilder<TSubject, TActor> {
  eq<TKey extends Field<TSubject>>(key: TKey, value: AccessOperand<TSubject[TKey], TActor>): QueryCompareNode;
  neq<TKey extends Field<TSubject>>(key: TKey, value: AccessOperand<TSubject[TKey], TActor>): QueryCompareNode;
  gt<TKey extends Field<TSubject>>(key: TKey, value: AccessOperand<TSubject[TKey], TActor>): QueryCompareNode;
  gte<TKey extends Field<TSubject>>(key: TKey, value: AccessOperand<TSubject[TKey], TActor>): QueryCompareNode;
  lt<TKey extends Field<TSubject>>(key: TKey, value: AccessOperand<TSubject[TKey], TActor>): QueryCompareNode;
  lte<TKey extends Field<TSubject>>(key: TKey, value: AccessOperand<TSubject[TKey], TActor>): QueryCompareNode;
  and(left: QueryConditionNode, right: QueryConditionNode, ...rest: readonly QueryConditionNode[]): QueryConditionNode;
  or(left: QueryConditionNode, right: QueryConditionNode, ...rest: readonly QueryConditionNode[]): QueryConditionNode;
  not(inner: QueryConditionNode): QueryConditionNode;
}

type AccessOperand<TValue, TActor> = TValue | { readonly kind: "param"; readonly name: Field<TActor> };

export type AccessPredicate<TSubject, TActor> = (
  query: AccessConditionBuilder<TSubject, TActor>,
  actor: ActorRef<TActor>
) => QueryConditionNode;

/** A rule may narrow to some fields, add a condition, or both. */
export interface AccessRuleOptions<TSubject, TActor> {
  readonly fields?: readonly Field<TSubject>[];
  readonly when?: AccessPredicate<TSubject, TActor>;
  readonly id?: string;
  readonly reason?: string;
}

export interface AccessExplanation<TSubject> {
  readonly allowed: boolean;
  readonly field?: Field<TSubject>;
  readonly reason?: string;
  readonly ruleId?: string;
  readonly matchedProhibition?: boolean;
}

/** The compiled answer for one actor. */
export interface Ability<TSubject, TAction extends string> {
  can(action: TAction, subject?: TSubject, field?: Field<TSubject>): boolean;
  cannot(action: TAction, subject?: TSubject, field?: Field<TSubject>): boolean;
  assert(action: TAction, subject: TSubject, field?: Field<TSubject>): TSubject;
  explain(action: TAction, subject?: TSubject, field?: Field<TSubject>): AccessExplanation<TSubject>;
  fields(action: TAction, subject?: TSubject): readonly Field<TSubject>[];
}

export interface AccessPlan<TSubject, TActor, TAction extends string> {
  (actor: TActor): Ability<TSubject, TAction>;
  can<const TNext extends string>(
    action: TNext,
    rule?: AccessPredicate<TSubject, TActor> | AccessRuleOptions<TSubject, TActor>
  ): AccessPlan<TSubject, TActor, TAction | TNext>;
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
