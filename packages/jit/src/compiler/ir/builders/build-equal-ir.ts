import * as ATS from "../../../core/ats/index.js";
import { JITError } from "../../../errors/index.js";
import { staticDefaultIRExpr } from "../../defaults.js";
import { resolveWrappers } from "../../resolvers/resolve-wrappers.js";
import { isPrimitiveLikeSchema } from "../../schema-nodes.js";
import { findRecursiveSchemas } from "../../schema-recursion.js";
import { literalDiscriminatorValue } from "../../source/guard.js";
import { type EqualStrategy, resolveEqualStrategy } from "../../strategy/resolve-strategy.js";
import {
  call,
  type IRExpr,
  type IRHelper,
  type IRNode,
  type IRProgram,
  irVar,
  letDecl,
  literal,
  loadIndex,
  loadProp,
  not,
  notStrictEqual,
  sameNumber,
  sameValue,
  schemaGuard,
  store,
  strictEqual,
} from "../ir.js";
import { Scope } from "../scope.js";

type EqualSchema = ATS.AnyTypeSchema & { readonly def: Record<string, unknown> };

export function buildEqualIR(
  schema: ATS.AnyTypeSchema,
  strategy: EqualStrategy = resolveEqualStrategy(schema)
): IRProgram {
  const recursion = createRecursionState(schema);
  const program = buildEqualProgram(schema, strategy, recursion);

  // Draining the queue may discover further cycles, so it runs to fixpoint.
  const helpers: IRHelper[] = [];

  while (recursion.pending.length > 0) {
    const target = recursion.pending.shift() as ATS.AnyTypeSchema;

    helpers.push({
      name: recursion.names.get(target) as string,
      program: buildEqualProgram(target, resolveEqualStrategy(target), recursion),
    });
  }

  return helpers.length > 0 ? { ...program, helpers } : program;
}

interface RecursionState {
  readonly recursive: ReadonlySet<ATS.AnyTypeSchema>;
  readonly names: Map<ATS.AnyTypeSchema, string>;
  readonly pending: ATS.AnyTypeSchema[];
  /** The schema whose helper body is being built, which must expand inline. */
  entry: ATS.AnyTypeSchema | undefined;
}

function createRecursionState(schema: ATS.AnyTypeSchema): RecursionState {
  return { recursive: findRecursiveSchemas(schema), names: new Map(), pending: [], entry: undefined };
}

function helperFor(recursion: RecursionState, target: ATS.AnyTypeSchema): string {
  const existing = recursion.names.get(target);

  if (existing) return existing;

  const name = `equal_r${recursion.names.size + 1}`;

  recursion.names.set(target, name);
  recursion.pending.push(target);
  return name;
}

function buildEqualProgram(schema: ATS.AnyTypeSchema, strategy: EqualStrategy, recursion: RecursionState): IRProgram {
  const previousEntry = recursion.entry;

  recursion.entry = schema;

  const scope = new Scope();
  const left = irVar("l");
  const right = irVar("r");
  const body: IRNode[] = [
    { kind: "if", test: strictEqual(left, right), then: [{ kind: "return", value: literal(true) }] },
  ];

  if (strategy.hash.type === "hash-short-circuit") {
    body.push({
      kind: "hash_compare",
      leftHash: call(irVar("__hash"), [left]),
      rightHash: call(irVar("__hash"), [right]),
    });
  }

  appendSchemaCompare(body, schema as EqualSchema, left, right, scope, strategy, recursion);
  body.push({ kind: "return", value: literal(true) });
  recursion.entry = previousEntry;

  return { kind: "program", params: [left, right], body };
}

