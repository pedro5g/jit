import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Compiler, JIT } from "@jit-compiler/jit";
import { resolveChangeLayout } from "../../packages/jit/src/compiler/change-layout.js";
import { emitDerivedMemoSource, resolveDerivedDescriptor } from "../../packages/jit/src/compiler/derive.js";
import { measureSource, type SourceMetrics } from "./source-metrics.js";

interface CodegenEntry {
  readonly operation: string;
  readonly category: string;
  readonly status: "measured" | "runtime-bench" | "shared-lowering";
  readonly note: string;
  readonly source?: SourceMetrics;
}

interface CodegenReport {
  readonly schema: "codegen-audit";
  readonly capturedAt: string;
  readonly environment: {
    readonly node: string;
    readonly v8: string;
    readonly platform: string;
    readonly arch: string;
    readonly cpu: string;
    readonly cpuCount: number;
  };
  readonly entries: readonly CodegenEntry[];
}

const resultPath = fileURLToPath(new URL("../results/internal/codegen.latest.json", import.meta.url));

const Profile = JIT.object({ city: JIT.string(), postalCode: JIT.string() });
const User = JIT.object({
  id: JIT.number().int(),
  name: JIT.string(),
  age: JIT.number(),
  active: JIT.boolean(),
  profile: Profile,
});
const Users = JIT.array(User);
const Customer = JIT.object({ id: JIT.number().int(), name: JIT.string() });
const CustomerRows = JIT.array(Customer);
const UserDto = JIT.object({ id: JIT.number().int(), name: JIT.string() });
const FlatUser = JIT.object({ id: JIT.number().int(), name: JIT.string(), age: JIT.number(), active: JIT.boolean() });
const PiiUser = JIT.object({ id: JIT.number(), email: JIT.string().pii() });
const FormattedString = JIT.string().format("(##) #####-####");

const queryProgram: Compiler.QueryProgram = {
  nodes: [
    {
      kind: "filter",
      condition: {
        kind: "compare",
        op: "gt",
        left: { kind: "field", key: "age" },
        right: { kind: "binding", name: "__q0" },
      },
    },
    { kind: "select:fields", fields: ["id", "name"] },
  ],
  bindings: [18],
};

const ordering = Compiler.resolveOrderingDescriptor(Users.schema, [{ key: "age", direction: "desc" }]);
const index = Compiler.resolveIndexDescriptor(Users.schema, ["id"], "unique");
const lookup = Compiler.resolveLookupDescriptor(Users.schema, "id");
const reconcile = Compiler.resolveReconcileDescriptor(
  Users.schema,
  "id",
  { added: true, removed: true, changed: true, unchanged: false },
  "diff",
  "result"
);
const distinct = Compiler.resolveDistinctDescriptor(User.schema, { kind: "unique", key: "id" });
const join = Compiler.createJoinPlan(
  Users.schema,
  CustomerRows.schema,
  { nodes: [], bindings: [] },
  "inner",
  "id",
  "id"
);
const changeLayout = resolveChangeLayout(User.schema);
const derived = resolveDerivedDescriptor(User.schema, ["name", "profile.city"], changeLayout);
const projection = Compiler.buildProjectionTree(User.schema, ["id", "profile.city"], "internal codegen audit");
const csv = Compiler.resolveCsvDescriptor(FlatUser.schema, "stringify", "string");
const ndjson = Compiler.createNdjsonDescriptor(User.schema, "stringify");

