import { createPerformanceProfile } from "../../performance/profile.js";
import { portableProfile } from "../../target/portable-profile.js";
import type { StrategyCandidate, StrategyEstimate } from "../candidate.js";
import { createStrategyCatalog } from "../catalog.js";
import { createStrategyFamily } from "../family.js";

const cost: StrategyEstimate = Object.freeze({
  runtime: 1000,
  allocation: 0,
  setup: 0,
  codeSize: 1000,
  cold: 0,
  branches: 0,
});

function candidate(
  id: string,
  fields: Partial<Pick<StrategyCandidate, "optimized" | "evidence">> = {}
): StrategyCandidate {
  return Object.freeze({
    id,
    family: "test.family",
    optimized: fields.optimized ?? false,
    portability: "portable",
    evidence: Object.freeze(fields.evidence ?? []),
    legality: () => ({ supported: true, reason: "semantic preconditions hold" }),
    targetSupport: () => ({ supported: true, reason: "target supports the lowering" }),
    estimate: () => cost,
    lower: () => Object.freeze({ family: "test.family", strategy: id }),
  });
}

describe("strategy catalog", () => {
  it("records every candidate and uses a stable id to break exact ties", () => {
    const family = createStrategyFamily("test.family", [candidate("z-loop"), candidate("a-loop")]);
    const decision = createStrategyCatalog([family]).resolve(family, { family: family.id, facts: [] }, portableProfile);

    expect(decision.strategy).toBe("a-loop");
    expect(decision.considered).toEqual([
      expect.objectContaining({ strategy: "z-loop", status: "higher-cost" }),
      expect.objectContaining({ strategy: "a-loop", status: "selected" }),
    ]);
    expect(decision.estimated.runtime).toBe(1000);
  });

  it("does not select an optimized candidate whose evidence was not promoted", () => {
    const optimized = candidate("specialized", { optimized: true, evidence: ["PERF-TEST-001"] });
    const baseline = candidate("baseline");
    const family = createStrategyFamily("test.family", [optimized, baseline]);
    const catalog = createStrategyCatalog(
      [family],
      createPerformanceProfile({
        id: "test",
        version: "2",
        evidence: [],
      })
    );
    const decision = catalog.resolve(family, { family: family.id, facts: [] }, portableProfile);

    expect(decision.strategy).toBe("baseline");
    expect(decision.considered[0]).toMatchObject({
      strategy: "specialized",
      status: "insufficient-evidence",
    });
    expect(decision.performanceProfileVersion).toBe("test@2");
  });

  it("rejects floating-point estimates before they can affect selection", () => {
    const fractional = Object.freeze({ ...candidate("fractional"), estimate: () => ({ ...cost, runtime: 0.1 }) });
    expect(() => createStrategyFamily("test.family", [fractional])).not.toThrow();
    const family = createStrategyFamily("test.family", [fractional]);

    expect(() =>
      createStrategyCatalog([family]).resolve(family, { family: family.id, facts: [] }, portableProfile)
    ).toThrow("strategy estimate runtime must be a non-negative safe integer");
  });
});
