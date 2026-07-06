import { Errors, JIT } from "../../index.js";

describe("JIT async validation (parseAsync / safeParseAsync)", () => {
  it("should settle promise wrappers and validate the resolved value", async () => {
    const Job = JIT.object({
      id: JIT.number().int(),
      result: JIT.string().min(3).promise(),
    });
    const validate = JIT.validator(Job);

    const good = await validate.safeParseAsync({ id: 1, result: Promise.resolve("done") });

    expect(good.success).toBe(true);
    if (good.success) expect(good.data.result).toBe("done");

    const short = await validate.safeParseAsync({ id: 1, result: Promise.resolve("no") });

    expect(short.success).toBe(false);
    if (!short.success) {
      expect(short.issues[0].path).toBe("result");
      expect(short.issues[0].code).toBe("too_small");
    }
  });

  it("should accept plain values where promises are expected, like zod", async () => {
    const Wrapped = JIT.validator(JIT.string().min(2).promise());

    await expect(Wrapped.parseAsync("ada")).resolves.toBe("ada");
    await expect(Wrapped.parseAsync(Promise.resolve("ada"))).resolves.toBe("ada");
    await expect(Wrapped.parseAsync(Promise.resolve("a"))).rejects.toBeInstanceOf(Errors.JITValidationError);
  });

  it("should apply transforms to awaited values on parseAsync", async () => {
    const Report = JIT.object({
      title: JIT.string().trim().promise(),
    });
    const data = await JIT.validator(Report).parseAsync({ title: Promise.resolve("  spaced  ") });

    expect(data.title).toBe("spaced");
  });

  it("should fall back to the sync path for promise-free schemas", async () => {
    const Plain = JIT.object({ id: JIT.number() });
    const validate = JIT.validator(Plain);

    await expect(validate.safeParseAsync({ id: 1 })).resolves.toEqual({ success: true, data: { id: 1 } });
    await expect(validate.parseAsync({ id: "x" })).rejects.toBeInstanceOf(Errors.JITValidationError);
  });

  it("should keep sync safeParse behavior unchanged (thenable guard only)", () => {
    const Job = JIT.object({ result: JIT.string().promise() });
    const validate = JIT.validator(Job);

    expect(validate.is({ result: Promise.resolve("x") })).toBe(true);
    expect(validate.is({ result: "not a promise" })).toBe(false);
  });

  it("should expose the async pair on JIT.model and JIT.compile", async () => {
    const Task = JIT.object({ output: JIT.string().promise() });
    const model = JIT.model(Task);
    const compiled = JIT.compile(Task, ["parseAsync", "safeParseAsync"]);

    await expect(model.parseAsync({ output: Promise.resolve("ok") })).resolves.toEqual({ output: "ok" });

    const result = await compiled.safeParseAsync({ output: Promise.resolve(42) });

    expect(result.success).toBe(false);
  });
});
