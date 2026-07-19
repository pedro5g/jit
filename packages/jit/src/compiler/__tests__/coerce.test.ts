import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AOT, Compiler, JIT } from "../../index.js";

describe("JIT.coerce zod-style native coercions", () => {
  it("should coerce query-string style input on parse", () => {
    const Query = JIT.object({
      page: JIT.coerce.number().int().positive(),
      limit: JIT.coerce.number().max(100),
      active: JIT.coerce.boolean(),
      since: JIT.coerce.date(),
      tag: JIT.coerce.string(),
    });
    const validate = JIT.validator(Query);
    const result = validate.safeParse({
      page: "3",
      limit: "50",
      active: 1,
      since: "2026-07-05T00:00:00.000Z",
      tag: 42,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(50);
      expect(result.data.active).toBe(true);
      expect(result.data.since).toBeInstanceOf(Date);
      expect(result.data.tag).toBe("42");
    }
  });

  it("should fail validation after coercion like zod", () => {
    const Page = JIT.object({ page: JIT.coerce.number().int().positive() });
    const validate = JIT.validator(Page);

    // "abc" → NaN → integer check fails; no throw.
    const bad = validate.safeParse({ page: "abc" });

    expect(bad.success).toBe(false);

    const invalidDate = JIT.validator(JIT.object({ at: JIT.coerce.date() })).safeParse({ at: "not a date" });

    expect(invalidDate.success).toBe(false);
  });

  it("should keep safeParse total for bigint coercion", () => {
    const Big = JIT.object({ n: JIT.coerce.bigint() });
    const validate = JIT.validator(Big);

    expect(validate.safeParse({ n: "12" })).toEqual({ success: true, data: { n: 12n } });
    // BigInt("x") throws in zod; here it degrades to a type issue.
    expect(validate.safeParse({ n: "x" }).success).toBe(false);
  });

  it("should keep the custom-callback coerce form working", () => {
    const Upper = JIT.coerce(JIT.string(), (value) => String(value).toUpperCase());
    const result = JIT.validator(JIT.object({ code: Upper })).safeParse({ code: "abc" });

    expect(result).toEqual({ success: true, data: { code: "ABC" } });
  });

  it("should emit native coercions inline with zero bindings", () => {
    const Query = JIT.object({ page: JIT.coerce.number() });
    const source = Compiler.emitValidatorSource(Query.schema);

    expect(source).toContain("Number(");
    expect(source).not.toContain("__v0(");
  });

  it("should preserve native and callback coercions through aot generation", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "jit-coerce-aot-"));

    try {
      const Native = JIT.object({ page: JIT.coerce.number().int() });
      const Callback = JIT.object({ page: JIT.coerce(JIT.number(), (value) => Number(value)) });
      const nativeSelected = JIT.validator(Native).get("safeParse");
      const callbackSelected = JIT.validator(Callback).get("safeParse");

      const result = AOT.generate({
        schemas: {},
        functions: {
          Native_safeParse: nativeSelected.safeParse,
          Callback_safeParse: callbackSelected.safeParse,
        },
        outDir,
      });
      const source = readFileSync(join(outDir, "index.js"), "utf8");
      const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
        Native_safeParse: (value: unknown) => { success: boolean; data?: { page: number } };
        Callback_safeParse: (value: unknown) => { success: boolean; data?: { page: number } };
      };

      expect(source).toContain("const Native_safeParse");
      expect(source).toContain("const Callback_safeParse");
      expect(source).toContain("((value) => Number(value))");
      expect(result.skipped).toEqual([]);
      expect(generated.Native_safeParse({ page: "2" })).toMatchObject({ success: true, data: { page: 2 } });
      expect(generated.Callback_safeParse({ page: "3" })).toMatchObject({ success: true, data: { page: 3 } });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
