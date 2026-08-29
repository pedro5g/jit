# State Collections

## Problem

This is not an array API. `updateByKey`, `removeByKey`, `replaceByKey`, and `upsert` say what
should happen to a row; **which algorithm finds that row is decided from the
collection's declared facts**, by the same planner queries and lookups use.

```ts
const Users = JIT.array(User).keyed("id");

const renameUser = JIT.state
  .collection(Users)
  .updateByKey({ key: "id", patch: { name: JIT.cqrs.param("name") } });

renameUser(users, { key: "u_1", name: "Grace" });
```

Positional intent is compiled by the same artifact surface:

```ts
const Items = JIT.state.collection(JIT.array(Item));

const insert = Items.insertAt();
const update = Items.updateAt({ patch: { status: JIT.cqrs.param("status") } });
const move = Items.move();

insert(items, { index: 2, row: nextItem });
update(items, { index: 2, status: "ready" });
move(items, { from: 2, to: 0 });
```

The complete positional surface is `append`, `prepend`, `insertAt`,
`removeAt`, `replaceAt`, `updateAt`, `swap`, `move`, and `truncate`. Invalid or
non-integer positions return the original collection. `insertAt` accepts the
end position; the other indexed operations require an existing slot.

Declare `.ordered("id").uniqueBy("id")` instead and the same code binary-searches
rather than scans. Nothing about the call changes.

## Access paths

| Facts on the collection | Strategy | Finding a row |
| --- | --- | --- |
| `.keyed(key)` | `CachedIndexLookup` | `O(1)` |
| `.ordered(key)` + unique | `BinarySearch` | `O(log n)` |
| none of the above | `EarlyExitScan` | `O(k)` |

`explain()` reports the choice, the facts it rested on, and — separately — what
materializing the result costs:

```ts
renameUser.explain();
// {
//   operation: "updateByKey",
//   key: "id",
//   physical: { strategy: "CachedIndexLookup", complexity: "O(1)", facts: [...] },
//   copy: "O(n)",
// }
```

**Be honest about `copy`.** An immutable replacement rebuilds the array, and
that is `O(n)` whatever found the row. A binary search does not make removal
cheaper than linear — it makes *discovery* cheaper. The two numbers are
reported separately because they are different claims.

A mutation needs the slot, not the row, so the index shape that answers it maps
the key to a **position**. It is the same builder, the same key reads and the
same cache as the value index; only what it stores differs. A binary search
returns the position when the key is present and the bitwise complement of the
insertion point when it is not, so a miss already knows where the row belongs.

## Generated code

```js
function mutate(value, params) {
  const at = find(value, params.key);
  if (at < 0) return value;
  const row = value[at];
  const next = /* the row's mutation plan */;
  if (next === row) return value;
  const out = value.slice();
  out[at] = next;
  return out;
}
```

Nothing is copied before the decision. A key that is absent returns the
original array; a row that did not semantically change returns the original
array. Removal fills one array of length `n - 1` with two indexed loops rather
than calling `filter`, which would visit every row, run a callback per row, and
mix finding the target with building the result.

An ordered `upsert` inserts at the position the search reported, so the
collection is still ordered afterwards.

Positional operations do no search and report `DirectPosition` in `explain()`.
Insertion, removal, movement, and truncation allocate one exact-sized array
only after their bounds/no-op checks. `updateAt` first runs the element's shared
`MutationPlan`; when that plan returns the original element, the collection is
also returned unchanged. `replaceAt` uses compiled equality, so a structurally
equal replacement is a no-op even when it is a different object reference.

`move` copies ranges directly and never creates the intermediate arrays that
two `splice` calls imply. `swap` copies once, and returns the original array for
the same position or the same two element references.

## Selecting by predicate

When identity is not the question, `updateWhere`, `removeWhere`, and
`replaceWhere` select rows
with the **shared query condition** — the same builder `JIT.cqrs.query` uses.
There is no separate mutation predicate language:

```ts
const deactivateStale = JIT.state
  .collection(Users)
  .updateWhere((query) => query.lt("lastSeen", JIT.cqrs.param("cutoff")), {
    active: JIT.cqrs.param("active"),
  });

const dropInactive = JIT.state.collection(Users).removeWhere((query) => query.eq("active", false));
```

A predicate that can match several rows visits every row — that is what the
predicate means. But when it is **one equality over a key the collection
declares unique**, the planner lifts it onto the same access path identity uses,
and at most one row is reached:

```ts
JIT.state
  .collection(Users)
  .updateWhere((query) => query.eq("id", JIT.cqrs.param("id")), { name: JIT.cqrs.param("name") })
  .explain().physical.strategy; // "CachedIndexLookup"
```

Both scans allocate late. `updateWhere` does not copy the array until a row
actually changes, so a predicate that matches nothing — or matches rows that
were already correct — returns the original collection. `removeWhere` counts
the matches first and then fills exactly one array of the final length; the
predicate runs twice per row, which is the price of never over-allocating and
never growing an array.

## Ordered repositioning

Writing the ordering key does not invalidate the ordering fact — it relocates
the row. Replacing it in place would leave a collection that still claims to be
sorted, so the mutation repairs the order instead:

```ts
const Tasks = JIT.array(Task).keyed("id").ordered("rank");
const reorder = JIT.state
  .collection(Tasks)
  .updateByKey({ key: "id", patch: { rank: JIT.cqrs.param("rank") } });

reorder(tasks, { key: "b", rank: 9 }); // b moves to where rank 9 belongs
```

