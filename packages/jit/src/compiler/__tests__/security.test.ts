import { Compiler, Errors, JIT } from "../../index.js";

describe("JIT compiler security (mask + sanitize)", () => {
  const User = JIT.object({
    id: JIT.number(),
    name: JIT.string(),
    email: JIT.string().pii("mask"),
    password: JIT.string().pii(),
    document: JIT.string().pii("hash"),
    profile: JIT.object({
      city: JIT.string(),
      salary: JIT.number().pii(),
    }),
    devices: JIT.array(JIT.object({ id: JIT.string(), fingerprint: JIT.string().pii("hash") })),
  });

  const ada = {
    id: 1,
    name: "Ada",
    email: "ada@math.org",
    password: "s3cr3t!",
    document: "123.456.789-00",
    profile: { city: "London", salary: 95000 },
    devices: [{ id: "d1", fingerprint: "fp-abc-123" }],
  };

  it("should mask pii fields with redact, mask, and hash strategies", () => {
    const maskUser = JIT.mask(User);
    const masked = maskUser(ada);

    expect(masked.password).toBe("***");
    expect(masked.email).toBe("***.org");
    expect(masked.document).toMatch(/^[0-9a-f]+$/);
    expect(masked.document).not.toContain("123");
    expect(masked.profile.salary).toBe(0);
    expect(masked.devices[0].fingerprint).toMatch(/^[0-9a-f]+$/);

    expect(masked.id).toBe(1);
    expect(masked.name).toBe("Ada");
    expect(masked.profile.city).toBe("London");
    expect(masked.devices[0].id).toBe("d1");
    expectTypeOf(masked).toEqualTypeOf<typeof masked>();
  });

  it("should keep untouched subtrees by reference and not mutate the input", () => {
    const Clean = JIT.object({
      meta: JIT.object({ tag: JIT.string() }),
      secret: JIT.string().pii(),
    });
    const maskClean = JIT.mask(Clean);
    const input = { meta: { tag: "x" }, secret: "hide" };
    const masked = maskClean(input);

    expect(masked).not.toBe(input);
    expect(masked.meta).toBe(input.meta);
    expect(input.secret).toBe("hide");
  });

  it("should compile to identity when no field is marked", () => {
    const Plain = JIT.object({ id: JIT.number() });
    const maskPlain = JIT.mask(Plain);
    const value = { id: 1 };

    expect(maskPlain(value)).toBe(value);
  });

  it("should emit surgical inline source without spread or Object.keys", () => {
    const source = Compiler.emitMaskSource(User.schema);

    expect(source).toContain("Math.imul");
    expect(source).toContain('"***"');
    expect(source).not.toContain("Object.keys");
    expect(source).not.toContain("...");
    expect(source).not.toContain(".map(");
  });

  it("should reject pii on unsupported field types", () => {
    const Bad = JIT.object({ flags: JIT.array(JIT.string()).pii() });

    expect(() => JIT.mask(Bad)).toThrow(Errors.JITError);
    expect(() => JIT.mask(Bad)).toThrow(/string and number/);
  });

  it("should strip scripts, tags, and stray brackets with sanitize", () => {
    const Comment = JIT.object({
      id: JIT.number(),
      body: JIT.string().sanitize(),
      title: JIT.string(),
    });
    const clean = JIT.sanitize(Comment);
    const dirty = {
      id: 1,
      body: '<script>alert("xss")</script><b>hello</b> 1 < 2 <style>p{}</style>',
      title: "<b>kept as-is</b>",
    };
    const result = clean(dirty);

    expect(result.body).toBe("hello 1 &lt; 2 ");
    expect(result.title).toBe("<b>kept as-is</b>");
    expect(dirty.body).toContain("<script>");
  });

  it("should handle optional pii fields with guards", () => {
    const Account = JIT.object({
      id: JIT.number(),
      recoveryEmail: JIT.optional(JIT.string().pii()),
    });
    const maskAccount = JIT.mask(Account);

    expect(maskAccount({ id: 1, recoveryEmail: undefined }).recoveryEmail).toBeUndefined();
    expect(maskAccount({ id: 1, recoveryEmail: "a@b.co" }).recoveryEmail).toBe("***");
  });

  it("should run the sanitize chain inside compiled parse", () => {
    const Post = JIT.object({
      body: JIT.string().sanitize().min(1),
    });
    const validate = JIT.validator(Post);
    const result = validate.safeParse({ body: "<img onerror=x src=y>ok" });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.body).toBe("ok");

    const stripped = validate.safeParse({ body: "<b></b>" });

    expect(stripped.success).toBe(false);
    if (!stripped.success) expect(stripped.issues[0].code).toBe("too_small");
  });

  it("should cache compiled mask and sanitize per schema", () => {
    expect(JIT.mask(User)).toBe(JIT.mask(User));

    const Comment = JIT.object({ body: JIT.string().sanitize() });

    expect(JIT.sanitize(Comment)).toBe(JIT.sanitize(Comment));
    Compiler.clearCompileCache();
  });
});
