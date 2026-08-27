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
```

Field-scoped rules, with or without a condition:

```ts
JIT.access(Post)
  .actor(User)
  .can("update", { fields: ["title"], when: (query, actor) => query.eq("authorId", actor.field("id")) })
  .cannot("update", { fields: ["body"] });
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
  return { can: can, cannot: (action, subject, field) => !can(action, subject, field) };
}
```

`delete` folds to `false` because the declaration has a prohibition for it and no permission — a denial that costs nothing at run time. An action nobody declared is not a case at all.

A field rule folds in beside the condition:

```js
case "update":
  return (subject.authorId === actor.id) && !((field !== undefined && (field === "body")));
```

## 7. Allocation model

Zero per check. The ability object is built once per actor; each check is a switch and some comparisons. The measurements below show 0.1–0.4 KB per 100,000 checks for the compiled path against 5–11 MB for the generic scan, which is the generic matcher reading condition keys at run time.

## 8. Complexity

```
generic rule engine:  O(rules) per check, plus O(condition keys) per candidate
compiled ability:     O(1) dispatch, plus O(conditions for that action)
```

The compiled check does not grow with the number of rules in the system — only with the rules for the action being asked about.

## 9. Physical strategies

There is one shape. What the compiler decides is how far each action's rules fold: an unconditional permission with no prohibition becomes `true`, a prohibition with no permission becomes `false`, and everything else becomes the comparisons the conditions call for.

## 10. AOT

The declaration lowers to the switch and nothing else — no rule array, no matcher, no condition interpreter, no import of JIT. The generated declaration types `action` to the literals a rule declared, so an action nobody granted is a type error rather than a silent `false`.

## 11. Runtime/AOT parity

`JIT.access` exists on `@jit-compiler/jit/runtime` and `@jit-compiler/jit/define` with the same signature, registers a reconstructive `access-plan` artifact, and is covered by the runtime/define/AOT parity matrix — which compares what the abilities *answer*, across permitted, denied and undeclared actions.

## 12. Benchmarks

Environment: Node 22.17.1, Linux x64, AMD Ryzen 7 5800H, 100,000 checks per iteration. Reproduce with `pnpm bench:access`. The "generic rule traversal" competitor is a rule engine of the shape described in section 1: scan the array, match `conditions` by walking its keys.

| Scenario                          | Generic rule scan | Handwritten check | JIT runtime |
| --------------------------------- | ----------------: | ----------------: | ----------: |
| 1 action, 1 unconditional rule    |         837.17 µs |         566.93 µs | **46.14 µs** |
| ownership + deny override         |           5.49 ms |         506.67 µs | **501.10 µs** |
| 8 actions, 20 rules, last action  |           5.43 ms |         511.14 µs | **475.13 µs** |
| field rule                        |                 — |         505.88 µs | **507.86 µs** |

Heap per iteration: **0.1–0.4 KB** for the compiled path, **5.5–10.9 MB** for the generic scan.

Two results, and they say different things.

Against a generic rule engine the gap is **11×** on a realistic ownership rule and grows with the rule count: 20 rules cost the compiled check nothing extra (475 µs, no worse than the two-rule case) while the scan pays for every one of them. The allocation difference is four orders of magnitude, and it is the whole reason: the generic matcher reads condition keys out of objects on every check.

Against a **handwritten** check the compiled ability is at parity — 501 µs against 507 µs — which is the target, not a victory. The exception is the unconditional rule, where the compiled form is 12× faster than the handwritten comparison because it folded to `return true` and reads no field at all. That is a real effect of compiling, but do not generalize it: the honest summary is that you get handwritten-quality checks from a declaration.

AOT and runtime agree within 2.5% (498.83 µs against 509.52 µs), as identical generated source should.

## 13. Tradeoffs

Conditions compare a subject field against a literal or an actor field. That covers ownership, tenancy, status and role checks; it does not cover arbitrary JavaScript, and it is not meant to — an arbitrary callback could not be compiled, could not be generated ahead of time, and could not be pushed into a query later.

Rules are fixed at declaration. Permissions that arrive from a database at run time are a different problem, and this is not the tool for them.

Field scoping answers *may this field be touched*; it does not filter a value for you. `fields(action)` gives you the allowed list when it can be settled without a subject, and you pass that to a projection yourself.

## 14. Best practices

Declare one ability per subject and build it once per actor, not once per check — the actor closure is what the per-check switch reads. Name the actor schema so `actor.field(...)` is checked; without it the field name is unverified.

Prefer several small `can` rules over one large condition: they compile to the same thing and read better. Use `cannot` for genuine prohibitions rather than by inverting a `can` — the precedence is the point.

Rely on default deny. Do not add a catch-all `can` and then subtract from it with prohibitions; the failure mode when a `cannot` is missed is an open door.

## 15. Non-goals

This is authorization, not authentication — nothing here identifies an actor. It does not manage roles, hierarchies or inheritance; a role is a field on the actor and a condition compares it.

It does not filter collections yet. The rules reuse the query condition AST specifically so an authorized predicate can be pushed into `JIT.cqrs.query()` later, and `fields(action)` exists so a read permission can be intersected with a projection — but the query integration is not wired up, and this document does not claim it is.

It is not a policy language with its own file format, and it deliberately does not accept arbitrary predicates.
