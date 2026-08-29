# Mutation Planner

## Problem

`JIT.state.update(User)` accepts any deep-partial patch. That generality has a
price: the compiled function has to look at every field of every level it is
handed, because it cannot know which ones the caller filled in.

A declared patch is different. It is written once, in code:

```ts
const renameUser = JIT.state
  .update(User)
  .patch({
    name: JIT.cqrs.param("name"),
    profile: { address: { city: JIT.cqrs.param("city") } },
  })
  .compile();

renameUser(user, { name: "Grace", city: "Baltimore" });
```

Everything about the shape of that mutation is known before the call. The
mutation planner uses it.

## The plan

A declared patch lowers to a `MutationPlan`: a set of writes to normalized
paths, each with the schema of the leaf it assigns and the source of its value
(a parameter, or a declared value that travels as a binding). From those
writes the planner derives:

- the **read set** and **write set** of the mutation, as normalized paths;
- the **copy tree** — which levels have to be rebuilt because something below
  them changed.

Three passes run before any source is emitted:

- **dead write elimination** — a write no later write can be observed through
  is dropped, so `set name = A; set name = B` emits only `B`;
- **same-parent fusion** — writes under one parent rebuild that parent once,
  not once per write;
- **no-op detection** — a plan with no writes has no copy tree at all, and the
  mutation is the identity.

## Generated code

For a write to `profile.address.city` in a `User` with four fields:

```js
function mutate(value, params) {
  const __p_city = params.city;
  const l_profile_value = value.profile;
  const l_profile_address_value = l_profile_value.address;
  const l_profile_address_city_previous = l_profile_address_value.city;
  const l_profile_address_city =
    __p_city === undefined || Object.is(__p_city, l_profile_address_city_previous)
      ? l_profile_address_city_previous
      : __p_city;
  const l_profile_address_changed =
    l_profile_address_city !== l_profile_address_city_previous;
  let l_profile_address_next = l_profile_address_value;
  if (l_profile_address_changed)
    l_profile_address_next = { city: l_profile_address_city, zip: l_profile_address_value.zip };
  const l_profile_changed = l_profile_address_changed;
  let l_profile_next = l_profile_value;
  if (l_profile_changed)
    l_profile_next = { age: l_profile_value.age, address: l_profile_address_next };
  if (!(l_profile_changed)) return value;
  return { id: value.id, name: value.name, profile: l_profile_next, settings: value.settings };
}
```

Read what it does not do. It does not build a patch object. It does not walk a
path. It does not enumerate keys — every object literal has static keys, in
schema order. And it does not allocate before it knows something changed: the
comparison comes first, the object literal second. A level whose subtree did
not change keeps its reference, which is why `next.settings === value.settings`
holds without any test for it.

## What is specialized and what is not

The specialization has to mean exactly what a deep-partial patch means, so a
path is specialized only when the generic update would **assign** its leaf:

| Leaf | Specialized | Why |
| --- | --- | --- |
| primitive, enum, literal | yes | assigned |
| optional/nullable primitive | yes | assigned |
| date | yes | compared by instant, copied on write |
| object, array, tuple, record | no | the generic update *merges* these |
| map, set | no | replaced wholesale, through the generic path |
| union with object options | no | dispatches on the matching option |
| a level that may be absent | no | would have to be created before it is copied |

Anything in the second group keeps running through the generic deep-partial
update. A patch never quietly changes meaning in order to become faster.
`explain()` reports which strategy a declared patch got, along with its read
and write sets:

```ts
JIT.state.update(User).patch({ name: JIT.cqrs.param("name") }).explain();
// { strategy: "specialized", reads: ["name"], writes: ["name"], params: ["name"] }
```

Three rules the specialization inherits from the deep-partial update, exactly:
an absent value is not a write, an identical value is not a change, and a date
with the same instant is not a change.

## Runtime, define and AOT

A compiled declared patch registers a reconstructive `mutation-plan` artifact
carrying its source, its bindings and its read/write sets. `jit generate`
emits it as a single import-free function; declared values are inlined when
they can be serialized and the artifact is skipped with a reason when they
cannot. Runtime, define and AOT produce the same function.

## Performance

`pnpm bench:update`, recorded on a Ryzen 7 5800H, Node 22, on a three-level
object:

| Scenario | declared patch | generic update | handwritten spread | Immer |
| --- | --- | --- | --- | --- |
| deep nested scalar | 14.5 ns | 28.3 ns | 28.1 ns | 2.42 µs |
| deep nested scalar, unchanged | 9.8 ns | 15.3 ns | — | 369 ns |
| two branches, one shared parent | 20.0 ns | 35.8 ns | — | 2.80 µs |

The declared patch is about twice the generic update, which is the whole
claim: same semantics, less work, because the shape was known earlier. It also
edges out the handwritten spread, for a reason worth stating — a spread copies
whatever keys the object happens to have, while a static object literal is one
monomorphic shape the engine can see through.

## Best practices and non-goals

- Declare a patch when the shape is fixed and the values vary; use the generic
  update when the patch itself varies.
- Read `explain().strategy` when you expect a specialization and want to know
  you got one.
- Compare with `===` after a mutation to skip downstream work on a no-op.
- Collection mutation, change masks and inverse patches are not part of this
  plan yet; they are the next milestones on [Compiled State](./state.md).
