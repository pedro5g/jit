# Rules

## 1. Problem

Business decisions — eligibility, pricing tiers, fraud triage, routing, feature qualification — are usually written as data and executed by a generic engine:

```text
Rule[]
→ for each rule
→ interpret the condition tree
→ resolve a fact by string name
→ look the operator up in a registry
→ invoke it
→ build result objects
```

Everything that makes that engine general is paid on every evaluation. The rule array is scanned even when only one rule was asked about. Facts are resolved through a name-keyed almanac with its own cache. Operators are found by string. Each evaluation allocates the almanac, the cache, and the result objects, and the same fact is re-resolved for every rule that mentions it.

None of that work depends on the input. It depends on the rules, and the rules were written before the program ran.

## 2. Why JIT

The rule ids are literals, the subject is a schema, and the inputs are declared schemas, so a decision is a comparison against a known property — which is exactly a query condition, and `JIT.rules` reuses that AST instead of growing a second expression language.

That makes the whole engine disappear. `JIT.rules` compiles a rule set into the JavaScript an engineer would have written for those specific rules:

```js
function rulesTest(rule, subject, inputs) {
  switch (rule) {
    case "block":
      return inputs.riskScore >= 95 && inputs.accountAgeDays < 7;
    default:
      return false;
  }
}
```

No rule array, no fact registry, no operator lookup, no condition walker.

## 3. API

```ts
const TransactionRules = JIT.rules(Transaction)
  .inputs({
    riskScore: JIT.number(),
    accountAgeDays: JIT.number().int(),
  })
  .rule("manual-review", {
    when: (query, input) => query.or(query.gte("amount", 10_000), query.gte(input.field("riskScore"), 80)),
  })
  .rule("block", {
    priority: 100,
    when: (query, input) =>
      query.and(query.gte(input.field("riskScore"), 95), query.lt(input.field("accountAgeDays"), 7)),
  })
  .rule("domestic", { when: (query) => query.eq("country", "BR") });
```

Result modes:

```ts
TransactionRules.test("block", transaction, inputs); // one rule, boolean
TransactionRules.some(transaction, inputs);          // any rule, early exit
TransactionRules.first(transaction, inputs);         // highest-priority match
TransactionRules.match(transaction, inputs);         // every matched rule id
TransactionRules.run(transaction, inputs);           // the outcomes of matched rules
TransactionRules.explain(transaction, inputs);       // diagnostics
TransactionRules.inspect();                          // the compile plan

TransactionRules.to.visitor();                       // (subject, inputs, consume) => number
TransactionRules.to.iterator();                      // (subject, inputs) => IterableIterator<outcome>

const classify = TransactionRules.many();            // one loop over a collection
classify.to.visitor();
classify.to.iterator();

TransactionRules.predicate("manual-review");         // one rule as a reusable predicate
```

Rule ids are literal types, so `test`, `first`, `match` and `predicate` autocomplete and reject an id that was never declared.

### Outcomes

A rule may emit data. Target fields resolve by name against the subject, then the declared inputs; a `literal` field fills itself; `values` covers the rest.

```ts
const ManualReview = JIT.dto(
  JIT.object({
    type: JIT.literal("manual-review"),
    transactionId: JIT.number().int(),
    riskScore: JIT.number(),
  })
);

JIT.rules(Transaction)
  .inputs({ riskScore: JIT.number() })
  .rule("manual-review", {
    when: (query, input) => query.gte(input.field("riskScore"), 80),
    emit: ManualReview,
    values: (subject) => ({ transactionId: subject.field("id") }),
  });
```

A domain event is an outcome too. The rules engine builds the event; it never publishes it:

```ts
const TransactionBlocked = JIT.ddd.domainEvent("transaction.blocked", {
  version: 1,
  payload: JIT.object({ transactionId: JIT.number().int(), reason: JIT.string() }),
});

.rule("block", {
  when: (query, input) => query.gte(input.field("riskScore"), 95),
  emit: TransactionBlocked,
  values: (subject) => ({ transactionId: subject.field("id"), reason: "risk" }),
})
```

### Query composition

A named rule is a predicate the query compiler can consume directly:

```ts
const flagged = JIT.cqrs.query(Transaction).where(TransactionRules.predicate("manual-review"), inputs);
```

The rule lowers into the query's own condition AST and fuses into the same scan. Its declared inputs become query bindings, so `~query` and every external adapter see an ordinary predicate — no rule, fact, or outcome node crosses that boundary.

The same predicate filters a stream inside its parse loop, so a row that no rule selects is never materialized:

```ts
JIT.ndjson
  .parse(Transaction)
  .validate()
  .where(TransactionRules.predicate("manual-review"), inputs)
  .to.visitor();
```

## 4. Rules vs access control

They answer different questions and do not share an IR, only the condition primitives.

