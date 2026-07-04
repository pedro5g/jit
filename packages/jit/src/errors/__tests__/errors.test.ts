import { Errors } from "../../index.js";

describe("JITError", () => {
  it("is an Error subclass with a stable name", () => {
    const error = new Errors.JITError("INVALID_QUERY", "bad query");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(Errors.JITError);
    expect(error.name).toBe("JITError");
    expect(error.message).toBe("bad query");
  });

  it("carries the machine-readable code", () => {
    const codes = ["INVALID_QUERY", "INVALID_UPDATE", "READONLY_FIELD", "REFINE_FAILED"] as const;

    for (const code of codes) {
      expect(new Errors.JITError(code, "msg").code).toBe(code);
    }

    expectTypeOf<Errors.JITErrorCode>().toEqualTypeOf<
      "INVALID_QUERY" | "INVALID_UPDATE" | "READONLY_FIELD" | "REFINE_FAILED"
    >();
  });

  it("defaults path and meta to undefined when options are omitted", () => {
    const error = new Errors.JITError("REFINE_FAILED", "predicate rejected");

    expect(error.path).toBeUndefined();
    expect(error.meta).toBeUndefined();
  });

  it("stores path and meta from options", () => {
    const error = new Errors.JITError("READONLY_FIELD", "cannot write", {
      path: ["profile", "id"],
      meta: { field: "id" },
    });

    expect(error.path).toEqual(["profile", "id"]);
    expect(error.meta).toEqual({ field: "id" });
  });

  it("rejects unknown codes at the type level", () => {
    const assertInvalidCode = () => {
      // @ts-expect-error "UNKNOWN" is not a JITErrorCode
      new Errors.JITError("UNKNOWN", "msg");
    };

    expect(assertInvalidCode).toBeTypeOf("function");
  });
});
