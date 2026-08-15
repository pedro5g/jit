import { describe, expect, it } from "vitest";
import { compileBindings, JIT } from "../generated/jit_compiler.js";

describe("Lab browser AOT compiler", () => {
  it("emits a named type and optimized standalone validator from arbitrary bindings", () => {
    const User = JIT.object({
      id: JIT.number().int32(),
      name: JIT.string().min(2),
      role: JIT.union(JIT.literal("admin"), JIT.literal("member")),
    });
    const isUser = JIT.validate.is(User);
    const result = compileBindings({ User, isUser }, { format: "ts", fileName: "user.generated" });
    const file = result.files[0];

    expect(result.skipped).toEqual([]);
    expect(file?.path).toBe("user.generated.ts");
    expect(file?.source).toContain('export type User = { id: number; name: string; role: "admin" | "member" };');
    expect(file?.source).toContain("const isUser: (value: unknown) => value is User =");
    expect(file?.source).toContain("(v3 | 0) !== v3");
    expect(file?.source).not.toContain("@jit-compiler/jit");
  });

  it("emits one ready-to-run JavaScript file without declaration files", () => {
    const Flag = JIT.object({ enabled: JIT.boolean() });
    const isFlag = JIT.validate.is(Flag);
    const result = compileBindings({ Flag, isFlag }, { format: "js", fileName: "flag" });

    expect(result.files.map((file) => file.path)).toEqual(["flag.js"]);
  });

  it("embeds serializable callbacks without falling back to the JIT runtime", () => {
    const Profile = JIT.object({
      name: JIT.string().default(() => "'"),
    })
      .transform({ name: (value) => String(value).trim() })
      .refine((value) => value.name !== "blocked");
    const parseProfile = JIT.validate.parse(Profile);
    const result = compileBindings({ Profile, parseProfile }, { format: "ts", fileName: "profile" });
    const source = result.files[0]?.source;

    expect(result.skipped).toEqual([]);
    expect(source).toContain(`(() => "'")`);
    expect(source).toContain("((value) => String(value).trim())");
    expect(source).toContain('((value) => value.name !== "blocked")');
    expect(source).not.toContain("@jit-compiler/jit");
  });
});
