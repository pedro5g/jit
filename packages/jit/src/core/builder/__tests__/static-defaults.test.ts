import { JIT } from "../../../index.js";

/**
 * `.default()` is checked against the chain that precedes it, at compile
 * time. The comparison is digit-wise, so a realistic bound like `.max(65535)`
 * costs the same as `.max(5)` — counting to the value used to exhaust the
 * type checker.
 */
describe("static default contracts", () => {
  it("should accept a default that satisfies large numeric bounds", () => {
    const Port = JIT.number().int().min(1).max(65535).default(8080);
    const Timeout = JIT.number().min(0).max(600000).default(30000);
    const Offset = JIT.number().min(-1000).max(1000).default(-250);

    expect(JIT.validate.parse(Port)(undefined)).toBe(8080);
    expect(JIT.validate.parse(Timeout)(undefined)).toBe(30000);
    expect(JIT.validate.parse(Offset)(undefined)).toBe(-250);
  });

  it("should reject a default the chain already forbids", () => {
    // @ts-expect-error 0 is below the declared minimum
    JIT.number().min(1).max(65535).default(0);
    // @ts-expect-error 70000 is above the declared maximum
    JIT.number().min(1).max(65535).default(70000);
    // @ts-expect-error 1.5 is not an integer
    JIT.number().int().default(1.5);
    // @ts-expect-error the exclusive bound excludes its own value
    JIT.number().moreThan(10).default(10);
    // @ts-expect-error -1 is below a negative minimum
    JIT.number().min(-10).default(-11);

    expect(true).toBe(true);
  });

  it("should accept the boundary values themselves", () => {
    const Low = JIT.number().min(1).max(65535).default(1);
    const High = JIT.number().min(1).max(65535).default(65535);

    expect(JIT.validate.parse(Low)(undefined)).toBe(1);
    expect(JIT.validate.parse(High)(undefined)).toBe(65535);
  });

  it("should keep enforcing string and literal contracts", () => {
    const Name = JIT.string().min(2).max(10).default("guest");

    expect(JIT.validate.parse(Name)(undefined)).toBe("guest");

    // @ts-expect-error shorter than the declared minimum length
    JIT.string().min(2).default("a");
    const Choice = JIT.string().oneOf(["a", "b"] as const);

    // @ts-expect-error not a member of the declared union
    Choice.default("c");
  });

  it("should not reject a default it cannot decide statically", () => {
    // A non-literal bound is undecidable at the type level; it must not
    // reject a value the runtime would accept.
    const bound: number = 10;
    const Loose = JIT.number().min(bound).default(5);

    expect(JIT.validate.parse(Loose)(undefined)).toBe(5);
  });

  it("should stay usable through wrappers that preserve the inner contract", () => {
    const Retries = JIT.number().int().min(0).max(9999).optional().default(3);

    expect(JIT.validate.parse(Retries)(undefined)).toBe(3);
  });
});
