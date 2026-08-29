# Mutation Changes

## Problem

The usual way to learn what a mutation did is to ask afterwards:

```text
before → update → after → diff(before, after) → diff(after, before)
```

That is three passes over the same fields. The mutation already compared those
fields — it had to, to decide which levels to rebuild. Asking again is asking
for work that was already done and thrown away.

## Requesting outputs

```ts
const renameUser = JIT.state
  .update(User)
  .patch({ name: JIT.cqrs.param("name"), profile: { city: JIT.cqrs.param("city") } })
  .result({ value: true, changed: true, patch: true, inverse: true })
  .compile();

const { value, changed, patch, inverse } = renameUser(user, { name: "Grace", city: "Paris" });
```

Without `.result(...)` a declared patch returns the new value and nothing else,
so the fast path is exactly what it was. **An output nobody asked for is not
computed and does not appear in the generated source** — a test asserts that
`result({ patch: true })` emits no mask and no inverse, and so on for each
channel.

## Intent is not change

A mutation that *writes* `name` has not necessarily *changed* it. The mask is
set from the same comparison the copy plan used, never from the write set:

```js
if (root_name !== root_name_previous) mask |= 2;
```

So `result.changed` is exactly `JIT.compare.changed(User)(before, result.value)`
— a property test holds the two against each other over random inputs, on the
mask and on reference identity both.

## Change layout

A mask is only meaningful next to the path-to-bit agreement it was produced
against. That agreement is a `ChangeLayout`, and `compare.changed`, mutation
results, watch and derived computations all read the same one:

```ts
renameUser.layout();
// { paths: ["id", "name", "profile", "settings"], representation: "int32", id: "int32:id,name,profile,settings" }
```

`result({ changed: true })` uses the default layout — every top-level field, the
same one `JIT.compare.changed(Model)` uses. Pass paths instead to narrow it:
`result({ changed: ["profile.address.city"] })`. A mask produced against a
different layout is a different number; the `id` exists so that can be checked
rather than assumed. Masks are a runtime optimization and are never a
persistence format.

## Forward and inverse patches

Both are deep-partial objects carrying **only what changed**:

```ts
patch;   // { name: "Grace", profile: { city: "Paris" } }
inverse; // { name: "Ada",   profile: { city: "London" } }
```

They apply through the ordinary patch contract, so undo and redo need no
history manager and no draft:

```ts
const applyPatch = JIT.state.patch.apply(User);

applyPatch(before, patch) // → after
applyPatch(after, inverse) // → before
```

A mutation that changed nothing produces `patch: undefined` and
`inverse: undefined` rather than empty objects — a no-op must not allocate a
nested object to say it did nothing.

## Performance

`pnpm bench:update`, Ryzen 7 5800H, Node 22, three-level object, two fields
changed under one parent:

| Outputs | one pass | separate passes |
| --- | --- | --- |
| value, mask, forward patch, inverse patch | 57 ns | 894 ns (`update` + `changed` + `diff` + inverse `diff`) |
| value, mask | 24 ns | 44 ns (`update` + `changed`) |

The four-channel case is where the argument lives: 15× is not a constant-factor
win, it is three passes that stopped happening.

## Runtime, define and AOT

A channelled mutation registers the same reconstructive `mutation-plan`
artifact, plus its layout. `jit generate` emits one import-free function that
produces the same object and reports the same layout. Runtime, define and AOT
agree on the mask, on both patches, and on returning the input value unchanged
for a no-op.

## Best practices and non-goals

- Ask for the channels you consume. Each one is work.
- Compare `result.value === before` (or `result.changed === 0`) to skip
  downstream work.
- Check `layout().id` before comparing masks that came from different
  artifacts.
- Do not persist a mask. It describes an agreement that lives in one build.
- JIT does not manage undo history. It gives you the two patches; where they
  are stored is an application decision.
