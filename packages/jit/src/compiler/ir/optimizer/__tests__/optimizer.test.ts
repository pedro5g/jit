import { JIT } from "../../../../index.js";
import { emitEqual } from "../../../emitter/emit-equal.js";
import { resolveEqualStrategy } from "../../../strategy/resolve-strategy.js";
import { buildEqualIR } from "../../builders/build-equal-ir.js";
import { optimizeIR } from "../optimize-ir.js";

describe("optimizeIR", () => {
  const User = JIT.object({
    id: JIT.number(),
    name: JIT.string(),
    profile: JIT.object({
      age: JIT.number(),
      email: JIT.string(),
    }),
  }).schema;

  function compileBoth(schema: typeof User) {
    const strategy = resolveEqualStrategy(schema);
    const raw = buildEqualIR(schema, strategy);
    const optimized = optimizeIR(raw);

    const build = (source: string) =>
      globalThis.Function("__hash", "__getIndex", `return ${source};`)(undefined, undefined) as (
        l: unknown,
        r: unknown
      ) => boolean;

    return {
      rawFn: build(emitEqual(raw)),
      optimizedFn: build(emitEqual(optimized)),
    };
  }

  it("preserves behavior of the unoptimized program", () => {
    const { rawFn, optimizedFn } = compileBoth(User);

    const base = { id: 1, name: "Ada", profile: { age: 37, email: "ada@example.com" } };
    const cases: [unknown, unknown][] = [
      [base, { ...base, profile: { ...base.profile } }],
      [base, base],
      [base, { ...base, id: 2 }],
      [base, { ...base, profile: { age: 37, email: "other@example.com" } }],
      [base, { ...base, name: "Grace" }],
    ];

    for (const [left, right] of cases) {
      expect(optimizedFn(left, right)).toBe(rawFn(left, right));
    }
  });

  it("is deterministic: same schema always emits the same source", () => {
    const strategy = resolveEqualStrategy(User);
    const first = emitEqual(optimizeIR(buildEqualIR(User, strategy)));
    const second = emitEqual(optimizeIR(buildEqualIR(User, strategy)));

    expect(first).toBe(second);
  });

  it("is idempotent: optimizing twice emits the same source as optimizing once", () => {
    const strategy = resolveEqualStrategy(User);
    const once = optimizeIR(buildEqualIR(User, strategy));
    const twice = optimizeIR(once);

    expect(emitEqual(twice)).toBe(emitEqual(once));
  });

  it("does not mutate the input program", () => {
    const strategy = resolveEqualStrategy(User);
    const raw = buildEqualIR(User, strategy);
    const snapshot = JSON.stringify(raw, (_key, value) => (typeof value === "bigint" ? `${value}n` : value));

    optimizeIR(raw);

    expect(JSON.stringify(raw, (_key, value) => (typeof value === "bigint" ? `${value}n` : value))).toBe(snapshot);
  });
});