The collection minus the old slot is still sorted, so the destination is a
binary search over *the array the mutation is about to produce*, not a re-sort:
the search skips the moved row while it looks. When the new key lands in the
same slot the copy is the ordinary one-slot replacement; when it does not, one
array is filled from three ranges and nothing is shifted twice. A no-op patch
and a missing key still return the original collection.

`explain().mutation` reports both facts at once — `changesOrder: true`, because
the row moved, and `preservesOrdering: true`, because the collection is sorted
afterwards.

## Fact preservation

A mutation must not leave a collection whose declared facts have stopped being
true. Writing the identity key changes which row a key reaches and can break
uniqueness, so it is refused:

```ts
JIT.state.collection(Users).updateByKey({ key: "id", patch: { id: JIT.cqrs.param("id") } });
// JITError: updateByKey() cannot write the identity key "id"; remove and insert the row instead
```

The identity key is different from the ordering key, and the two are handled
differently on purpose. Moving a row is a repair the planner can perform, so
writing the ordering key repositions. Changing which row a key reaches is a
decision about identity, and the collection cannot make it for you: remove and
insert instead. An explicit `rekey` can be added if a real case appears;
silently invalidating a fact cannot.

## Performance

`pnpm bench:collection-state`, Ryzen 7 5800H, Node 22. Updating one row in the
middle of the collection:

| n | JIT keyed | JIT ordered | JIT scan | findIndex + slice | map | Immer |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 0.12 µs | 0.13 µs | 0.27 µs | 0.28 µs | 0.73 µs | 25 µs |
| 1 000 | 0.97 µs | 0.95 µs | 2.9 µs | 3.0 µs | 7.5 µs | 233 µs |
| 10 000 | 8.6 µs | 11.5 µs | 29 µs | 32 µs | 74 µs | 2.6 ms |
| 100 000 | 420 µs | 411 µs | 696 µs | 661 µs | 1.3 ms | 40 ms |

Removing one row:

| n | JIT keyed | JIT scan | `filter` | findIndex + `toSpliced` |
| --- | --- | --- | --- | --- |
| 100 | 0.17 µs | 0.38 µs | 0.78 µs | 0.30 µs |
| 1 000 | 1.5 µs | 3.5 µs | 9.5 µs | 3.2 µs |
| 10 000 | 18 µs | 41 µs | 82 µs | 33 µs |
| 100 000 | 527 µs | 762 µs | 2.3 ms | 674 µs |

Ordered `upsert` of a new row, against rebuilding and re-sorting:

| n | JIT ordered upsert | concat + sort |
| --- | --- | --- |
| 100 | 0.18 µs | 2.6 µs |
| 1 000 | 1.6 µs | 25 µs |
| 10 000 | 16 µs | 246 µs |
| 100 000 | 521 µs | 3.9 ms |

Read the last row of each table. **At 100 000 the copy dominates and the
strategies converge** — the keyed path is 1.7× the scan, not 100×, because both
are paying for the same array. The declared facts buy discovery, and discovery
is only worth what it is worth. Where they do earn their keep is the middle of
the range and repeated mutation of the same array, since the index is built
once per array and reused.

A handwritten `Map` of key to position, built outside the measurement and never
invalidated, runs within noise of the keyed path at every size. That comparison
is marked *not comparable* in the benchmark for exactly that reason: it is the
ceiling, not a competitor.

The same benchmark measures every positional operation at 8, 64, 1 000,
10 000, and 100 000 elements, with idiomatic JavaScript, a handwritten ceiling,
runtime JIT, standalone AOT, heap, and GC samples. Representative results from
the same machine at 100 000 elements:

| Operation | Runtime JIT | AOT | Idiomatic baseline | Handwritten |
| --- | ---: | ---: | ---: | ---: |
| `updateAt` | 406 µs | 402 µs | 405 µs | 409 µs |
| `move` | 503 µs | 496 µs | 423 µs (`slice` + two `splice`) | 512 µs |
| `truncate` | 258 µs | 265 µs | 210 µs (`slice`) | 260 µs |

These measurements are deliberately not a blanket speed claim. Direct loops
avoid intermediate collection allocations and stay near the handwritten
ceiling, but V8's native `slice`/`splice` paths can be faster for large arrays.
The persisted report records allocation as well as time; future physical
selection should only replace the current one-allocation strategy when the
full size/allocation regime supports it.

## Runtime, define and AOT

Each mutation registers a reconstructive `collection-mutation-plan` artifact
carrying its source, its bindings and its resolved access path. `jit generate`
emits it as one import-free function; the upsert's structural no-op test is
schema-specialized equality inlined as a local helper, and the index cache
helper is emitted once per module. The define host builds the same semantic
descriptor without calling `new Function`; attempting to execute that
descriptor fails until generation. Runtime, define, and AOT preserve the same
observable contract.

## Best practices and non-goals

- Declare the fact you actually have. `.keyed()` when you look rows up
  repeatedly on the same array; `.ordered()` when the collection is sorted and
  you would rather allocate nothing.
- Do not declare `.keyed()` on an array you rebuild every call: the index is
  built once per array, and rebuilding the array rebuilds the index.
- Compare with `===` after a mutation — a missing key and an unchanged row both
  return the original array.
- Prefer `updateByKey` over `updateWhere` when the question really is identity:
  it needs no predicate and no condition to evaluate.
- Use CQRS for `map`, `filter`, and `groupBy`; state collections own immutable
  mutation, not collection querying.
- Rekey and Map/Set mutation are not part of this milestone.
