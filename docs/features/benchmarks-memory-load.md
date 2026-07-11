# Benchmarks, Memory, And Load Testing

Benchmarks in this repository are not only microbenchmarks. They are organized
to answer different questions:

- how fast is one hot operation;
- how much heap does it allocate per call;
- how does it behave with 10k/100k item loads;
- how does it compare with Zod, TypeBox, typia, and focused competitors;
- whether generated AOT functions keep parity with runtime JIT.

## Commands

```sh
pnpm bench:validate
pnpm bench:load
pnpm bench:flows
pnpm bench:all
pnpm bench:report
```

`bench:report` reads `bench/results/*.latest.json` and writes
`docs/internal/BENCH.md`.

## Validation Benchmarks

`pnpm bench:validate` measures single-object validation:

- JIT runtime;
- JIT AOT generated output;
- typia generated validators;
- Zod safeParse;
- selected generic/handwritten baselines marked as not comparable.

This is useful for per-call overhead and invalid-input error paths.

## Load Benchmarks

`pnpm bench:load` preallocates large arrays and measures validation only:

- valid users 10k;
- valid users 100k;
- invalid item at the head;
- invalid item at the tail;
- boolean `is()` and diagnostic `safeParse()`.

Competitors include:

- TypeBox `TypeCompiler.Check`;
- TypeBox `Value.Check`;
- typia generated `createIs<T[]>()` / `createValidate<T[]>()`;
- Zod 4.

This matters because many libraries look good on small objects but allocate
heavily under array load. The load suite reports both time and `heap/op`.

## Flow Benchmarks

`pnpm bench:flows` models a real pipeline:

1. validate unknown values;
2. filter/query;
3. project DTOs;
4. stringify JSON.

This is often closer to production than a single validator call. It shows
whether the system avoids intermediate arrays and whether GC pressure stays
low under throughput.

## How To Read Heap Numbers

Heap numbers are more important than they look. A function that is only a bit
slower but allocates megabytes per call can produce worse tail latency once GC
starts running.

Look for:

- `b` or tiny `kb` allocation on boolean guards;
- lower allocation for valid `safeParse`;
- no megabyte-scale heap in hot 100k validation paths;
- stable heap when comparing runtime JIT and AOT.

## Why JIT Usually Allocates Less

JIT avoids common allocation sources:

- no schema interpreter object per call;
- no callback arrays in query pipelines;
- no intermediate arrays for `filter().map().reduce()` chains;
- no issue array for `is()`;
- no error class in generated output unless `parse` is selected;
- no hash/index helper unless the selected operation needs it.

## Why JIT Usually Runs Faster

The generated hot path is specialized:

- direct property access;
- stable object shapes;
- classic indexed loops;
- cheapest checks first;
- early exits on invalid input;
- fused query/mapper loops;
- cached hash/index helpers for repeated structural operations.

## AOT Benchmarking

AOT benchmarks are important because they prove generated code behaves like
runtime JIT without paying runtime compilation cost. When benchmarking a
front-end route, prefer importing from generated output, because that is what
the user actually ships.

## Best Practices For Local Benchmarks

- Run each suite more than once and compare ratios, not absolute numbers.
- Close noisy background processes.
- Keep fixture generation outside the benchmarked function.
- Compare `is()` with other boolean guards and `safeParse()` with other
  diagnostic validators.
- Mark biased baselines clearly.
- Always inspect memory, not only time.

## CI And Review

Generated reports should be used to catch regressions, but benchmark numbers
vary by CPU, Node version, and operating system. Treat large ratio changes as
signals to investigate, not as the only acceptance criterion.