function appendSchemaCompare(
  body: IRNode[],
  schema: EqualSchema,
  left: IRExpr,
  right: IRExpr,
  scope: Scope,
  strategy: EqualStrategy,
  recursion: RecursionState
): void {
  const resolved = resolveWrappers(schema);

  if (resolved.optional || resolved.nullable) {
    appendResolvedWrapperCompare(body, resolved, left, right, scope, strategy, recursion);
    return;
  }

  const base = resolved.base as EqualSchema;

  // A cycle participant is compared through its own function. The one
  // exception is the first node of that function's own body, which has to
  // expand for the call to have something to call — consumed immediately so
  // the same schema deeper down still becomes a call.
  if (recursion.recursive.has(base)) {
    if (recursion.entry === base) {
      recursion.entry = undefined;
    } else {
      appendCompareOrFail(body, call(irVar(helperFor(recursion, base)), [left, right]));
      return;
    }
  }

  switch (base.type) {
    case ATS.TypeName.any:
    case ATS.TypeName.unknown:
    case ATS.TypeName.never:
    case ATS.TypeName.void:
    case ATS.TypeName.undefined:
    case ATS.TypeName.literal:
    case ATS.TypeName.enum:
    case ATS.TypeName.file:
      appendCompareOrFail(body, sameValue(left, right));
      return;
    case ATS.TypeName.nan:
    case ATS.TypeName.int:
    case ATS.TypeName.number:
      appendCompareOrFail(body, sameNumber(left, right));
      return;
    case ATS.TypeName.null:
    case ATS.TypeName.symbol:
    case ATS.TypeName.boolean:
    case ATS.TypeName.bigint:
    case ATS.TypeName.string:
      appendCompareOrFail(body, strictEqual(left, right));
      return;
    case ATS.TypeName.date:
      appendCompareOrFail(body, sameValue(call(loadProp(left, "getTime")), call(loadProp(right, "getTime"))));
      return;
    case ATS.TypeName.array:
      appendArrayCompare(body, base, left, right, scope, strategy, recursion);
      return;
    case ATS.TypeName.tuple:
      appendTupleCompare(body, base, left, right, scope, strategy, recursion);
      return;
    case ATS.TypeName.object:
      appendObjectCompare(body, base, left, right, scope, recursion);
      return;
    case ATS.TypeName.record:
      appendRecordCompare(body, base, left, right, scope, strategy, recursion);
      return;
    case ATS.TypeName.set:
      appendSetCompare(body, left, right, scope);
      return;
    case ATS.TypeName.map:
      appendMapCompare(body, base, left, right, scope, strategy, recursion);
      return;
    case ATS.TypeName.union:
      appendUnionCompare(body, base, left, right, scope, strategy, recursion);
      return;
    case ATS.TypeName.intersection:
      appendIntersectionCompare(body, base, left, right, scope, strategy, recursion);
      return;
    case ATS.TypeName.discriminatedUnion:
      appendDiscriminatedUnionCompare(body, base, left, right, scope, strategy, recursion);
      return;
    default:
      throw new JITError("UNSUPPORTED_SCHEMA", `Unimplemented compiler equal IR for type: ${base.type}`);
  }
}

function appendCompareOrFail(body: IRNode[], expr: IRExpr): void {
  body.push({ kind: "if", test: not(expr), then: [{ kind: "return", value: literal(false) }] });
}

function appendResolvedWrapperCompare(
  body: IRNode[],
  resolved: { readonly base: ATS.AnyTypeSchema; readonly optional: boolean; readonly nullable: boolean },
  left: IRExpr,
  right: IRExpr,
  scope: Scope,
  strategy: EqualStrategy,
  recursion: RecursionState
): void {
  const inner: IRNode[] = [];

  if (resolved.optional) {
    inner.push({
      kind: "if",
      test: orCompare(strictEqual(left, literal(undefined)), strictEqual(right, literal(undefined))),
      then: [{ kind: "return", value: literal(false) }],
    });
  }

  if (resolved.nullable) {
    inner.push({
      kind: "if",
      test: orCompare(strictEqual(left, literal(null)), strictEqual(right, literal(null))),
      then: [{ kind: "return", value: literal(false) }],
    });
  }

  appendSchemaCompare(inner, resolved.base as EqualSchema, left, right, scope, strategy, recursion);
  body.push({ kind: "if", test: not(sameValue(left, right)), then: inner });
}