| | `JIT.access` | `JIT.rules` |
| --- | --- | --- |
| Question | may this actor do this? | which decisions does this record trigger? |
| Vocabulary | action, allow, deny, field, actor, subject | facts, condition, rule, priority, outcome |
| Answer | a permission boolean and field constraints | matched rules and outcome data |
| Default | deny by omission | a rule that does not match contributes nothing |

Both compile query-condition AST against a known schema, and both fuse into `JIT.cqrs`. Use `JIT.access` when the answer gates an operation, `JIT.rules` when the answer *is* the business decision.

## 5. Facts

There are two fact sources and both are typed.

**Subject fields** come from the schema: `query.gte("amount", 10_000)` is checked against `Transaction`.

**Inputs** are declared with `.inputs({ ... })` and referenced as `input.field("riskScore")`. They are values the application resolves before asking — a risk score from a model, an account age from a read model, the current time.

There is deliberately no dynamic fact resolver in this version. An async fact graph means scheduling, promises, caches, and non-determinism on a path whose entire value is that it is a compiled comparison. Resolve I/O first; the rules decide.

## 6. Conditions

The condition builder is the query condition builder: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `and`, `or`, `not`. The left side is a subject field name or an input reference; the right side is a compiler literal or an input reference.

Unknown fields, unknown inputs, duplicate rule ids and non-integer priorities are rejected at declaration, not at the first evaluation.

## 7. Priority

`priority` is a number; higher runs first, and ties break by declaration order. It decides **output order** for `match`, `run`, `visitor` and `iterator`, and it decides **semantics** for `first`, which tests rules in priority order and returns at the first match.

It does not constrain how conditions are evaluated: the compiler is free to share predicates and hoist reads as long as the answer and the order are unchanged.

## 8. Execution modes

| Mode | Returns | Evaluates |
| --- | --- | --- |
| `test(id)` | boolean | that rule only |
| `some()` | boolean | until the first match |
| `first()` | rule id or `undefined` | in priority order, until the first match |
| `match()` | matched rule ids | every live rule |
| `run()` | outcomes | every live rule that emits |
| `to.visitor()` | number of matches | every live rule |
| `to.iterator()` | outcomes, lazily | every live rule that emits |
| `many()` | outcomes for a collection | every live rule, per record |
| `predicate(id)` | boolean | that rule only |
| `explain()` | matched and evaluated ids | every live rule |

A rule declared without `emit` is a pure predicate: it appears in `match`, `first`, `visitor` and `explain`, and contributes nothing to `run`, `iterator` or `many`.

## 9. Compilation

```
JIT.rules(Transaction).inputs(...).rule(...).rule(...)
        ↓
RuleDeclaration[]   ← conditions are query condition AST; inputs are `param` nodes
        ↓
validate fields, inputs, ids and priorities against the schemas
        ↓
constant folding → a rule whose condition folds to false is dead and stops contributing dependencies
        ↓
per-rule dependency paths: which subject fields and which inputs it reads
        ↓
per sink: order by priority, share predicates, hoist repeated reads
        ↓
one specialized function per result mode
```

Each sink compiles on first use. Declaring a plan costs a descriptor, not twelve compiled functions.

## 10. Dependency graph

Every rule records the subject paths and input paths it reads, including the ones its outcome needs:

```ts
TransactionRules.inspect();
// {
//   rules: 3, liveRules: 3, deadRules: [],
//   subjectPaths: ["amount", "country"],
//   inputPaths: ["riskScore", "accountAgeDays"],
//   deadInputs: [], sharedReads: 1, sharedPredicates: 0,
//   priorityGroups: 2, outcomes: 0, strategy: "inline"
// }
```

This drives four eliminations.

**Dead rules.** A condition that folds to a constant `false` is removed from `some`, `first`, `match`, `run`, `visitor` and `many`, and stops contributing dependencies. `test` still answers `false` for its id.

**Dead facts.** `test("block", ...)` compiles only that rule's condition, so facts read exclusively by other rules are never touched. `run` compiles only the rules that emit.

**Shared reads.** In the modes that must evaluate every rule, a field or input read by more than one rule becomes one local:

```js
const p0 = inputs.riskScore;
```

Early-exit modes deliberately do not hoist: a hoisted read is work the short circuit was entitled to skip.

**Shared predicates.** A comparison written by two rules is computed once. Every operand is a property read or a literal, so evaluating it eagerly cannot change the result or throw:

```js
const c0 = inputs.riskScore >= 80;
if (c0) out[j++] = "a";
if (c0 && subject.amount > 5000) out[j++] = "b";
```

In `many()`, a comparison that reads no subject field is loop invariant and moves out of the loop, so a collection pays it once instead of once per record:

