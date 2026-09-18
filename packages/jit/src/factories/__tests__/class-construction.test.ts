import { JIT } from "../../index.js";

describe("JIT Runtime Class construction configuration", () => {
  it("rejects invalid and repeated construction-boundary declarations", () => {
    const FactoryConfigured = JIT.class(JIT.object({ value: JIT.string() })).factories({ create: "make" });
    const InvalidMode = JIT.class(JIT.object({ value: JIT.string() }));
    const Validated = (
      JIT.class(JIT.object({ value: JIT.string() })) as unknown as {
        validate(): unknown;
      }
    ).validate();

    expect(() =>
      (FactoryConfigured as unknown as { construction(mode: string): unknown }).construction("factory")
    ).toThrow(/Factories already fixed/i);
    expect(() => (InvalidMode as unknown as { construction(mode: string): unknown }).construction("invalid")).toThrow(
      /must be constructor or factory/i
    );
    expect(() => (Validated as unknown as { construction(mode: string): unknown }).construction("factory")).toThrow(
      /before validation/i
    );
  });
});