function appendArrayCompare(
  body: IRNode[],
  schema: EqualSchema,
  left: IRExpr,
  right: IRExpr,
  scope: Scope,
  strategy: EqualStrategy,
  recursion: RecursionState
): void {
  const len = scope.createVar("len");
  const ix = scope.createVar("i");
  const leftItem = scope.createVar("li");
  const rightItem = scope.createVar("ri");
  const loopBody: IRNode[] = [
    { kind: "assign", target: leftItem, expr: loadIndex(left, ix) },
    { kind: "assign", target: rightItem, expr: loadIndex(right, ix) },
  ];

  appendSchemaCompare(loopBody, schema.def.element as EqualSchema, leftItem, rightItem, scope, strategy, recursion);

  if (strategy.array.type === "map") {
    body.push({
      kind: "map_equal",
      left,
      right,
      key: strategy.array.key,
      length: len,
      index: ix,
      leftItem,
      rightItem,
      rightIndex: scope.createVar("rightIndex"),
      body: loopBody.slice(2),
    });
    return;
  }

  if (strategy.array.type === "binary-search") {
    body.push({
      kind: "binary_search_equal",
      left,
      right,
      key: strategy.array.key,
      length: len,
      index: ix,
      leftItem,
      rightItem,
      searchLow: scope.createVar("low"),
      searchHigh: scope.createVar("high"),
      searchMid: scope.createVar("mid"),
      found: scope.createVar("found"),
      direction: strategy.array.direction,
      body: loopBody.slice(2),
    });
    return;
  }

  body.push(
    { kind: "assign", target: len, expr: loadProp(left, "length") },
    {
      kind: "if",
      test: notStrictEqual(len, loadProp(right, "length")),
      then: [{ kind: "return", value: literal(false) }],
    },
    { kind: "for", index: ix, from: len, body: loopBody }
  );
}

/**
 * A tuple has a known arity, so every slot is compared by static index — no
 * loop, no length read, the same shape an object's known keys produce.
 */
function appendTupleCompare(
  body: IRNode[],
  schema: EqualSchema,
  left: IRExpr,
  right: IRExpr,
  scope: Scope,
  strategy: EqualStrategy,
  recursion: RecursionState
): void {
  const items = schema.def.items as readonly EqualSchema[];

  for (let index = 0; index < items.length; index++) {
    appendSchemaCompare(
      body,
      items[index],
      loadIndex(left, literal(index)),
      loadIndex(right, literal(index)),
      scope,
      strategy,
      recursion
    );
  }
}

/**
 * A record's keys are not known at compile time, so this is the one place the
 * comparison reads them at run time. Counting keys first rejects most unequal
 * pairs before a single value is compared; presence is then checked per key,
 * because equal counts alone would call `{ a: undefined }` and
 * `{ b: undefined }` the same value.
 */
function appendRecordCompare(
  body: IRNode[],
  schema: EqualSchema,
  left: IRExpr,
  right: IRExpr,
  scope: Scope,
  strategy: EqualStrategy,
  recursion: RecursionState
): void {
  const leftKeys = scope.createVar("lk");
  const rightKeys = scope.createVar("rk");
  const len = scope.createVar("len");
  const ix = scope.createVar("i");
  const key = scope.createVar("k");
  const leftValue = scope.createVar("lv");
  const rightValue = scope.createVar("rv");
  const loopBody: IRNode[] = [
    { kind: "assign", target: key, expr: loadIndex(leftKeys, ix) },
    { kind: "if", test: not(ownsKey(right, key)), then: [{ kind: "return", value: literal(false) }] },
    { kind: "assign", target: leftValue, expr: loadIndex(left, key) },
    { kind: "assign", target: rightValue, expr: loadIndex(right, key) },
  ];

  appendSchemaCompare(loopBody, schema.def.value as EqualSchema, leftValue, rightValue, scope, strategy, recursion);

  body.push(
    { kind: "assign", target: leftKeys, expr: objectKeys(left) },
    { kind: "assign", target: rightKeys, expr: objectKeys(right) },
    { kind: "assign", target: len, expr: loadProp(leftKeys, "length") },
    {
      kind: "if",
      test: notStrictEqual(len, loadProp(rightKeys, "length")),
      then: [{ kind: "return", value: literal(false) }],
    },
    { kind: "for", index: ix, from: len, body: loopBody }
  );
}

