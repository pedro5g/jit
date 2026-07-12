/**
 * Benchmark results published in packages/jit/README.md, captured with mitata
 * on Node 22.17.1, linux-x64, AMD Ryzen 7 5800H (Zod 4.4.3, TypeBox 0.34,
 * typia 12, fast-json-stringify 7, captured 2026-07-11). Regenerate with the
 * listed commands; a build-time data generator replaces this file later.
 */

export interface BenchmarkEntry {
  name: string;
  /** normalized to nanoseconds for bar scaling */
  valueNs: number;
  /** value as printed in the README */
  display: string;
  /** heap per op as printed in the README, when measured */
  heap?: string;
  highlight?: boolean;
}

export interface BenchmarkSuite {
  id: string;
  group: string;
  title: string;
  description: string;
  command: string;
  lowerIsBetter: true;
  /** shown in the landing benchmarks section */
  landing?: boolean;
  note?: string;
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
    group: "Validation",
    title: "is() — valid object",
    description: "Boolean guard over a realistic user object.",
    command: "pnpm bench:validate",
    lowerIsBetter: true,
    landing: true,
    entries: [
      { name: "jit (AOT)", valueNs: 56.99, display: "56.99 ns", heap: "0.26 b", highlight: true },
      { name: "jit (runtime)", valueNs: 57.56, display: "57.56 ns", highlight: true },
      { name: "Zod 4", valueNs: 903.69, display: "903.69 ns", heap: "2.29 kb" },
    ],
  },
  {
    id: "safeparse-invalid",
    group: "Validation",
    title: "safeParse — invalid object, 7 issues",
    description: "Structured issue reporting on a deeply broken input.",
    command: "pnpm bench:validate",
    lowerIsBetter: true,
    entries: [
      { name: "jit (runtime)", valueNs: 118.56, display: "118.56 ns", heap: "624.33 b", highlight: true },
      { name: "jit (AOT)", valueNs: 120.59, display: "120.59 ns", highlight: true },
      { name: "Zod 4", valueNs: 24_990, display: "24.99 µs", heap: "5.31 kb" },
    ],
  },
  {
    id: "load-is-10k",
    group: "High-load validation",
    title: "is() — 10k valid users",
    description: "Preallocated batch of unknown users, validation work only.",
    command: "pnpm bench:load",
    lowerIsBetter: true,
    entries: [
      { name: "jit", valueNs: 542_450, display: "542.45 µs", heap: "1.43 KB", highlight: true },
      { name: "typia (generated)", valueNs: 661_980, display: "661.98 µs", heap: "152 B" },
      { name: "TypeBox (compiled)", valueNs: 751_530, display: "751.53 µs", heap: "774.69 KB" },
      { name: "Zod 4", valueNs: 9_760_000, display: "9.76 ms", heap: "4.16 MB" },
    ],
  },
  {
    id: "load-is-100k",
    group: "High-load validation",
    title: "is() — 100k valid users",
    description: "Same benchmark at 100k rows — jit stays allocation-free.",
    command: "pnpm bench:load",
    lowerIsBetter: true,
    landing: true,
    entries: [
      { name: "jit", valueNs: 7_010_000, display: "7.01 ms", heap: "96 B", highlight: true },
      { name: "typia (generated)", valueNs: 7_170_000, display: "7.17 ms", heap: "152 B" },
      { name: "TypeBox (compiled)", valueNs: 7_220_000, display: "7.22 ms", heap: "5.34 MB" },
      { name: "Zod 4", valueNs: 114_150_000, display: "114.15 ms", heap: "21.14 MB" },
    ],
  },
  {
    id: "load-safeparse-10k",
    group: "High-load validation",
    title: "safeParse — 10k valid users",
    description: "Structured parsing over a preallocated batch.",
    command: "pnpm bench:load",
    lowerIsBetter: true,
    entries: [
      { name: "jit", valueNs: 567_170, display: "567.17 µs", heap: "1.73 KB", highlight: true },
      { name: "TypeBox (compiled)", valueNs: 655_540, display: "655.54 µs", heap: "560.25 KB" },
      { name: "typia (generated)", valueNs: 793_310, display: "793.31 µs", heap: "263.75 B" },
      { name: "Zod 4", valueNs: 11_240_000, display: "11.24 ms", heap: "6.21 MB" },
    ],
  },
  {
    id: "load-safeparse-100k",
    group: "High-load validation",
    title: "safeParse — 100k users, invalid tail",
    description: "Issue collection at the end of a 100k batch.",
    command: "pnpm bench:load",
    lowerIsBetter: true,
    landing: true,
    entries: [
      { name: "jit", valueNs: 6_370_000, display: "6.37 ms", heap: "1.95 KB", highlight: true },
      { name: "typia (generated)", valueNs: 27_760_000, display: "27.76 ms", heap: "5.46 MB" },
      { name: "Zod 4", valueNs: 111_380_000, display: "111.38 ms", heap: "21.01 MB" },
      { name: "TypeBox (compiled)", valueNs: 300_240_000, display: "300.24 ms", heap: "4.64 MB" },
    ],
  },
  {
    id: "equal-array",
    group: "Data operations",
    title: "equal — array with 100k items",
    description: "Schema-aware deep equality over a large collection.",
    command: "pnpm bench:equal",
    lowerIsBetter: true,
    landing: true,
    entries: [
      { name: "jit", valueNs: 734_370, display: "734.37 µs", heap: "96 b", highlight: true },
      { name: "fast-deep-equal", valueNs: 9_580_000, display: "9.58 ms", heap: "12.21 MB" },
    ],
  },
  {
    id: "diff-nested",
    group: "Data operations",
    title: "diff — nested arrays",
    description: "Structural diff entries over nested collections.",
    command: "pnpm bench:diff",
    lowerIsBetter: true,
    entries: [
      { name: "jit", valueNs: 297_310, display: "297.31 µs", heap: "1 KB", highlight: true },
      { name: "microdiff", valueNs: 7_660_000, display: "7.66 ms", heap: "7.87 MB" },
    ],
  },
  {
    id: "update-deep",
    group: "Data operations",
    title: "update — deep immutable patch",
    description: "Surgical immutable update of a nested object (no Proxy).",
    command: "pnpm bench:update",
    lowerIsBetter: true,
    landing: true,
    entries: [
      { name: "jit", valueNs: 18.41, display: "18.41 ns", heap: "120 b", highlight: true },
      { name: "immer", valueNs: 2_220, display: "2.22 µs", heap: "3.49 KB" },
    ],
  },
  {
    id: "stringify-user",
    group: "Serialization & streaming",
    title: "JSON stringify — medium user",
    description: "Compiled serializer with static keys and escape fast path.",
    command: "pnpm bench:serialize",
    lowerIsBetter: true,
    landing: true,
    entries: [
      { name: "jit", valueNs: 207.49, display: "207.49 ns", heap: "875 b", highlight: true },
      { name: "fast-json-stringify", valueNs: 266.52, display: "266.52 ns", heap: "1.00 KB" },
    ],
  },
  {
    id: "stream-reject",
    group: "Serialization & streaming",
    title: "stream — reject early, bad item 3 of 10k",
    description: "Progressive validation fails fast while the payload streams in.",
    command: "pnpm bench:stream",
    lowerIsBetter: true,
    entries: [
      { name: "jit stream", valueNs: 18_890, display: "18.89 µs", heap: "24.5 KB", highlight: true },
      { name: "JSON.parse + validate", valueNs: 1_960_000, display: "1.96 ms", heap: "921.8 KB" },
    ],
  },
  {
    id: "binary-count-1m",
    group: "Binary rowsets",
    title: "filtered count — 1M rows",
    description: "Byte-offset scan over columnar ArrayBuffer rows.",
    command: "pnpm bench:binary",
    lowerIsBetter: true,
    entries: [
      { name: "jit rowset (columnar)", valueNs: 1_090_000, display: "1.09 ms", heap: "96 B", highlight: true },
      { name: "jit query over JS array", valueNs: 4_240_000, display: "4.24 ms", heap: "96 B" },
    ],
  },
  {
    id: "binary-sum-1m",
    group: "Binary rowsets",
    title: "filtered sum — 1M rows",
    description: "Aggregation with columnBase + i hot loops.",
    command: "pnpm bench:binary",
    lowerIsBetter: true,
    entries: [
      { name: "jit rowset (columnar)", valueNs: 1_260_000, display: "1.26 ms", heap: "96 B", highlight: true },
      { name: "jit query over JS array", valueNs: 4_450_000, display: "4.45 ms", heap: "96 B" },
    ],
  },
  {
    id: "binary-adaptive-1m",
    group: "Binary rowsets",
    title: "adaptive load+query — 1M dynamic rows",
    description: "Unknown input → validated rowset → byte-offset query.",
    command: "pnpm bench:binary",
    lowerIsBetter: true,
    landing: true,
    entries: [
      { name: "jit rowset (adaptive)", valueNs: 52_670_000, display: "52.67 ms", heap: "28.26 MB", highlight: true },
      { name: "Zod 4 parse + native filter", valueNs: 454_890_000, display: "454.89 ms", heap: "110.31 MB" },
    ],
  },
  {
    id: "flows-pipeline",
    group: "End-to-end flows",
    title: "validate + query + JSON — 50k objects",
    description: "Validate 50k unknown objects, filter/project admins, serialize the result.",
    command: "pnpm bench:flows",
    lowerIsBetter: true,
    note: "A handwritten fused loop measured 2.02 ms / 0.69 MB — not comparable, listed as the physical floor.",
    entries: [
      { name: "jit validate + query + JSON", valueNs: 8_890_000, display: "8.89 ms", heap: "5.42 MB", highlight: true },
      { name: "Zod safeParse + filter/map/stringify", valueNs: 22_530_000, display: "22.53 ms", heap: "8.58 MB" },
    ],
  },
];

export const landingBenchmarkSuites = benchmarkSuites.filter((suite) => suite.landing);

export const benchmarkGroups = [...new Set(benchmarkSuites.map((suite) => suite.group))];

export function getSuite(id: string) {
  return benchmarkSuites.find((suite) => suite.id === id);
}

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
    value: "4.4x",
    label: "faster issue collection than typia",
    detail: "100k users, invalid tail · 6.37 ms vs 27.76 ms",
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
