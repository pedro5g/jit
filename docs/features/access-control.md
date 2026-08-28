# Access control

## 1. Problem

Authorization is asked constantly — once per rendered button, once per API request, often once per row of a list — and the usual implementation is a rule engine: an array of `{ action, subject, conditions }` objects that is scanned on every check, with each candidate's conditions matched by walking an object of field/value pairs against the subject.

That is a linear scan plus a nested property walk to answer a question whose shape was fixed when the rules were written. It also allocates: matching conditions generically means reading keys out of an object at run time.

And the failure mode is worse than slow. Precedence between "can" and "cannot" is decided by the order rules appear in the array, so a rule added in the wrong place silently opens access.

## 2. Why JIT

The actions are known when the rules are declared, so a check is a `switch` over string literals rather than a scan. The subject is a schema, so a condition is a comparison against a declared field — which is exactly a query condition, and it reuses that AST rather than growing a second expression language. The actor is a schema too, so `actor.field("id")` is checked at declaration time.

Precedence stops being positional: the rules for an action are folded into one boolean at compile time, so a `cannot` overrides a `can` no matter where it was written.

## 3. API

```ts
const PostAccess = JIT.access(Post)
  .actor(User)
  .can("read")
  .can("update", (query, actor) => query.eq("authorId", actor.field("id")))
  .cannot("delete", (query) => query.eq("locked", true));

const ability = PostAccess(user);

ability.can("read");                    // no subject needed
ability.can("update", post);
ability.cannot("delete", post);
ability.can("update", post, "title");   // one field
ability.assert("update", post);         // returns post or throws AccessDeniedError
ability.explain("update", post);        // diagnostic slow path
ability.fields("read", post);           // subject-aware field materialization
```

Field-scoped rules, with or without a condition:

```ts
JIT.access(Post)
  .actor(User)
  .can("update", { fields: ["title"], when: (query, actor) => query.eq("authorId", actor.field("id")) })
  .cannot("update", { fields: ["body"] });
```

Rules may carry diagnostic metadata without changing the boolean check:

```ts
PostAccess.cannot("update", {
  id: "post-locked",
  reason: "locked",
  when: (query) => query.eq("locked", true),
});
```

`AccessDeniedError` retains only `action`, optional `field`, `reason`, and `ruleId`. It never retains the subject.

### CQRS, projection, and mutation composition

```ts
const ability = PostAccess(actor);

const readPosts = JIT.cqrs
  .query(Post)
  .authorize(ability, "read")
  .where((query) => query.eq("published", true))
  .select("id", "title");

const projectPost = JIT.project(Post).authorize(ability, "read");
const updatePost = JIT.update(Post).authorize(ability, "update");
const applyPatch = JIT.patch.apply(Post).authorize(ability, "update");
```

Definition files cannot execute an AccessPlan to build an ability. The reconstructive form binds the actor explicitly and is also available at runtime:

```ts
const readPosts = JIT.cqrs.query(Post).authorize(PostAccess, "read", actor);
const projectPost = JIT.project(Post).authorize(PostAccess, "read", actor);
const updatePost = JIT.patch.apply(Post).authorize(PostAccess, "update", actor);
```

## 4. Semantics

**Default deny.** An action no rule mentions is refused. An ability with no rules refuses everything.

**A permission must match and no prohibition may.** For a given action, the answer is "some `can` rule matched, and no `cannot` rule did". Several `can` rules for one action are alternatives. Declaration order never changes the answer.

**Field scope differs by effect, on purpose.** A `can` scoped to some fields still answers "may I do this at all", so an unfocused `can(action, subject)` passes it. A `cannot` scoped to some fields must not block the whole action, so an unfocused check skips it — you may still update the fields it says nothing about. Asking with a field applies both.

**`cannot` is the exact negation of `can`.** It is not a second rule scan, so the two cannot disagree.

**A rule's condition compares subject fields against literals or actor fields.** It is the query condition builder — `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `and`, `or`, `not` — over the subject, with `actor.field(...)` on the other side.

## 5. Compilation

```
JIT.access(Post).actor(User).can(...).cannot(...)
        ↓
AccessRule[]  ← conditions are query condition AST; actor refs are `param` nodes
        ↓
normalize by action, fold dominated unconditional rules, collect subject/actor dependency paths
        ↓
per action: fold the can rules and the cannot rules into one boolean
        ↓
switch (action) over the declared literals, ending in a default deny
```

## 6. Generated code

```js
function ability(actor) {
  function can(action, subject, field) {
    switch (action) {
      case "read":
        return true;
      case "update":
        return subject.authorId === actor.id;
      case "delete":
        return false;
      default:
        return false;
    }
  }
  return { can, cannot, assert, explain, fields };
}
```

`delete` folds to `false` because the declaration has a prohibition for it and no permission — a denial that costs nothing at run time. An action nobody declared is not a case at all.

A field rule folds in beside the condition:

```js
case "update":
  return (subject.authorId === actor.id) && !((field !== undefined && (field === "body")));
```

## 7. Allocation model

Zero per ordinary check. The ability object is built once per actor; each `can`/`cannot` call is a switch and some comparisons. `explain()` allocates its result, `fields()` allocates the requested field vector, queries allocate their result shape, and projections/updates allocate only the output their semantics require.

## 8. Complexity

```
generic rule engine:  O(rules) per check, plus O(condition keys) per candidate
compiled ability:     O(1) dispatch, plus O(conditions for that action)
```