/**
 * Set membership is identity-based in JavaScript, so `has` is the comparison —
 * the same rule `update` and `diff` already apply to a set.
 */
function appendSetCompare(body: IRNode[], left: IRExpr, right: IRExpr, scope: Scope): void {
  const item = scope.createVar("item");

  body.push(
    {
      kind: "if",
      test: notStrictEqual(loadProp(left, "size"), loadProp(right, "size")),
      then: [{ kind: "return", value: literal(false) }],
    },
    {
      kind: "for_of",
      item,
      iterable: left,
      body: [
        {
          kind: "if",
          test: not(call(loadProp(right, "has"), [item])),
          then: [{ kind: "return", value: literal(false) }],
        },
      ],
    }
  );
}

/**
 * Keys are matched by identity like a set, but values are compared through the
 * value schema, so a map of objects compares structurally rather than by
 * reference.
 */
function appendMapCompare(
  body: IRNode[],
  schema: EqualSchema,
  left: IRExpr,
  right: IRExpr,
  scope: Scope,
  strategy: EqualStrategy,
  recursion: RecursionState
): void {
  const entry = scope.createVar("entry");
  const key = scope.createVar("mk");
  const leftValue = scope.createVar("mlv");
  const rightValue = scope.createVar("mrv");
  const loopBody: IRNode[] = [
    { kind: "assign", target: key, expr: loadIndex(entry, literal(0)) },
    {
      kind: "if",
      test: not(call(loadProp(right, "has"), [key])),
      then: [{ kind: "return", value: literal(false) }],
    },
    { kind: "assign", target: leftValue, expr: loadIndex(entry, literal(1)) },
    { kind: "assign", target: rightValue, expr: call(loadProp(right, "get"), [key]) },
  ];

  appendSchemaCompare(loopBody, schema.def.value as EqualSchema, leftValue, rightValue, scope, strategy, recursion);

  body.push(
    {
      kind: "if",
      test: notStrictEqual(loadProp(left, "size"), loadProp(right, "size")),
      then: [{ kind: "return", value: literal(false) }],
    },
    { kind: "for_of", item: entry, iterable: left, body: loopBody }
  );
}

function objectKeys(value: IRExpr): IRExpr {
  return call(loadProp(irVar("Object"), "keys"), [value]);
}

function ownsKey(target: IRExpr, key: IRExpr): IRExpr {
  return call(loadProp(loadProp(loadProp(irVar("Object"), "prototype"), "hasOwnProperty"), "call"), [target, key]);
}

