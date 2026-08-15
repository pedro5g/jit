import { JIT } from "../../index.js";

const User = JIT.object({ id: JIT.number().int().positive(), name: JIT.string().min(2) });

/** Accepts anything that implements the Standard Schema contract. */
function validateWith<TOutput>(schema: {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown
    ) =>
      | { readonly value: TOutput }
      | { readonly issues: readonly { readonly message: string }[] }
      | Promise<{ readonly value: TOutput } | { readonly issues: readonly { readonly message: string }[] }>;
  };
}) {
  return schema["~standard"].validate;
}

describe("Standard Schema interop", () => {
  it("should expose the contract on compiled validation artifacts", () => {
    for (const artifact of [JIT.validate.is(User), JIT.validate.parse(User), JIT.validate.safeParse(User)]) {
      expect(artifact["~standard"].version).toBe(1);
      expect(artifact["~standard"].vendor).toBe("jit");
      expect(typeof artifact["~standard"].validate).toBe("function");
    }
  });

  it("should report the parsed value and stable issues through the contract", () => {
    const validate = validateWith(JIT.validate.parse(User));
    const accepted = validate({ id: 1, name: "Ada" });
    const rejected = validate({ id: -1, name: "A" });

    expect(accepted).toEqual({ value: { id: 1, name: "Ada" } });
    expect("issues" in rejected && rejected.issues.length).toBeGreaterThan(0);
  });

  it("should share one adapter between a schema and every artifact built from it", () => {
    // Consumers may cache by identity, and a builder and its compiled
    // artifacts describe the very same contract.
    expect(JIT.validate.is(User)["~standard"]).toBe(User["~standard"]);
    expect(JIT.validate.safeParse(User)["~standard"]).toBe(User["~standard"]);
  });

  it("should validate synchronously for a synchronous schema", () => {
    const result = validateWith(JIT.validate.parse(User))({ id: 1, name: "Ada" });

    expect(result).not.toBeInstanceOf(Promise);
  });

  it("should keep the artifact callable while carrying the contract", () => {
    const isUser = JIT.validate.is(User);

    expect(isUser({ id: 1, name: "Ada" })).toBe(true);
    expect(isUser({ id: 0, name: "Ada" })).toBe(false);
    expect(Object.keys(isUser)).not.toContain("~standard");
  });
});
