# Contract-first compilation

JIT operations are declared from schemas and lowered to specialized runtime
or AOT programs. The caller expresses intent and receives a callable contract;
the compiler selects legal physical strategies from proven facts and the
target profile.

```ts
const User = JIT.object({ id: JIT.string().uuid(), name: JIT.string() });
const isUser = JIT.validate.is(User);

isUser({ id: "550e8400-e29b-41d4-a716-446655440000", name: "Ada" });
isUser.explain({ physical: true });
```

`explain()` returns the semantic execution plan. The explicit physical form
returns the selected target, strategy decisions, evidence IDs, estimates, and
physical digest. It does not change the callable's behavior.

Validation modes remain distinct: `is()` is fail-fast and allocates no issue
on success or failure; parse and collect modes can materialize output and
diagnostics. `JIT.error` formats already-emitted issue descriptors after the
hot path, and locale changes do not invalidate validation code.

The first physical families cover fixed arrays/tuples and enum membership.
The implementation keeps a portable fallback, checks semantic legality before
cost, and preserves external enum values. More families such as membership
indexes and representation reuse require their own evidence and differential
tests.

Performance methodology and current evidence policy are documented in
[`docs/performance/assumptions.md`](../performance/assumptions.md). No speedup
claim is made without a reproducible benchmark report.