function appendObjectCompare(
  body: IRNode[],
  schema: EqualSchema,
  left: IRExpr,
  right: IRExpr,
  scope: Scope,
  recursion: RecursionState
): void {
  const props = schema.def.props as Record<string, EqualSchema>;

  for (const key of Object.keys(props)) {
    const prop = props[key];
    const leftProp = loadProp(left, key);
    const rightProp = loadProp(right, key);
    const defaultExpr = staticDefaultIRExpr(prop);
    let leftValue = leftProp;
    let rightValue = rightProp;

    if (defaultExpr || shouldHoistObjectProp(prop)) {
      const leftVar = scope.createVar(`l_${key}`);
      const rightVar = scope.createVar(`r_${key}`);

      body.push(
        defaultExpr ? letDecl(leftVar, leftProp) : { kind: "assign", target: leftVar, expr: leftProp },
        defaultExpr ? letDecl(rightVar, rightProp) : { kind: "assign", target: rightVar, expr: rightProp }
      );

      if (defaultExpr) {
        body.push(
          { kind: "if", test: strictEqual(leftVar, literal(undefined)), then: [store(leftVar, defaultExpr)] },
          { kind: "if", test: strictEqual(rightVar, literal(undefined)), then: [store(rightVar, defaultExpr)] }
        );
      }

      leftValue = leftVar;
      rightValue = rightVar;
    }

    appendSchemaCompare(
      body,
      prop,
      leftValue,
      rightValue,
      scope,
      { type: "equal", array: { type: "loop" }, hash: { type: "none" } },
      recursion
    );
  }
}

function shouldHoistObjectProp(schema: EqualSchema): boolean {
  const resolved = resolveWrappers(schema).base;

  return resolved.type === ATS.TypeName.object || resolved.type === ATS.TypeName.array;
}

function appendUnionCompare(
  body: IRNode[],
  schema: EqualSchema,
  left: IRExpr,
  right: IRExpr,
  scope: Scope,
  strategy: EqualStrategy,
  recursion: RecursionState
): void {
  const options = schema.def.options as EqualSchema[];
  const branches: IRNode[] = [];

  if (options.every(isAtomicEqualSchema)) {
    appendCompareOrFail(body, sameNumber(left, right));
    return;
  }

  for (const option of options) {
    const then: IRNode[] = [
      { kind: "if", test: not(schemaGuard(option, right)), then: [{ kind: "return", value: literal(false) }] },
    ];

    appendSchemaCompare(then, option, left, right, scope, strategy, recursion);
    then.push({ kind: "return", value: literal(true) });
    branches.push({ kind: "if", test: schemaGuard(option, left), then });
  }

  body.push(...branches, { kind: "return", value: literal(false) });
}

function isAtomicEqualSchema(schema: EqualSchema): boolean {
  const base = resolveWrappers(schema).base as EqualSchema;

  return isPrimitiveLikeSchema(base) && base.type !== ATS.TypeName.regex && base.type !== ATS.TypeName.instanceof;
}

function appendIntersectionCompare(
  body: IRNode[],
  schema: EqualSchema,
  left: IRExpr,
  right: IRExpr,
  scope: Scope,
  strategy: EqualStrategy,
  recursion: RecursionState
): void {
  const options = schema.def.options as EqualSchema[];

  for (const option of options) {
    appendSchemaCompare(body, option, left, right, scope, strategy, recursion);
  }
}

function appendDiscriminatedUnionCompare(
  body: IRNode[],
  schema: EqualSchema,
  left: IRExpr,
  right: IRExpr,
  scope: Scope,
  strategy: EqualStrategy,
  recursion: RecursionState
): void {
  const discriminator = schema.def.discriminator as string;
  const leftTag = loadProp(left, discriminator);
  const rightTag = loadProp(right, discriminator);
  const options = schema.def.options as EqualSchema[];

  for (const option of options) {
    const tag = literalDiscriminatorValue(option, discriminator);

    if (tag === undefined) continue;

    const then: IRNode[] = [
      { kind: "if", test: notStrictEqual(rightTag, literal(tag)), then: [{ kind: "return", value: literal(false) }] },
    ];

    appendSchemaCompare(then, option, left, right, scope, strategy, recursion);
    then.push({ kind: "return", value: literal(true) });
    body.push({ kind: "if", test: strictEqual(leftTag, literal(tag)), then });
  }

  body.push({ kind: "return", value: literal(false) });
}

function orCompare(left: IRExpr, right: IRExpr): IRExpr {
  return { kind: "binary", op: "or", left, right };
}
