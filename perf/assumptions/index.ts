import type { PerformanceAssumption } from "../../packages/jit/src/compiler/performance/evidence.js";

/** Assumptions currently consumed by implemented physical candidates. */
export const assumptions: readonly PerformanceAssumption[] = Object.freeze([
  Object.freeze({
    id: "PERF-ARRAY-001",
    hypothesis: "Small fixed-cardinality primitive arrays can benefit from source unrolling.",
    candidates: Object.freeze(["array.validate.indexed-loop", "array.validate.unrolled"]),
    dimensions: Object.freeze(["runtime", "branches", "setup", "codeSize", "cold"]),
    usedBy: Object.freeze(["array.validate"]),
  }),
  Object.freeze({
    id: "PERF-ENUM-001",
    hypothesis: "A direct comparison chain remains competitive for small enum membership checks.",
    candidates: Object.freeze(["enum.direct-chain", "enum.lookup-object"]),
    dimensions: Object.freeze(["runtime", "codeSize", "cold"]),
    usedBy: Object.freeze(["enum.membership"]),
  }),
  Object.freeze({
    id: "PERF-ENUM-002",
    hypothesis: "A lookup representation can amortize membership work for larger enums.",
    candidates: Object.freeze(["enum.direct-chain", "enum.lookup-object"]),
    dimensions: Object.freeze(["runtime", "setup", "allocation", "codeSize", "reuse"]),
    usedBy: Object.freeze(["enum.membership"]),
  }),
  Object.freeze({
    id: "PERF-ENUM-003",
    hypothesis: "A numeric switch can avoid repeated comparisons for medium-sized enums without setup allocation.",
    candidates: Object.freeze(["enum.direct-chain", "enum.switch", "enum.lookup-object"]),
    dimensions: Object.freeze(["runtime", "codeSize", "cold"]),
    usedBy: Object.freeze(["enum.membership"]),
  }),
  Object.freeze({
    id: "PERF-MEMBER-001",
    hypothesis: "A direct scan or native strict-equality lookup wins when setup cannot be amortized.",
    candidates: Object.freeze(["nested-scan", "indexOf"]),
    dimensions: Object.freeze(["runtime", "setup", "codeSize", "reuse"]),
    usedBy: Object.freeze(["membership.lookup"]),
  }),
  Object.freeze({
    id: "PERF-MEMBER-002",
    hypothesis: "A reusable Set or existing index amortizes membership setup across repeated lookups.",
    candidates: Object.freeze(["set-lookup", "existing-index"]),
    dimensions: Object.freeze(["runtime", "allocation", "setup", "reuse"]),
    usedBy: Object.freeze(["membership.lookup"]),
  }),
]);
