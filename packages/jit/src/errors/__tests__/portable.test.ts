import { describe, expect, it } from "vitest";
import { Errors } from "../../index.js";

describe("portable artifact errors", () => {
  it("keeps validation errors structural and value-free", () => {
    const error = new Errors.ValidationError([
      { path: ["user", "name"], code: "invalid_case", expected: "camel", message: "expected camel case" },
    ]);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ValidationError");
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.path).toEqual(["user", "name"]);
    expect(error.issues[0]).not.toHaveProperty("received");
  });

  it("keeps domain and access failures independent from JITError", () => {
    const assertion = new Errors.PortableDomainAssertionError("invariant failed", { rule: "active" });
    const denied = new Errors.PortableAccessDeniedError("update", "id", "readonly");

    expect(assertion.name).toBe("DomainAssertionError");
    expect(assertion.code).toBe("ASSERTION_FAILED");
    expect(assertion.rule).toBe("active");
    expect(denied.name).toBe("AccessDeniedError");
    expect(denied.code).toBe("ACCESS_DENIED");
  });
});
