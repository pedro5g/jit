import { resolveArrayValidationStrategy } from "../packages/jit/src/compiler/strategy/families/array-validation.js";
import { resolveEnumMembershipStrategy } from "../packages/jit/src/compiler/strategy/families/enum-membership.js";
import { resolveMembershipStrategy } from "../packages/jit/src/compiler/strategy/families/membership.js";
import { resolveTargetProfile } from "../packages/jit/src/compiler/target/resolve-target.js";
import { JIT } from "../packages/jit/src/index.js";

const targets = ["portable-1", "node-22", "node-24", "node-26"] as const;
const lengths = [1, 2, 4, 5, 8, 10, 16, 32];
const lines = [
  "Deterministic strategy selection from checked-in target profiles.",
  "These are policy decisions, not measurements from the process printing this report.",
  "",
  "ARRAY_FIXED_VALIDATION · string · success/predicate",
  "| Length | Portable | Node 22 | Node 24 | Node 26 |",
  "| ---: | --- | --- | --- | --- |",
];

for (const length of lengths) {
  const schema = JIT.array(JIT.string()).length(length).schema;
  const decisions = targets.map(
    (profile) =>
      resolveArrayValidationStrategy(schema, resolveTargetProfile({ profile }), "predicate")?.strategy ?? "scan"
  );
  lines.push(`| ${length} | ${decisions.join(" | ")} |`);
}

lines.push(
  "",
  "ENUM_MEMBERSHIP · representative cardinality",
  "| Cardinality | Portable | Node 22 | Node 24 | Node 26 |",
  "| ---: | --- | --- | --- | --- |"
);
for (const cardinality of [2, 4, 6, 8, 16, 32]) {
  const schema = JIT.enum(Array.from({ length: cardinality }, (_, index) => index) as [number, ...number[]]).schema;
  const decisions = targets.map(
    (profile) => resolveEnumMembershipStrategy(schema, resolveTargetProfile({ profile }))?.strategy ?? "direct-chain"
  );
  lines.push(`| ${cardinality} | ${decisions.join(" | ")} |`);
}

lines.push(
  "",
  "MEMBERSHIP_LOOKUP · same-value-zero, primitive values",
  "| Rows / lookups | One lookup | Repeated lookup |",
  "| ---: | --- | --- |"
);
for (const cardinality of [4, 16, 64, 256]) {
  const one = resolveMembershipStrategy(
    { cardinality, lookupCount: 1, equality: "same-value-zero" },
    resolveTargetProfile({ profile: "portable-1" })
  );
  const repeated = resolveMembershipStrategy(
    { cardinality, lookupCount: 16, reuse: "repeated", equality: "same-value-zero" },
    resolveTargetProfile({ profile: "portable-1" })
  );
  lines.push(`| ${cardinality} / 1 or 16 | ${one.strategy} | ${repeated.strategy} |`);
}

console.log(lines.join("\n"));