const sourceByOperation: Readonly<Record<string, { category: string; source: string; note: string }>> = {
  equal: {
    category: "compare",
    source: Compiler.emitEqualSource(User.schema),
    note: "schema-specialized structural equality",
  },
  hash: {
    category: "compare",
    source: Compiler.emitHashSource(User.schema),
    note: "same structural fields used by equality",
  },
  clone: {
    category: "mutation",
    source: Compiler.emitCloneSource(User.schema),
    note: "direct object construction and typed loops",
  },
  diff: {
    category: "mutation",
    source: Compiler.emitDiffSource(User.schema),
    note: "schema paths only; changes allocated on demand",
  },
  update: {
    category: "mutation",
    source: Compiler.emitUpdateSource(User.schema),
    note: "immutable structural sharing without Proxy",
  },
  validate: {
    category: "boundary",
    source: Compiler.emitValidatorSource(User.schema, { ops: ["is"] }),
    note: "boolean fast path",
  },
  materialize: {
    category: "boundary",
    source: Compiler.emitValidatorSource(User.schema, { ops: ["parse"] }),
    note: "parse/materialization emitter used by class boundaries",
  },
  serialize: {
    category: "transport",
    source: Compiler.emitSerializeSource(User.schema),
    note: "static keys and leaf reads",
  },
  jsonPatch: {
    category: "mutation",
    source: Compiler.emitJsonPatchSource(User.schema),
    note: "schema-specialized RFC 7396 merge",
  },
  changed: {
    category: "state",
    source: Compiler.emitChangedSource(Compiler.resolveChangedDescriptor(User.schema, ["name", "profile.city"])),
    note: "shared ChangeLayout mask",
  },
  mask: { category: "security", source: Compiler.emitMaskSource(PiiUser.schema), note: "PII fields only" },
  format: {
    category: "format",
    source: Compiler.emitFormatSource(FormattedString.schema),
    note: "format checks emitted as direct operations",
  },
  codec: {
    category: "transport",
    source: Compiler.emitCodecSource(User.schema),
    note: "binary encode/decode with schema layout",
  },
  mapper: {
    category: "transform",
    source: Compiler.emitMapperSource(User.schema, UserDto.schema),
    note: "target whitelist and indexed many loop",
  },
  projection: {
    category: "transform",
    source: Compiler.emitProjectSource(projection),
    note: "static projection literal",
  },
  query: {
    category: "query",
    source: Compiler.emitQuerySource(Users.schema, queryProgram),
    note: "semantic query lowered to one loop",
  },
  sort: {
    category: "query",
    source: Compiler.emitSortSource(ordering),
    note: "ordering comparator from resolved scalar facts",
  },
  index: {
    category: "query",
    source: Compiler.emitIndexPlanSource(index, Compiler.indexCacheKey(index)),
    note: "shared index builder/cache",
  },
  lookup: {
    category: "query",
    source: Compiler.emitLookupSource(lookup),
    note: "access path chosen from collection facts",
  },
  reconcile: {
    category: "state",
    source: Compiler.emitReconcileSource(reconcile),
    note: "one index-backed pass per side",
  },
  distinct: { category: "query", source: Compiler.emitDistinctAcceptSource(distinct), note: "keyed Set path" },
  join: {
    category: "query",
    source: Compiler.emitJoinSource(join),
    note: "physical join strategy selected from facts",
  },
  derive: {
    category: "state",
    source: emitDerivedMemoSource(derived),
    note: "dependency mask before structural reads",
  },
  csv: { category: "transport", source: Compiler.emitCsvSource(csv), note: "schema-specialized row serialization" },
  ndjson: {
    category: "transport",
    source: Compiler.emitNdjsonSource(ndjson),
    note: "streaming newline-delimited transport",
  },
};

const runtimeCovered = new Set([
  "collection-state",
  "cqrs",
  "class",
  "ddd",
  "watchedList",
  "binary-rowset",
  "rules",
  "authorization",
  "json",
  "lazy-query",
  "stream",
]);

const entries: CodegenEntry[] = Object.entries(sourceByOperation).map(([operation, value]) => ({
  operation,
  category: value.category,
  status: "measured",
  note: value.note,
  source: measureSource(value.source),
}));

for (const operation of runtimeCovered) {
  entries.push({
    operation,
    category: operation === "authorization" || operation === "rules" ? "access" : operation,
    status: "runtime-bench",
    note: "covered by the corresponding public benchmark suite and runtime/AOT tests; no duplicate emitter is introduced here",
  });
}

const report: CodegenReport = {
  schema: "codegen-audit",
  capturedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model ?? process.config.variables.host_arch ?? "unknown",
    cpuCount: cpus().length,
  },
  entries,
};

mkdirSync(dirname(resultPath), { recursive: true });
writeFileSync(resultPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      resultPath: "bench/results/internal/codegen.latest.json",
      measured: entries.filter((entry) => entry.status === "measured").length,
      runtimeBench: entries.filter((entry) => entry.status === "runtime-bench").length,
    },
    null,
    2
  )
);
