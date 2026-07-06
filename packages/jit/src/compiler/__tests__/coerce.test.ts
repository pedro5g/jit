import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("should survive aot generation, unlike callback coercions", () => {
    const outDir = mkdtempSync(join(tmpdir(), "jit-coerce-aot-"));

    try {
      const Native = JIT.object({ page: JIT.coerce.number().int() });
      const Callback = JIT.object({ page: JIT.coerce(JIT.number(), (value) => Number(value)) });

      const result = AOT.generate({ schemas: { Native, Callback }, outDir });
      const source = readFileSync(join(outDir, "index.mjs"), "utf8");

      expect(source).toContain("const Native_safeParse");
      expect(result.skipped.map((skip) => `${skip.schema}.${skip.operation}`)).toContain("Callback.validator");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
