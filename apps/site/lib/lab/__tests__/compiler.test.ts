import { describe, expect, it } from "vitest";
import { compileBindings, JIT } from "../generated/jit_compiler.js";

describe("Lab browser AOT compiler", () => {
  it("emits a named type and optimized standalone validator from arbitrary bindings", () => {
    const User = JIT.object({
      id: JIT.number().int32(),
      name: JIT.string().min(2),
      role: JIT.union(JIT.literal("admin"), JIT.literal("member")),
    });
    const isUser = JIT.validate(User).is().compile();
    const result = compileBindings({ User, isUser }, { format: "typescript", fileName: "user.generated" });
    const file = result.files[0];

    expect(result.skipped).toEqual([]);
    expect(file?.path).toBe("user.generated.ts");
    expect(file?.source).toContain('export type User = { id: number; name: string; role: "admin" | "member" };');
    expect(file?.source).toContain("const isUser: (value: unknown) => value is User =");
    expect(file?.source).toContain("Number.isInteger");
    expect(file?.source).not.toContain("@jit-compiler/jit");
  });

  it("honors JavaScript-only output without declaration files", () => {
    const Flag = JIT.object({ enabled: JIT.boolean() });
    const isFlag = JIT.validate(Flag).is().compile();
    const result = compileBindings({ Flag, isFlag }, { format: "javascript-only", fileName: "flag" });

    expect(result.files.map((file) => file.path)).toEqual(["flag.js"]);
  });
});
