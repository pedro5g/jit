import { describe, expect, expectTypeOf, it } from "vitest";
import { Compiler, JIT } from "../../index.js";

describe("string case plans", () => {
  it("keeps validation and transformation as separate operations", () => {
    const validate = JIT.validate.safeParse(JIT.string().camelCase());
    const transform = JIT.validate.parse(JIT.string().toCamelCase());

    expect(validate("userName")).toEqual({ success: true, data: "userName" });
    expect(validate("user_name")).toMatchObject({ success: false, issues: [{ code: "invalid_case" }] });
    expect(transform("user_name")).toBe("userName");
    expect(transform("User ID")).toBe("userId");
    expect(JIT.validate.parse(JIT.string().toUpperSnakeCase())("USER_ID")).toBe("USER_ID");
    expect(JIT.validate.parse(JIT.string().toKebabCase())("User ID")).toBe("user-id");
  });

  it("supports every documented canonical style", () => {
    const cases = [
      [JIT.string().lowercase(), "hello", "Hello"],
      [JIT.string().uppercase(), "HELLO", "Hello"],
      [JIT.string().camelCase(), "helloWorld", "hello_world"],
      [JIT.string().pascalCase(), "HelloWorld", "helloWorld"],
      [JIT.string().snakeCase(), "hello_world", "helloWorld"],
      [JIT.string().kebabCase(), "hello-world", "hello_world"],
      [JIT.string().upperSnakeCase(), "HELLO_WORLD", "hello_world"],
    ] as const;

    for (const [schema, valid, invalid] of cases) {
      const is = JIT.validate.is(schema as Parameters<typeof JIT.validate.is>[0]);
      expect(is(valid)).toBe(true);
      expect(is(invalid)).toBe(false);
    }
  });

  it("preserves string output typing for transforms", () => {
    const schema = JIT.string().toPascalCase();
    const parse = JIT.validate.parse(schema);

    expectTypeOf(parse).returns.toBeString();
    expectTypeOf<JIT.Typeof<typeof schema>>().toBeString();
  });

  it("does not put transform code in boolean validation", () => {
    const source = Compiler.emitValidatorSource(JIT.string().toCamelCase().schema, { ops: ["is"] });

    expect(source).not.toContain("__caseTransform");
    expect(JIT.validate.is(JIT.string().toCamelCase())("user_name")).toBe(true);
  });
});