```js
function rulesMany(list, inputs) {
  const out = [];
  let j = 0;
  const p0 = inputs.riskScore;
  const c0 = p0 >= 95;
  const c1 = inputs.accountAgeDays < 7;
  const size = list.length;
  for (let i = 0; i < size; i++) {
    const subject = list[i];
    if (c0 && c1) out[j++] = __ro0.create({ transactionId: subject.id, reason: "risk" });
  }
  return out;
}
```

## 11. Allocation model

| Mode | Allocates |
| --- | --- |
| `test`, `some`, `predicate` | nothing |
| `first` | nothing; it returns an existing string literal |
| `match` | one array, written by index |
| `run`, `iterator`, `many` | the outcomes their semantics require |
| `to.visitor()`, `many().to.visitor()` | nothing; each outcome is handed to the consumer |
| `explain` | its diagnostic result |

There is no per-evaluation almanac, cache, or context object in any mode.

## 12. Complexity

```
generic rules engine:  O(rules) scan + O(conditions) interpretation
                       + O(facts) name resolution through a cache
                       + one almanac allocation per evaluation

compiled plan:         O(conditions actually reachable for the requested mode)
                       shared facts read once, shared predicates computed once
test(id):              O(conditions of that rule)
first():               O(conditions until the first match), in priority order
```

## 13. Generated code

`test` is a switch over literals:

```js
function rulesTest(rule, subject, inputs) {
  switch (rule) {
    case "manual-review":
      return subject.amount >= 10000 || inputs.riskScore >= 80;
    case "block":
      return inputs.riskScore >= 95 && inputs.accountAgeDays < 7;
    default:
      return false;
  }
}
```

`some` is one boolean expression, `first` is a priority-ordered early return, `visitor` calls the consumer in place:

```js
function rulesFirst(subject, inputs) {
  if (inputs.riskScore >= 95 && inputs.accountAgeDays < 7) return "block";
  if (subject.amount >= 10000 || inputs.riskScore >= 80) return "manual-review";
  return undefined;
}
```

A plan that declares no inputs does not receive an inputs parameter.

## 14. AOT

Every mode has a standalone AOT form: `test`, `some`, `first`, `match`, `run`, `explain`, `predicate`, `to.visitor`, `to.iterator`, `many`, `many().to.visitor()` and `many().to.iterator()`, plus the whole plan as one object.

The generated module contains the specialized functions and nothing else — no rule array, operator table, almanac, or JIT import. Exporting a single sink ships only that sink; a bundler drops the rest.

A domain-event outcome uses the Runtime Class emitted beside it, so the module never captures a runtime constructor. Generating an outcome sink without exporting its event class is reported as an explicit skip rather than silently miscompiled.

## 15. Runtime/AOT parity

`JIT.rules` exists on `@jit-compiler/jit/runtime` and `@jit-compiler/jit/define` with the same signature, registers a reconstructive `rules-plan` artifact per sink, and every one of the twelve sinks is covered by the runtime/define/AOT parity matrix. Definition files cannot execute a sink; they describe it.

## 16. Benchmarks

Node 22.22.3, Apple M1, 100,000 evaluations or rows per iteration. Reproduce with `pnpm bench:rules`.

The generic competitor is a faithful reproduction of what a runtime engine does per evaluation: an almanac with a fact cache, an operator registry looked up by name, and a scan over the rule array. `json-rules-engine` itself is not in the suite because its `run()` is Promise-based — measuring it here would mostly measure the microtask queue.

Every competitor carries its own loop, and every loop folds its results into an accumulator. Sharing one sweep helper lets the first closure measured keep an inlined version of it while later ones run the polymorphic one, and keeping only the last result lets the engine delete the other 99,999 pure calls. Both mistakes were present in an earlier draft of this suite and inverted its conclusions.

### Decisions

| Scenario | Generic engine | Handwritten | JIT |
| --- | ---: | ---: | ---: |
| 1 rule, 2 comparisons — `test` | 7.14 ms | **148.88 µs** | 205.29 µs |
| 10 rules, shared facts — `match` | 78.30 ms | — | **2.46 ms** |
| 10 rules, early exit — `some` | 26.21 ms | — | **810.33 µs** |
| 10 rules, priority — `first` | 53.50 ms | — | **795.06 µs** |
| 50 rules, 5 shared facts — `match` | 396.41 ms | — | **3.97 ms** |
| 100 rules — `match` | 849.92 ms | — | **10.86 ms** |
| 100 rules, priority — `first` | 591.52 ms | — | **1.46 ms** |
| first condition fails — `some` | 5.31 ms | **213.82 µs** | 687.89 µs |
| last condition fails — `some` | 8.91 ms | **223.60 µs** | 735.16 µs |

Heap per iteration: **0.3–1.1 KB** for the boolean sinks, **1.87 MB** for `match` over 50 rules, against **5.3–14.1 MB** for the generic engine, which allocates an almanac and a fact cache per evaluation.

