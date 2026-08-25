import type * as ATS from "../core/ats/index.js";
import { TypeName } from "../core/ats/index.js";
import type { ExecutionPlan, ExecutionStage } from "./execution-plan.js";
import { resolveWrappers } from "./resolvers/resolve-wrappers.js";
import { canUseFastParse } from "./validate/emit-validate.js";

export type SemanticFactKind =
  | "IsString"
  | "IsNumber"
  | "IsInteger"
  | "IsBoolean"
  | "IsObject"
  | "NonNull"
  | "KnownShape"
  | "KnownField"
  | "Validated"
  | "Sanitized"
  | "Range";

/** Compile-time proof attached to an execution-stage boundary. */
export interface SemanticFact {
  readonly kind: SemanticFactKind;
  readonly path: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
}

/** Effects used by optimizer barriers; these never survive backend lowering. */
export interface SemanticEffects {
  readonly pure: boolean;
  readonly allocates: boolean;
  readonly throws: boolean;
  readonly async: boolean;
  readonly userCode: boolean;
  readonly mutates: boolean;
}

export type ExecutionBarrier = "throws" | "allocation" | "async" | "user-code" | "mutation" | "construction";

export interface AnalyzedExecutionStage {
  readonly stage: ExecutionStage;
  readonly factsBefore: readonly SemanticFact[];
  readonly factsAfter: readonly SemanticFact[];
  readonly effects: SemanticEffects;
  readonly barriers: readonly ExecutionBarrier[];
}

export interface ExecutionOptimizationPass {
  readonly name: string;
  run(plan: ExecutionPlan): ExecutionPlan;
}

function pass(name: string, run: (plan: ExecutionPlan) => ExecutionPlan = (plan) => plan): ExecutionOptimizationPass {
  return Object.freeze({ name, run });
}

/** Pass order is public compiler metadata so source and differential tests can lock it. */
export const executionOptimizationPasses: readonly ExecutionOptimizationPass[] = Object.freeze([
  pass("normalize", normalizeExecutionPlan),
  pass("inferFacts"),
  pass("normalizeChecks"),
  pass("propagateFacts"),
  pass("removeRedundantChecks", removeRedundantChecks),
  pass("requiredFields"),
  pass("projectionPushdown"),
  pass("deadFields"),
  pass("barriers"),
  pass("materialization"),
  pass("fusion"),
  pass("physicalSpecialization"),
]);

/** Runs compile-time-only passes. The returned plan remains immutable. */
export function optimizeExecutionPlan(plan: ExecutionPlan): ExecutionPlan {
  let current = plan;

  for (const optimization of executionOptimizationPasses) current = optimization.run(current);
  return current;
}

/** Produces deterministic proof/effect information without changing runtime data. */
export function analyzeExecutionPlan(plan: ExecutionPlan): readonly AnalyzedExecutionStage[] {
  const analysis: AnalyzedExecutionStage[] = [];
  let facts: SemanticFact[] = [];

  for (const stage of plan.stages) {
    const effects = semanticEffects(stage);
    const barriers = stageBarriers(stage, effects);
    const before = facts;

    if (effects.userCode || effects.mutates) facts = [];
    facts = mergeFacts(facts, inferredFacts(stage));
    analysis.push(
      Object.freeze({
        stage,
        factsBefore: Object.freeze([...before]),
        factsAfter: Object.freeze([...facts]),
        effects,
        barriers,
      })
    );
  }
  return Object.freeze(analysis);
}

function normalizeExecutionPlan(plan: ExecutionPlan): ExecutionPlan {
  const stages = plan.stages.filter(
    (stage, index, all) => stage.kind !== "to.array" || all[index - 1]?.kind !== "to.array"
  );
  return stages.length === plan.stages.length ? plan : freezePlan(plan, stages);
}

function removeRedundantChecks(plan: ExecutionPlan): ExecutionPlan {
  const stages: ExecutionStage[] = [];

  for (const stage of plan.stages) {
    const previous = stages[stages.length - 1];
    const redundant =
      stage.kind === "validate" &&
      stage.operation === "parse" &&
      previous?.kind === "validate" &&
      previous.operation === "parse" &&
      previous.schema === stage.schema &&
      canUseFastParse(stage.schema);

    if (!redundant) stages.push(stage);
  }
  return stages.length === plan.stages.length ? plan : freezePlan(plan, stages);
}

