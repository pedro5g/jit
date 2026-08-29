# Collection Mutations

## Problem

This is not an array API. `updateByKey`, `removeByKey` and `upsert` say what
should happen to a row; **which algorithm finds that row is decided from the
collection's declared facts**, by the same planner queries and lookups use.

```ts
const Users = JIT.array(User).keyed("id");

const renameUser = JIT.state
  .collection(Users)
  .updateByKey({ key: "id", patch: { name: JIT.cqrs.param("name") } });

renameUser(users, { key: "u_1", name: "Grace" });
```

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

## Fact preservation

A mutation must not leave a collection whose declared facts have stopped being
true. Writing the identity key changes which row a key reaches and can break
uniqueness; writing the ordering key can move the row out of order while the
collection still claims to be sorted. Both are repairs rather than writes, so
the first version refuses them:

```ts
JIT.state.collection(Users).updateByKey({ key: "id", patch: { id: JIT.cqrs.param("id") } });
// JITError: updateByKey() cannot write the identity key "id"; remove and insert the row instead
```

Remove and insert instead. Explicit rekey and reposition operations can be
added later; silently invalidating a fact cannot.

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

## Runtime, define and AOT

Each mutation registers a reconstructive `collection-mutation-plan` artifact
carrying its source, its bindings and its resolved access path. `jit generate`
emits it as one import-free function; the upsert's structural no-op test is
schema-specialized equality inlined as a local helper, and the index cache
helper is emitted once per module. Runtime, define and AOT produce the same
function.

## Best practices and non-goals

- Declare the fact you actually have. `.keyed()` when you look rows up
  repeatedly on the same array; `.ordered()` when the collection is sorted and
  you would rather allocate nothing.
- Do not declare `.keyed()` on an array you rebuild every call: the index is
  built once per array, and rebuilding the array rebuilds the index.
- Compare with `===` after a mutation — a missing key and an unchanged row both
  return the original array.
- `updateWhere`, `removeWhere`, rekey, reposition, and Map/Set mutation are not
  part of this milestone.