### Collections and composition

| Scenario, 100,000 rows | JIT | Comparison | Heap JIT / comparison |
| --- | ---: | ---: | ---: |
| `many()` with one outcome per match | 932.20 µs (min 545.67) | 4.16 ms `map` + `run` per record; 873.58 µs handwritten loop (min 549.46) | 5.33 MB / 4.16 MB / 5.33 MB |
| `many().to.visitor()`, outcome consumed | **249.18 µs** | 918.15 µs `many()` + array walk | **0.3 KB** / 5.33 MB |
| rule predicate fused into a query | **348.77 µs** | 1.56 ms `filter` calling the predicate per row; 516.31 µs handwritten loop | 781 KB / 1.81 MB / 1.81 MB |
| 50 rules, 5 shared facts — AOT `match` | **3.72 ms** | 4.01 ms JIT runtime; 400.82 ms generic engine | 1.87 MB / 1.87 MB / 12.18 MB |

### Work avoided

Instrumenting the generic engine over 1,000 evaluations of the 50-rule set:

```text
generic engine fact reads:      5000     (cached, one per fact per evaluation)
generic engine condition evals: 76328    (each through an operator registry lookup)
compiled distinct facts:        5
compiled hoisted fact reads:    5        (5 locals, once per evaluation)
```

The compiled plan evaluates the same conditions, but as direct comparisons on locals: no almanac allocation, no `Map` lookup per fact, no operator lookup per condition.

### Reading these numbers

Against a generic engine the gap is **32×** on a single rule and **35–100×** once there are 10 to 100 rules, because the compiled plan does not scan, resolve, or dispatch. `first` over 100 rules is **405×** faster: priority ordering plus early return means the common case tests a handful of comparisons while the generic engine sorts and scans the whole set.

Against a **handwritten** predicate the boolean sinks are 1.4–3.2× slower in absolute terms, but the absolute terms are 2.0 ns against 1.5 ns per evaluation. The difference is one call frame: a compiled function reached through the plan cannot be inlined into the caller the way a local function is. AOT narrows it further — the AOT `match` is 7.3% faster than the runtime one — and an AOT module's top-level function is inlinable in a way this benchmark's `Function`-built one is not, so the deployed gap is smaller than measured here.

For collections the compiled loop is **at parity** with the handwritten loop (545.67 µs against 549.46 µs at their minima) and **4.5×** faster than mapping `run` over each record. The visitor is where specialization pays most: **3.7×** faster than materializing outcomes and walking them, with four orders of magnitude less heap.

The fused query beats the handwritten loop, which is not a general claim: the query compiler folds the input into a binding constant and pre-sizes the output array, which is what makes it 1.5× faster with 57% less heap.

## 17. Tradeoffs

Conditions compare a field or an input against a literal or another input. That covers thresholds, tiers, memberships and windows; it does not cover arbitrary JavaScript, and it is not meant to — an arbitrary callback could not be compiled, generated ahead of time, or pushed into a query.

Rules are pure, and consequences are data. A rule cannot send an email; it emits `{ type: "send-email", ... }` or a domain event and the application decides. This is what makes reordering, predicate sharing, fusion, and AOT safe.

Inputs are resolved by the caller. Rules that depend on I/O need that I/O to happen first.

Inlining is the only physical strategy. It is the right one for the rule counts measured here — 100 rules with `match` at 10.86 ms for 100,000 evaluations is 108 ns per evaluation across 200 comparisons — and splitting into helper functions is not implemented because no measurement has yet asked for it.

## 18. Best practices

Declare the plan once at module scope. Sinks compile on first use and are cached, so a plan reused across requests compiles once.

Ask for the narrowest mode that answers the question. `test` and `some` allocate nothing; `match` allocates an array; use `run` only when you want the outcome data. For collections use `many()` rather than mapping, and `many().to.visitor()` when each outcome is consumed immediately.

Give a rule an outcome only if something consumes it. A predicate-only rule stays out of `run` entirely.

Use `priority` when order carries meaning, especially with `first`. Leave it at the default when it does not, and rely on declaration order.

Check `inspect()` when a rule set grows: `deadRules` and `deadInputs` are usually a declaration mistake.

## 19. Non-goals

Rules loaded from a database at run time are a different product. `JIT.rules` compiles a static declaration; a JSON rule format would need its own validate-compile-cache path, and it is not this one.

Async facts, derived-fact expression graphs, cost-based predicate ordering and decision DAGs are deliberately absent. Each of them is a real feature with a real design, and each of them would have been added here without a measurement asking for it.

Side effects are not supported, now or later, on the fast path. A callback in a rule would end reordering, fusion, batching and ahead-of-time generation in one step.