function freezePlan(plan: ExecutionPlan, stages: readonly ExecutionStage[]): ExecutionPlan {
  return Object.freeze({ ...plan, stages: Object.freeze([...stages]) });
}

function semanticEffects(stage: ExecutionStage): SemanticEffects {
  const userCode =
    stage.effects.usesExternalBindings &&
    (stage.kind === "map" || stage.kind === "transform" || stage.kind === "update");
  const mutates = false;
  const async = stage.kind === "validate" && (stage.operation === "parseAsync" || stage.operation === "safeParseAsync");

  return Object.freeze({
    pure: !stage.effects.mayThrow && !userCode && !mutates,
    allocates: stage.effects.mayAllocate,
    throws: stage.effects.mayThrow,
    async,
    userCode,
    mutates,
  });
}

function stageBarriers(stage: ExecutionStage, effects: SemanticEffects): readonly ExecutionBarrier[] {
  const barriers: ExecutionBarrier[] = [];

  if (effects.throws) barriers.push("throws");
  if (effects.allocates) barriers.push("allocation");
  if (effects.async) barriers.push("async");
  if (effects.userCode) barriers.push("user-code");
  if (effects.mutates) barriers.push("mutation");
  if (stage.kind === "construct") barriers.push("construction");
  return Object.freeze(barriers);
}

function inferredFacts(stage: ExecutionStage): readonly SemanticFact[] {
  if (stage.kind === "validate" && stage.operation !== "is" && stage.operation !== "issues") {
    return Object.freeze([fact("Validated"), ...schemaFacts(stage.schema)]);
  }
  if (stage.kind === "binary.decode") return Object.freeze(schemaFacts(stage.schema));
  if (stage.kind === "security" && stage.operation === "sanitize") return Object.freeze([fact("Sanitized")]);
  return [];
}

function schemaFacts(schema: ATS.AnyTypeSchema, path: readonly string[] = []): SemanticFact[] {
  const base = resolveWrappers(schema).base;
  const facts: SemanticFact[] = [];

  switch (base.type) {
    case TypeName.string:
      facts.push(fact("IsString", path));
      break;
    case TypeName.number:
      facts.push(fact("IsNumber", path));
      break;
    case TypeName.int:
      facts.push(fact("IsNumber", path), fact("IsInteger", path));
      break;
    case TypeName.boolean:
      facts.push(fact("IsBoolean", path));
      break;
    case TypeName.object: {
      facts.push(fact("IsObject", path), fact("NonNull", path), fact("KnownShape", path));
      const props = (base as ATS.ObjectSchema).def.props;

      for (const key of Object.keys(props)) facts.push(fact("KnownField", [...path, key]));
      break;
    }
  }

  const checks = (base.def as { readonly checks?: readonly { readonly kind: string; readonly value?: unknown }[] })
    .checks;
  const minimum = numericCheck(checks, ["min", "gte", "moreThan", "gt"]);
  const maximum = numericCheck(checks, ["max", "lte", "lessThan", "lt"]);
  if (minimum !== undefined || maximum !== undefined) {
    facts.push(
      Object.freeze({
        kind: "Range",
        path: Object.freeze([...path]),
        ...(minimum === undefined ? {} : { minimum }),
        ...(maximum === undefined ? {} : { maximum }),
      })
    );
  }
  return facts;
}

function numericCheck(
  checks: readonly { readonly kind: string; readonly value?: unknown }[] | undefined,
  kinds: readonly string[]
): number | undefined {
  const value = checks?.find((check) => kinds.includes(check.kind))?.value;
  return typeof value === "number" ? value : undefined;
}

function fact(kind: SemanticFactKind, path: readonly string[] = []): SemanticFact {
  return Object.freeze({ kind, path: Object.freeze([...path]) });
}

function mergeFacts(current: readonly SemanticFact[], next: readonly SemanticFact[]): SemanticFact[] {
  const merged = [...current];
  const keys = new Set(current.map(factKey));

  for (const value of next) {
    const key = factKey(value);
    if (!keys.has(key)) {
      keys.add(key);
      merged.push(value);
    }
  }
  return merged;
}

function factKey(value: SemanticFact): string {
  return `${value.kind}:${value.path.join(".")}:${value.minimum ?? ""}:${value.maximum ?? ""}`;
}
