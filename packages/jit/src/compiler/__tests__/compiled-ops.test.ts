import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AOT, Compiler, JIT } from "../../index.js";

describe("compiled value operations", () => {
  it("should inline a chain as source instead of calling a closure", () => {
    const Handle = JIT.string().pipe(JIT.ops.trim().lowercase());
    const source = Compiler.emitValidatorSource(Handle.schema, { ops: ["parse"] });

    expect(source).toContain(".trim().toLowerCase()");
    // No bound callback stands between the value and the transform.
    expect(source).not.toMatch(/= __v\d+\(o\d+\)/);
  });

  it("should still accept a callback and keep calling it", () => {
    const Handle = JIT.string().pipe((value) => value.toUpperCase());
    const source = Compiler.emitValidatorSource(Handle.schema, { ops: ["parse"] });

    expect(source).toMatch(/= __v\d+\(o\d+\)/);
    expect(JIT.validate.parse(Handle)(" ada ")).toBe(" ADA ");
  });

  it("should produce the same result as the equivalent callback", () => {
    const declarative = JIT.validate.parse(JIT.string().pipe(JIT.ops.trim().lowercase().slice(0, 6)));
    const callback = JIT.validate.parse(JIT.string().pipe((value) => value.trim().toLowerCase().slice(0, 6)));

    for (const input of ["  Ada Lovelace ", "GRACE", "  ", "x"]) {
      expect(declarative(input)).toBe(callback(input));
    }
  });

  it("should run after validation, on the validated value", () => {
    const Handle = JIT.string().min(3).pipe(JIT.ops.trim().lowercase());
    const parse = JIT.validate.parse(Handle);

    expect(parse("  ADA  ")).toBe("ada");
    // The length check sees the input, not the transformed output.
    expect(() => parse("a")).toThrow();
  });

  it("should transform strings through the documented vocabulary", () => {
    const cases: readonly [ReturnType<typeof JIT.string>["schema"] extends never ? never : unknown, string, string][] =
      [
        [JIT.string().pipe(JIT.ops.uppercase()), "ada", "ADA"],
        [JIT.string().pipe(JIT.ops.padStart(5, "0")), "42", "00042"],
        [JIT.string().pipe(JIT.ops.padEnd(4, ".")), "ab", "ab.."],
        [JIT.string().pipe(JIT.ops.replace("-", "_")), "a-b", "a_b"],
        [JIT.string().pipe(JIT.ops.replace(/[aeiou]/g, "*")), "banana", "b*n*n*"],
        [JIT.string().pipe(JIT.ops.collapseWhitespace()), "a   b \n c", "a b c"],
        [JIT.string().pipe(JIT.ops.normalize("NFC")), "é", "é"],
      ] as never;

    for (const [schema, input, expected] of cases) {
      expect(JIT.validate.parse(schema as never)(input)).toBe(expected);
    }
  });

  it("should transform numbers through the documented vocabulary", () => {
    expect(JIT.validate.parse(JIT.number().pipe(JIT.ops.round()))(1.6)).toBe(2);
    expect(JIT.validate.parse(JIT.number().pipe(JIT.ops.floor()))(1.6)).toBe(1);
    expect(JIT.validate.parse(JIT.number().pipe(JIT.ops.ceil()))(1.2)).toBe(2);
    expect(JIT.validate.parse(JIT.number().pipe(JIT.ops.abs()))(-3)).toBe(3);
    expect(JIT.validate.parse(JIT.number().pipe(JIT.ops.clamp(0, 10)))(42)).toBe(10);
    expect(JIT.validate.parse(JIT.number().pipe(JIT.ops.clamp(0, 10)))(-5)).toBe(0);
    expect(JIT.validate.parse(JIT.number().pipe(JIT.ops.toFixed(2)))(1.005)).toBe(1);
  });

  it("should convert between value kinds", () => {
    expect(JIT.validate.parse(JIT.string().pipe(JIT.ops.toNumber()))("42")).toBe(42);
    expect(JIT.validate.parse(JIT.number().pipe(JIT.ops.toText()))(42)).toBe("42");
    expect(JIT.validate.parse(JIT.date().pipe(JIT.ops.toISO()))(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
    expect(JIT.validate.parse(JIT.date().pipe(JIT.ops.toEpoch()))(new Date(1000))).toBe(1000);
  });

  it("should fold a whole chain into one expression", () => {
    const Slug = JIT.string().pipe(JIT.ops.trim().lowercase().collapseWhitespace().replace(" ", "-").slice(0, 10));
    const source = Compiler.emitValidatorSource(Slug.schema, { ops: ["parse"] });
    const assignments = source.match(/o\d+ = /g) ?? [];

    expect(JIT.validate.parse(Slug)("  Ada   Lovelace  ")).toBe("ada-lovela");
    // One assignment for the transform, not one per step.
    expect(assignments.length).toBeLessThan(6);
  });

  it("should keep regexes as bindings rather than interpolating them", () => {
    const Clean = JIT.string().pipe(JIT.ops.replace(/\d+/g, "#"));
    const source = Compiler.emitValidatorSource(Clean.schema, { ops: ["parse"] });

    // Rule: a runtime value travels as a binding, never inside the source.
    expect(source).toMatch(/\.replace\(__v\d+, "#"\)/);
    expect(source).not.toContain("\\d+");
    expect(JIT.validate.parse(Clean)("a12b3")).toBe("a#b#");
  });

  it("should compose with objects and run per field", () => {
    const User = JIT.object({
      // `.trim()` is a check and runs before validation; the chain runs after.
      email: JIT.string().trim().email().pipe(JIT.ops.lowercase()),
      score: JIT.number().pipe(JIT.ops.clamp(0, 100)),
    });

    expect(JIT.validate.parse(User)({ email: "  ADA@Example.COM ", score: 150 })).toEqual({
      email: "ada@example.com",
      score: 100,
    });
  });

  it("should run the chain after validation, never before", () => {
    const Email = JIT.string().email().pipe(JIT.ops.lowercase());

    // The check sees the input as given: the transform cannot rescue it.
    expect(() => JIT.validate.parse(Email)("not-an-email")).toThrow();
    expect(JIT.validate.parse(Email)("ADA@example.com")).toBe("ada@example.com");
  });

  it("should generate ahead of time where a capturing callback cannot", () => {
    const suffix = "-x";
    const Callback = JIT.string().pipe((value) => value.trim() + suffix);
    const Declarative = JIT.string().pipe(JIT.ops.trim());
    const outDir = mkdtempSync(join(tmpdir(), "jit-ops-"));

    try {
      // A closure over outer scope cannot be serialized, so AOT skips it.
      const callback = AOT.generate({ artifacts: { parseIt: JIT.validate.parse(Callback) }, outDir });

      expect(callback.files).toHaveLength(0);
      expect(callback.skipped[0]?.reason).toMatch(/callbacks cannot be serialized/);

      // The same transform, declared, always generates.
      const declarative = AOT.generate({ artifacts: { parseIt: JIT.validate.parse(Declarative) }, outDir });

      expect(declarative.skipped).toHaveLength(0);
      expect(readFileSync(join(outDir, "index.js"), "utf8")).toContain(".trim()");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("should keep the generated transform runnable, not just present in the source", async () => {
    const Declarative = JIT.string().pipe(JIT.ops.trim().lowercase().slice(0, 6));
    const outDir = mkdtempSync(join(tmpdir(), "jit-ops-run-"));

    try {
      AOT.generate({ artifacts: { parseIt: JIT.validate.parse(Declarative) }, outDir, format: "js" });

      const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
        parseIt: (value: unknown) => string;
      };

      // The generated module and the runtime compiler agree value for value.
      expect(generated.parseIt("  Ada Lovelace ")).toBe(JIT.validate.parse(Declarative)("  Ada Lovelace "));
      expect(generated.parseIt("  Ada Lovelace ")).toBe("ada lo");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
