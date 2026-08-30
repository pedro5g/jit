import { Errors, JIT } from "../../index.js";
import { validation } from "./validation-helper.js";

describe("JIT async validation", () => {
  it("should settle promise wrappers and validate the resolved value", async () => {
    const Job = JIT.object({
      id: JIT.number().int(),
      result: JIT.string().min(3).promise(),
    });
    const validate = validation(Job);

    const good = await validate.async.safeParse({ id: 1, result: Promise.resolve("done") });

    expect(good.success).toBe(true);
    if (good.success) expect(good.data.result).toBe("done");

    const short = await validate.async.safeParse({ id: 1, result: Promise.resolve("no") });

    expect(short.success).toBe(false);
    if (!short.success) {
      expect(short.issues[0].path).toEqual(["result"]);
      expect(short.issues[0].code).toBe("too_small");
    }
  });

  it("should accept plain values where promises are expected, like zod", async () => {
    const Wrapped = validation(JIT.string().min(2).promise());

    await expect(Wrapped.async.parse("ada")).resolves.toBe("ada");
    await expect(Wrapped.async.parse(Promise.resolve("ada"))).resolves.toBe("ada");
    await expect(Wrapped.async.parse(Promise.resolve("a"))).rejects.toBeInstanceOf(Errors.JITValidationError);
  });

  it("should apply transforms to awaited values on parseAsync", async () => {
    const Report = JIT.object({
      title: JIT.string().trim().promise(),
    });
    const data = await validation(Report).async.parse({ title: Promise.resolve("  spaced  ") });

    expect(data.title).toBe("spaced");
  });

  it("should fall back to the sync path for promise-free schemas", async () => {
    const Plain = JIT.object({ id: JIT.number() });
    const validate = validation(Plain);

    await expect(validate.async.safeParse({ id: 1 })).resolves.toEqual({ success: true, data: { id: 1 } });
    await expect(validate.async.parse({ id: "x" })).rejects.toBeInstanceOf(Errors.JITValidationError);
  });

  it("should keep sync safeParse behavior unchanged (thenable guard only)", () => {
    const Job = JIT.object({ result: JIT.string().promise() });
    const validate = validation(Job);

    expect(validate.is({ result: Promise.resolve("x") })).toBe(true);
    expect(validate.is({ result: "not a promise" })).toBe(false);
  });

  it("should expose the async pair on the validation namespace", async () => {
    const Task = JIT.object({ output: JIT.string().promise() });
    const parseAsync = JIT.validate.async.parse(Task);
    const safeParseAsync = JIT.validate.async.safeParse(Task);

    await expect(parseAsync({ output: Promise.resolve("ok") })).resolves.toEqual({ output: "ok" });

    const result = await safeParseAsync({ output: Promise.resolve(42) });

    expect(result.success).toBe(false);
  });

  it("should stop async diagnostics at maxIssues", async () => {
    const Task = JIT.object({ first: JIT.string().promise(), second: JIT.string().promise() });
    const safeParse = JIT.validate.safeParseAsync(Task, { maxIssues: 1 });
    const parse = JIT.validate.async.parse(Task, { maxIssues: 1 });
    const input = { first: Promise.resolve(1), second: Promise.resolve(2) };
    const result = await safeParse(input);

    expect(result.success === false && result.issues).toHaveLength(1);
    await expect(parse(input)).rejects.toMatchObject({ issues: [expect.objectContaining({ path: ["first"] })] });
  });
});
