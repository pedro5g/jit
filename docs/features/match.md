# Match

## 1. Problem

Dispatching on a discriminated union is written two ways, and both have a flaw. A hand-written `switch` is fast but its exhaustiveness depends on a `never` assertion someone remembered to add, and adding a member to the union silently falls through. A handler object — `handlers[event.type](event)` — is exhaustive-ish by construction but is a megamorphic property load per call and gives up narrowing unless the map's type is written carefully.

## 2. Why JIT

The union's members and their tags are declared in the schema, so the set of cases is known: the dispatch compiles to a `switch` over string literals that the engine can turn into a jump, and a missing case is caught when the match is *declared* rather than when the value arrives.

## 3. API

```ts
const handle = JIT.match(Event)
  .case("created", (event) => `created ${event.id}`)
  .case("updated", (event) => `updated ${event.field}`)
  .case("deleted", (event) => `deleted ${event.id}`)
  .exhaustive();
```

Or close it with a fallback instead of listing every tag:

```ts
JIT.match(Event)
  .case("created", (event) => event.id)
  .otherwise(() => 0);
```

## 4. Semantics

Each `case` handles one tag and receives the value narrowed to that member. `exhaustive()` requires every tag the union declares to have a case: a missing one is a type error *and* throws at declaration. `otherwise()` handles everything left over, which makes the match total without listing the remainder.

A tag the union does not declare is rejected at declaration. A value whose discriminator is not one of the declared tags — which the types say cannot happen, and which does happen when data crosses a boundary unvalidated — throws naming the tag, rather than returning `undefined`.

Result types are the union of what the cases return, so a match that returns different types per branch is typed as such rather than widened.

## 5. Compilation

```
JIT.match(Event).case(tag, handler)…
        ↓
tags read from the union's literal discriminators
        ↓
exhaustiveness checked against the declared set
        ↓
switch over the literals; handlers bound as external values
```

## 6. Generated code

```js
function match(value) {
  switch (value.type) {
    case "created":
      return __case0(value);
    case "updated":
      return __case1(value);
    case "deleted":
      return __case2(value);
    default:
      throw new Error("unmatched " + "type" + ": " + String(value.type));
  }
}
```

No handler object, no property load by computed key, no chain of comparisons. With `otherwise()` the default calls the fallback instead of throwing.

## 7. Allocation model

Zero. The dispatch allocates nothing; the handlers are bound once when the match is compiled.

## 8. Complexity

O(1) dispatch — a `switch` over dense string literals, which V8 compiles to a hash lookup or a jump table rather than a comparison chain.

## 9. Physical strategies

One shape. What the compiler decides is whether a default is a fallback call or a throw, which follows from how the match was closed.

## 10. AOT

Runtime and define use the same `match-plan` artifact. Reconstructible handlers are emitted as module-local bindings beside the same standalone `switch`; the output imports neither JIT nor a runtime matcher. Native, bound, or closure-dependent handlers remain an explicit AOT barrier and are reported in `skipped` rather than being miscompiled.

## 11. Runtime/AOT parity

`JIT.match` exists with the same builder on runtime and define. Reconstructible handlers have runtime/AOT semantic parity; callbacks that capture inaccessible state produce an explicit skip reason.

## 12. Benchmarks

No performance claim is made here. The generated dispatch is the `switch` you would have written, so against a hand-written `switch` it is at parity by construction. Against a handler-object lookup it avoids a computed property load per call, but that is a small constant and it would be misleading to headline it.

The reasons to use this are the exhaustiveness check at declaration and the narrowing, not speed.

## 13. Tradeoffs

The discriminator is inferred from the shape at the type level: a property whose type is a single literal rather than the whole primitive. That is correct for an ordinary discriminated union, and it would misread a union where a *non*-discriminating field also happens to be literal-typed in every member.

Prefer self-contained handler functions in definition files when AOT output is required. A closure over application state is still useful at runtime, but it deliberately blocks standalone generation.

## 14. Best practices

Prefer `exhaustive()` over `otherwise()` when the union is closed and you want adding a member to break the build — that is most of the value. Reach for `otherwise()` only when the remainder genuinely shares one behavior.

Keep handlers small and pass work out to named functions; the compiled dispatch is a jump, and a large inline handler is the thing that will actually cost you.

## 15. Non-goals

This matches on a declared discriminator, not on structure, values, ranges or nested patterns — it is not a pattern-matching language. It does not validate: a value whose tag is outside the union throws rather than being coerced, and if the value came from outside the program it should go through `JIT.validate` first.
