import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Compiler, JIT } from "@jit-compiler/jit";
import { bench, do_not_optimize, group, run } from "mitata";
import { measureSource, type SourceMetrics } from "./source-metrics.js";

interface TimedMetric {
  readonly operation: string;
  readonly milliseconds: number;
}

interface BenchmarkMetric {
  readonly name: string;
  readonly avg: number;
  readonly p50: number;
  readonly p99: number;
  readonly allocations?: number;
}

interface RuntimeTypeReport {
  readonly schema: "runtime-type-fusion";
  readonly capturedAt: string;
  readonly environment: {
    readonly node: string;
    readonly v8: string;
    readonly platform: string;
    readonly arch: string;
    readonly cpu: string;
    readonly cpuCount: number;
  };
  readonly compile: readonly TimedMetric[];
  readonly coldStart: readonly TimedMetric[];
  readonly source: Readonly<Record<string, SourceMetrics>>;
  readonly benchmarks: readonly BenchmarkMetric[];
}

const resultPath = fileURLToPath(new URL("../results/internal/runtime-type-fusion.latest.json", import.meta.url));
const coldScript = fileURLToPath(new URL("./runtime-type-cold.ts", import.meta.url));

const StringValue = JIT.ddd.valueObject(JIT.string());
const NumberValue = JIT.ddd.valueObject(JIT.number());
const BooleanValue = JIT.ddd.valueObject(JIT.boolean());
const EnumValue = JIT.ddd.valueObject(JIT.enum(["draft", "published"] as const));
const ObjectValue = JIT.ddd.valueObject(JIT.object({ amount: JIT.number(), currency: JIT.string() }));
const NestedValue = JIT.ddd.valueObject(
  JIT.object({
    id: StringValue,
    money: ObjectValue,
    tags: JIT.array(StringValue),
  })
);
const Entity = JIT.ddd.entity(
  JIT.object({
    id: StringValue,
    name: JIT.string(),
    active: JIT.boolean(),
    status: JIT.enum(["draft", "published"] as const),
  }),
  { id: "id" }
);

const stringValue = StringValue.create("alpha");
const sameStringValue = StringValue.create("alpha");
const numberValue = NumberValue.create(42);
const sameNumberValue = NumberValue.create(42);
const booleanValue = BooleanValue.create(true);
const sameBooleanValue = BooleanValue.create(true);
const enumValue = EnumValue.create("draft");
const sameEnumValue = EnumValue.create("draft");
const objectValue = ObjectValue.create({ amount: 42, currency: "BRL" });
const sameObjectValue = ObjectValue.create({ amount: 42, currency: "BRL" });
const nestedValue = NestedValue.create({
  id: "nested",
  money: { amount: 42, currency: "BRL" },
  tags: ["a", "b", "c"],
});
const sameNestedValue = NestedValue.create({
  id: "nested",
  money: { amount: 42, currency: "BRL" },
  tags: ["a", "b", "c"],
});
const entity = Entity.create({ id: "entity", name: "Ada", active: true, status: "draft" });
const sameEntity = Entity.create({ id: "entity", name: "Ada", active: true, status: "draft" });

const equalString = JIT.compare.equal(JIT.string());
const equalNumber = JIT.compare.equal(JIT.number());
const equalBoolean = JIT.compare.equal(JIT.boolean());
const equalEnum = JIT.compare.equal(JIT.enum(["draft", "published"] as const));
const equalArray = JIT.compare.equal(JIT.array(JIT.string()));
const equalObjectArray = JIT.compare.equal(JIT.array(JIT.object({ id: JIT.number(), label: JIT.string() })));
const smallArray = ["a", "b", "c", "d"];
const mediumArray = Array.from({ length: 128 }, (_, index) => `item-${index}`);
const largeArray = Array.from({ length: 10_000 }, (_, index) => `item-${index}`);
const sameSmallArray = [...smallArray];
const sameMediumArray = [...mediumArray];
const sameLargeArray = [...largeArray];
const objectArray = Array.from({ length: 128 }, (_, id) => ({ id, label: `item-${id}` }));
const sameObjectArray = objectArray.map((item) => ({ ...item }));

const source = {
  scalarString: Compiler.emitEqualSource(JIT.string().schema),
  scalarNumber: Compiler.emitEqualSource(JIT.number().schema),
  scalarEnum: Compiler.emitEqualSource(JIT.enum(["draft", "published"] as const).schema),
  valueObject: Compiler.emitEqualSource(StringValue.schema),
  objectValue: Compiler.emitEqualSource(ObjectValue.schema),
  nestedValue: Compiler.emitEqualSource(NestedValue.schema),
  entity: Compiler.emitEqualSource(Entity.schema),
  array: Compiler.emitEqualSource(JIT.array(JIT.string()).schema),
  objectArray: Compiler.emitEqualSource(JIT.array(JIT.object({ id: JIT.number(), label: JIT.string() })).schema),
} as const;

