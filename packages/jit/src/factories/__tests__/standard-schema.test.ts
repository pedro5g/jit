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
  it("should expose the contract only on parser artifacts", () => {
    const parse = JIT.validate.parse(User);

    expect(parse["~standard"].version).toBe(1);
    expect(parse["~standard"].vendor).toBe("jit");
    expect(typeof parse["~standard"].validate).toBe("function");
    expect("~standard" in JIT.validate.is(User)).toBe(false);
    expect("~standard" in JIT.validate.safeParse(User)).toBe(false);
  });

  it("should report the parsed value and stable issues through the contract", () => {
    const validate = validateWith(JIT.validate.parse(User));
    const accepted = validate({ id: 1, name: "Ada" });
    const rejected = validate({ id: -1, name: "A" });

    expect(accepted).toEqual({ value: { id: 1, name: "Ada" } });
    expect("issues" in rejected && rejected.issues.length).toBeGreaterThan(0);
  });

  it("should share one adapter between a schema and its parser", () => {
    // Consumers may cache by identity, and a builder and its compiled
    // artifacts describe the very same contract.
    expect(JIT.validate.parse(User)["~standard"]).toBe(User["~standard"]);
  });

  it("should validate synchronously for a synchronous schema", () => {
    const result = validateWith(JIT.validate.parse(User))({ id: 1, name: "Ada" });

    expect(result).not.toBeInstanceOf(Promise);
  });

  it("should carry the contract on a pipeline that ends in validation", () => {
    const fromJson = JIT.json.parse(User).validate();
    const validate = validateWith(fromJson);

    expect(fromJson["~standard"].vendor).toBe("jit");
    expect(validate('{"id":1,"name":"Ada"}')).toEqual({ value: { id: 1, name: "Ada" } });

    const rejected = validate('{"id":-1,"name":"A"}');

    expect("issues" in rejected && rejected.issues.length).toBeGreaterThan(0);
  });

  it("should let a real error through instead of reporting it as an issue", () => {
    // Malformed JSON is not a validation failure; it must stay an exception.
    expect(() => validateWith(JIT.json.parse(User).validate())("{oops")).toThrow(SyntaxError);
  });

  it("should keep the artifact callable while carrying the contract", () => {
    const isUser = JIT.validate.is(User);

    expect(isUser({ id: 1, name: "Ada" })).toBe(true);
    expect(isUser({ id: 0, name: "Ada" })).toBe(false);
    expect(Object.keys(isUser)).not.toContain("~standard");
  });
});