The compiled check does not grow with the number of rules in the system — only with the rules for the action being asked about.

## 9. Physical strategies

For checks, an unconditional permission with no prohibition becomes `true`, a prohibition with no permission becomes `false`, and everything else becomes direct comparisons. For CQRS, the same action becomes an ordinary Query AST predicate: unconditional allow disappears, unconditional deny becomes an empty query, and actor fields become external bindings. Standalone projection emits direct static assignments. Authorized update emits one static branch per schema field and reads only fields present in the patch.

CQRS field projection is conservative. It exposes only fields proven safe for every returned row and intersects later `.select()` calls with that set. Subject-conditional output fields require `JIT.project(...).authorize(...)`; this security boundary prevents a raw row from escaping while avoiding an access-specific `~query` node.

## 10. AOT

The declaration lowers to the switch and nothing else — no rule array, matcher, condition interpreter, or JIT import. Authorized queries lower to one query program, authorized projections to direct property assignments, and authorized updates to a guard plus the specialized update. Serializable actors are emitted as data; non-serializable actors are reported as explicit AOT skips.

## 11. Runtime/AOT parity

`JIT.access` exists on `@jit-compiler/jit/runtime` and `@jit-compiler/jit/define` with the same signature, registers a reconstructive `access-plan` artifact, and is covered by the runtime/define/AOT parity matrix — which compares what the abilities *answer*, across permitted, denied and undeclared actions.

## 12. Benchmarks

Latest extension run: Node 22.22.3, Apple M1, 100,000 checks/rows per iteration. Reproduce with `pnpm bench:access`. The generic competitor scans rules and condition keys at runtime.

| Scenario                          | Generic rule scan | Handwritten check | JIT runtime |
| --------------------------------- | ----------------: | ----------------: | ----------: |
| 1 action, 1 unconditional rule    |         711.14 µs |         566.40 µs | **48.13 µs** |
| ownership + deny override         |           5.69 ms |         674.38 µs | **641.41 µs** |
| 8 actions, 20 rules, last action  |           4.91 ms |         574.09 µs | **566.74 µs** |
| field rule                        |                 — |         566.58 µs | **563.88 µs** |

Heap per check iteration stayed about **96–467 B** for compiled checks against **5.34–10.68 MB** for generic conditional scans.

Composed results from the same run:

| Composition, 100,000 rows | JIT | Comparison | Heap JIT / comparison |
| --- | ---: | ---: | ---: |
| CQRS ownership + deny | 307.08 µs | 977.07 µs `filter(ability.can)`; 286.09 µs handwritten | 781.32 KB / 818.49 KB / 818.45 KB |
| conditional projection | 3.15 ms | 3.20 ms handwritten | 5.93 MB / 4.83 MB |
| authorized title patch | 1.25 ms | 2.33 ms handwritten check + spread | 6.10 MB / 9.16 MB |

The CQRS compiler removes callback/ability dispatch, runs 3.18× faster than `filter(ability.can)`, and is within 7.3% of the handwritten loop while allocating slightly less in this run. Authorized projection is within 1.6% of handwritten throughput; its sparse conditional shape used 23% more measured heap. The specialized patch avoids enough copying to run 1.86× faster with one-third less heap than the spread baseline.

Two results, and they say different things.

Against a generic rule engine the gap is **8.9×** on the ownership rule and **8.7×** in the 20-rule scenario. Rules for other actions do not add runtime traversal; the generic scan still pays for them. The allocation difference is four orders of magnitude because the generic matcher reads condition keys from objects on every check.

Against a **handwritten** check the compiled ability is at parity — 641.41 µs against 674.38 µs for ownership, and 563.88 µs against 566.58 µs for a field rule. The unconditional rule is 11.8× faster because it folds to `return true` and reads no field. That is a real constant-folding result, not a general speed claim.

AOT and runtime agree within 1.1% (652.41 µs against 645.42 µs), as equivalent generated source should.

## 13. Tradeoffs

Conditions compare a subject field against a literal or an actor field. That covers ownership, tenancy, status and role checks; it does not cover arbitrary JavaScript, and it is not meant to — an arbitrary callback could not be compiled, could not be generated ahead of time, and could not be pushed into a query later.

Rules are fixed at declaration. Permissions that arrive from a database at run time are a different problem, and this is not the tool for them.

Field scoping answers both *may this field be touched* and composition constraints. `fields(action)` is conservative without a subject; `fields(action, subject)` evaluates conditional rules. CQRS intersects its output with the fields guaranteed safe for every returned row, while `JIT.project(...).authorize(...)` performs subject-aware conditional projection.

## 14. Best practices

Declare one ability per subject and build it once per actor, not once per check — the actor closure is what the per-check switch reads. Name the actor schema so `actor.field(...)` is checked; without it the field name is unverified.

Prefer several small `can` rules over one large condition: they compile to the same thing and read better. Use `cannot` for genuine prohibitions rather than by inverting a `can` — the precedence is the point.

Rely on default deny. Do not add a catch-all `can` and then subtract from it with prohibitions; the failure mode when a `cannot` is missed is an open door.

## 15. Non-goals

This is authorization, not authentication — nothing here identifies an actor. It does not manage roles, hierarchies or inheritance; a role is a field on the actor and a condition compares it.

It is not a policy language with its own file format, and it deliberately does not accept arbitrary predicates.