function compileMetric(operation: string, action: () => unknown): TimedMetric {
  const started = performance.now();
  action();
  return { operation, milliseconds: Number((performance.now() - started).toFixed(4)) };
}

function register(name: string, action: () => unknown): void {
  bench(name, () => do_not_optimize(action()));
}

function registerBenchmarks(): void {
  group("Runtime Type scalar fusion", () => {
    register("value accessor / string", () => stringValue.value);
    register("public equals / string", () => stringValue.equals(sameStringValue));
    register("internal equal / string", () => equalString("alpha", "alpha"));
    register("public equals / number", () => numberValue.equals(sameNumberValue));
    register("internal equal / number", () => equalNumber(42, 42));
    register("public equals / boolean", () => booleanValue.equals(sameBooleanValue));
    register("internal equal / boolean", () => equalBoolean(true, true));
    register("public equals / enum string", () => enumValue.equals(sameEnumValue));
    register("internal equal / enum string", () => equalEnum("draft", "draft"));
    register("nominal mismatch / string", () => stringValue.equals({ value: "alpha" }));
  });

  group("Runtime Type object and array fusion", () => {
    register("public equals / object value", () => objectValue.equals(sameObjectValue));
    register("public equals / nested value", () => nestedValue.equals(sameNestedValue));
    register("public equals / entity", () => entity.equals(sameEntity));
    register("array loop / small", () => equalArray(smallArray, sameSmallArray));
    register("array loop / medium", () => equalArray(mediumArray, sameMediumArray));
    register("array loop / large", () => equalArray(largeArray, sameLargeArray));
    register("array loop / first mismatch", () => equalArray(["mismatch", ...mediumArray.slice(1)], mediumArray));
    register("array loop / last mismatch", () => equalArray(mediumArray, [...mediumArray.slice(0, -1), "mismatch"]));
    register("array object loop / medium", () => equalObjectArray(objectArray, sameObjectArray));
  });

  const polymorphic = [
    [stringValue, sameStringValue],
    [numberValue, sameNumberValue],
    [booleanValue, sameBooleanValue],
    [enumValue, sameEnumValue],
  ] as const;
  let polymorphicIndex = 0;
  register("public equals / polymorphic Runtime Types", () => {
    const pair = polymorphic[polymorphicIndex++ % polymorphic.length];
    return pair[0].equals(pair[1]);
  });
}

function readBenchmarks(result: Awaited<ReturnType<typeof run>>): readonly BenchmarkMetric[] {
  const metrics: BenchmarkMetric[] = [];
  for (const trial of result.benchmarks) {
    for (const run of trial.runs) {
      if (run.stats === undefined) continue;
      metrics.push({
        name: run.name,
        avg: run.stats.avg,
        p50: run.stats.p50,
        p99: run.stats.p99,
        ...(run.stats.heap === undefined ? {} : { allocations: run.stats.heap.avg }),
      });
    }
  }
  return metrics;
}

async function coldStartMetrics(): Promise<readonly TimedMetric[]> {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--conditions", "@jit/source", coldScript], {
    encoding: "utf8",
    env: { ...process.env, JIT_INTERNAL_COLD_RUN: "1" },
  });
  if (result.status !== 0) throw new Error(result.stderr || "cold Runtime Type probe failed");
  return JSON.parse(result.stdout.trim()) as readonly TimedMetric[];
}

registerBenchmarks();
const compile = [
  compileMetric("compile equal / scalar", () => Compiler.compileEqual(JIT.string().schema)),
  compileMetric("compile equal / Runtime Type value", () => Compiler.compileEqual(StringValue.schema)),
  compileMetric("compile equal / nested Runtime Type", () => Compiler.compileEqual(NestedValue.schema)),
  compileMetric("compile hash / nested Runtime Type", () => Compiler.compileHash(NestedValue.schema)),
];
const result = await run({ format: "quiet", colors: false, print: () => "" });
const report: RuntimeTypeReport = {
  schema: "runtime-type-fusion",
  capturedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model ?? process.config.variables.host_arch ?? "unknown",
    cpuCount: cpus().length,
  },
  compile,
  coldStart: await coldStartMetrics(),
  source: Object.fromEntries(Object.entries(source).map(([name, value]) => [name, measureSource(value)])),
  benchmarks: readBenchmarks(result),
};

mkdirSync(dirname(resultPath), { recursive: true });
writeFileSync(resultPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      resultPath: join("bench", "results", "internal", "runtime-type-fusion.latest.json"),
      compile,
      coldStart: report.coldStart,
    },
    null,
    2
  )
);
