import { JIT } from "../../index.js";
import { JITValidationError } from "../index.js";

describe("error presentation", () => {
  const User = JIT.object({
    name: JIT.string().min(3),
    profile: JIT.object({ email: JIT.string().email() }),
  });

  function error(): JITValidationError {
    try {
      JIT.validate.parse(User)({ name: "A", profile: { email: "broken" } });
      throw new Error("expected validation to fail");
    } catch (value) {
      if (value instanceof JITValidationError) return value;
      throw value;
    }
  }

  it("formats stable issues with a locale without changing their identity", () => {
    const current = error();
    const AppJIT = JIT.create({ locale: JIT.locales.ptBR });
    const formatted = AppJIT.error.format(current);

    expect(formatted).toHaveLength(2);
    expect(formatted[0]).toMatchObject({ code: "too_small", path: ["name"] });
    expect(formatted[0]?.message).toContain("mínimo");
    expect(current.issues[0]).toMatchObject({ code: "too_small", path: ["name"], params: { minimum: 3 } });
  });

  it("produces form and tree projections without exposing rejected values", () => {
    const current = error();
    const flattened = JIT.error.flatten(current);
    const tree = JIT.error.tree(current);

    expect(flattened.formErrors).toEqual([]);
    expect(flattened.fieldErrors.name).toHaveLength(1);
    expect(flattened.fieldErrors.profile).toHaveLength(1);
    expect(tree.properties?.profile?.properties?.email?.errors).toHaveLength(1);
    expect(JSON.stringify(current)).not.toContain("broken");
  });

  it("accepts an application formatter and keeps pretty output opt-in", () => {
    const current = error();
    const formatted = JIT.error.format(current, {
      issue: (issue) => `${issue.code}:${issue.path.join(".")}`,
    });

    expect(formatted[0]?.message).toBe("too_small:name");
    expect(JIT.error.pretty(current)).toContain("name");
  });

  it("formats structural issue descriptors without depending on a message", () => {
    const formatted = JIT.error.format({
      issues: [{ code: "expected_string", path: ["name"], params: {} }],
    });

    expect(formatted).toEqual([{ code: "expected_string", path: ["name"], params: {}, message: "expected string" }]);
  });
});
