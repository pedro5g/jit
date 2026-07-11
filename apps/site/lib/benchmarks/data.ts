/**
 * Benchmark results published in packages/jit/README.md, captured with mitata
 * on Node 22.17.1, linux-x64, AMD Ryzen 7 5800H (Zod 4.4.3, TypeBox 0.34,
 * typia 12, captured 2026-07-11). Regenerate with the listed commands; a
 * build-time data generator replaces this file in the benchmarks phase.
 */

export interface BenchmarkEntry {
  name: string;
  /** normalized to nanoseconds for bar scaling */
  valueNs: number;
  /** value as printed in the README */
  display: string;
  highlight?: boolean;
}

export interface BenchmarkSuite {
  id: string;
  title: string;
  description: string;
  command: string;
  lowerIsBetter: true;
  entries: BenchmarkEntry[];
}

export const benchmarkEnvironment = {
  runner: "mitata",
  runtime: "Node 22.17.1",
  os: "linux-x64",
  cpu: "AMD Ryzen 7 5800H",
  captured: "2026-07-11",
  competitors: "Zod 4.4.3 · TypeBox 0.34 · typia 12 · fast-json-stringify 7",
};

export const benchmarkSuites: BenchmarkSuite[] = [
  {
    id: "validate-is",
    title: "is() — valid object",
    description: "Boolean guard over a realistic user object.",
    command: "pnpm bench:validate",
    lowerIsBetter: true,
    entries: [
      { name: "jit (AOT)", valueNs: 56.99, display: "56.99 ns", highlight: true },
      { name: "jit (runtime)", valueNs: 57.56, display: "57.56 ns", highlight: true },
      { name: "Zod 4", valueNs: 903.69, display: "903.69 ns" },
    ],
  },
  {
    id: "safeparse-invalid",
    title: "safeParse — invalid object, 7 issues",
    description: "Structured issue reporting on a deeply broken input.",
    command: "pnpm bench:validate",
    lowerIsBetter: true,
    entries: [
      { name: "jit (runtime)", valueNs: 118.56, display: "118.56 ns", highlight: true },
      { name: "Zod 4", valueNs: 24_990, display: "24.99 µs" },
    ],
  },
  {
    id: "equal-array",
    title: "equal — array with 100k items",
    description: "Schema-aware deep equality over a large collection.",
    command: "pnpm bench:equal",
    lowerIsBetter: true,
    entries: [
      { name: "jit", valueNs: 734_370, display: "734.37 µs", highlight: true },
      { name: "fast-deep-equal", valueNs: 9_580_000, display: "9.58 ms" },
    ],
  },
  {
    id: "update-deep",
    title: "update — deep immutable patch",
    description: "Surgical immutable update of a nested object (no Proxy).",
    command: "pnpm bench:update",
    lowerIsBetter: true,
    entries: [
      { name: "jit", valueNs: 18.41, display: "18.41 ns", highlight: true },
      { name: "immer", valueNs: 2_220, display: "2.22 µs" },
    ],
  },
  {
    id: "stringify-user",
    title: "JSON stringify — medium user",
    description: "Compiled serializer with static keys and escape fast path.",
    command: "pnpm bench:serialize",
    lowerIsBetter: true,
    entries: [
      { name: "jit", valueNs: 207.49, display: "207.49 ns", highlight: true },
      { name: "fast-json-stringify", valueNs: 266.52, display: "266.52 ns" },
    ],
  },
  {
    id: "load-safeparse",
    title: "safeParse — 100k users, invalid tail",
    description: "High-load validation with issue collection at the end of the batch.",
    command: "pnpm bench:load",
    lowerIsBetter: true,
    entries: [
      { name: "jit", valueNs: 6_370_000, display: "6.37 ms", highlight: true },
      { name: "typia (generated)", valueNs: 27_760_000, display: "27.76 ms" },
      { name: "Zod 4", valueNs: 111_380_000, display: "111.38 ms" },
      { name: "TypeBox (compiled)", valueNs: 300_240_000, display: "300.24 ms" },
    ],
  },
];

export interface ProofStat {
  value: string;
  label: string;
  detail: string;
}

export const proofStats: ProofStat[] = [
  {
    value: "15.9x",
    label: "faster is() than Zod 4",
    detail: "valid object · 56.99 ns vs 903.69 ns",
  },
  {
    value: "207x",
    label: "faster safeParse on invalid input",
    detail: "7 issues reported · 118.56 ns vs 24.99 µs",
  },
  {
    value: "120x",
    label: "faster immutable update than immer",
    detail: "deep patch · 18.41 ns vs 2.22 µs",
  },
  {
    value: "8.64x",
    label: "faster 1M-row load+query, 74% less heap",
    detail: "binary rowsets vs Zod parse + native filter",
  },
];
