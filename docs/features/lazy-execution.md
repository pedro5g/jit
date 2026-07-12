# Lazy Queries, Iterators, And Visitors

JIT keeps eager arrays as the default and exposes lazy execution through
explicit terminal operations. A generator is useful when the consumer also
wants incremental consumption; it is not a universal replacement for the
specialized array loop emitted by `.compile()`.

## Output Contracts

```ts
const query = JIT.query(Users)
  .filter((q) => q.eq("active", true))
  .select("id", "name")
  .take(10);

const eager = query.compile();
const iterate = query.compileIterator();
const iterateAsync = query.compileAsyncIterator();
const visit = query.compileVisitor();

eager(users); // { id, name }[]
for (const user of iterate(users)) consume(user);
for await (const user of iterateAsync(cursor)) consume(user);
visit(users, consume); // number of consumed values
```

`.lazy().compile()` is an ergonomic alias for `.compileIterator()`. Prefer the
explicit terminal name in shared APIs because it makes the return contract
obvious at the call site.

## Incremental Operators

The lazy planner supports:

- `filter()` and `select()`;
- `flatMap(key)`;
- `take()`, `takeWhile()`, `drop()`, and `dropWhile()`;
- `unique(key)`;
- `chunk(size)`;
- `window(size)` and `pairwise()`;
- `scan({ initial, update })`;
- `groupAdjacentBy(key)` for already grouped/ordered input;
- `orderBy()`, with an explicit materialization barrier.

```ts
const tags = JIT.query(Posts).flatMap("tags").compileIterator();
const batches = JIT.query(Events).chunk(1_024).compileIterator();
const balances = JIT.query(Transactions)
  .scan({ initial: 0, update: (total, item) => total + item.amount })
  .compileIterator();
```

`window()` emits independent arrays. It does not expose a mutable ephemeral
view, so retaining one window cannot be corrupted by the next iteration.
`unique()` is lazy but retains a `Set`; its memory grows with distinct keys.
`groupAdjacentBy()` retains only the current group, but its input must already
be adjacent by key.

## Fusion And Physical Backends

Consecutive `filter`, `select`, `take`, `drop`, `takeWhile`, `dropWhile`, and
`unique` nodes are emitted as one physical stage. Array input uses a classic
indexed loop. There is no generator boundary between each logical operator.

`compileVisitor()` has a direct backend for the same fused operator set:

```js
function visit(input, consume) {
  let emitted = 0;
  for (let i = 0, len = input.length; i < len; i++) {
    const item = input[i];
    if (item.active !== true) continue;
    consume({ id: item.id });
    emitted++;
  }
  return emitted;
}
```

It avoids the iterator object, `{ value, done }` records, and suspension at
each result. It still pays one consumer call per accepted item. Pipelines with
cardinality-changing stages currently use the iterator backend as a correctness
fallback.

`compileAsyncIterator()` emits async generators and accepts both
`AsyncIterable` and synchronous `Iterable` sources. It awaits async `scan`
updates and naturally propagates consumer backpressure.

## Explain Materialization

```ts
query.explain("generator");
```

The report includes:

```ts
{
  outputMode: "generator",
  materializes: false,
  materializationReason: undefined,
  earlyTermination: true,
  retainedState: [],
  estimatedAllocationsPerResult: 1,
  barriers: [],
}
```

General `orderBy()` must see the complete input. Its report sets
`materializes: true`, records `orderBy` as a barrier, and explains why. Lazy
output changes how sorted values are delivered; it cannot remove the sort
buffer. Use an ordered index, top-k plan, or `groupAdjacentBy()` when the data
contract permits true streaming.

## Incremental Validation Issues

```ts
const issues = JIT.validate(User).issues().compile();

for (const issue of issues(input)) {
  log(issue.path, issue.code, issue.message);
}
```

This API lets the caller consume errors without retaining another result copy.
It shares the compiled `safeParse` validator, so issue ordering and messages
are identical. The current validator collects its issue vector during the
single validation pass before the iterator yields it; a future dedicated issue
emitter may remove that internal vector for extremely large invalid trees.

## Chunked JSON

```ts
const stringifyChunks = JIT.json(Users)
  .stringifyChunks({ chunkBytes: 16 * 1024 })
  .compile();

for (const chunk of stringifyChunks(users)) writable.write(chunk);
```

The array punctuation is streamed and each element uses the existing
shape-specialized serializer. `chunkBytes` is an approximate UTF-16 code-unit
budget, not a transport-byte guarantee. The chunks concatenate to exactly the
same JSON as the compiled full serializer.

## Benchmark

Run `pnpm bench:lazy`. On Node 22.17.1, linux-x64, Ryzen 7 5800H, one million
input rows:

| Flow | Average | Heap/op |
| --- | ---: | ---: |
| JIT iterator, first 10 matches | 4.39 us | 138 B |
| JIT eager array, first 10 matches | 4.60 us | 1.39 KiB |
| JIT iterator, 800k projected results | 18.04 ms | 7.75 MiB |
| JIT direct visitor, 800k results | **3.81 ms** | **760 B** |
| Handwritten generator, 800k results | 15.21 ms | 7.75 MiB |

The visitor is the high-throughput terminal when the consumer can be a
callback. The iterator is the ergonomic terminal for early termination,
`for...of`, composition with other iterable APIs, and unbounded sources.

## AOT And Tree Sharing

Iterator, async iterator, visitor, and chunked-JSON sources are self-contained
expressions registered in the artifact registry. AOT can emit pipelines whose
bindings are serializable. Pipelines such as `scan()` with an arbitrary runtime
callback are reported as non-buildable instead of silently embedding a closure.
Unused output backends are never generated, so importing an eager query does
not pull generator code into a browser bundle.
