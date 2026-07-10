import { Compiler, Errors, JIT } from "../../index.js";

describe("JIT compiler validator", () => {
  const User = JIT.object({
    id: JIT.number().int().positive(),
    name: JIT.string().min(2).max(64),
    email: JIT.string().email(),
    role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
    tags: JIT.array(JIT.string()).max(4),
  });

  const ada = {
    id: 1,
    name: "Ada",
    email: "ada@math.org",
    role: "admin",
    tags: ["math"],
  };

  it("should compile is() as a pure inline type guard", () => {
    const Users = JIT.validator(User);
    const source = Compiler.emitValidatorSource(User.schema);

    expect(Users.is(ada)).toBe(true);
    expect(Users.is({ ...ada, id: 1.5 })).toBe(false);
    expect(Users.is({ ...ada, name: "A" })).toBe(false);
    expect(Users.is({ ...ada, email: "not-an-email" })).toBe(false);
    expect(Users.is({ ...ada, role: "root" })).toBe(false);
    expect(Users.is(null)).toBe(false);
    expect(Users.is("nope")).toBe(false);

    expect(source).toContain("typeof v");
    expect(source).not.toContain("Object.keys(value)");
    expect(source).not.toContain("for (const");
    expect(source).not.toContain(".forEach(");
    expect(source).not.toContain(".map(");

    const value: unknown = ada;

    if (Users.is(value)) {
      expectTypeOf(value).toEqualTypeOf<{
        id: number;
        name: string;
        email: string;
        role: "admin" | "user";
        tags: string[];
      }>();
    }
  });

  it("should collect every issue with static paths in safeParse", () => {
    const Users = JIT.validator(User);
    const result = Users.safeParse({
      id: -3,
      name: "A",
      email: "nope",
      role: "root",
      tags: ["a", "b", "c", "d", "e"],
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      const paths = result.issues.map((issue) => issue.path);
      const codes = result.issues.map((issue) => issue.code);

      expect(paths).toEqual(["id", "name", "email", "role", "tags"]);
      expect(codes).toEqual(["not_positive", "too_small", "invalid_format", "invalid_union", "too_big"]);
      expect(result.issues[0].expected).toBe("> 0");
      expect(result.issues[0].message).toContain("positive");
    }
  });

  it("should report dynamic paths inside arrays", () => {
    const Items = JIT.array(JIT.object({ sku: JIT.string(), qty: JIT.number().int() }));
    const validate = JIT.validator(Items);
    const result = validate.safeParse([
      { sku: "a", qty: 1 },
      { sku: 7, qty: 1.5 },
    ]);

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.issues.map((issue) => issue.path)).toEqual(["[1].sku", "[1].qty"]);
      expect(result.issues[0].received).toBe("number");
    }
  });

  it("should return the input reference when nothing transforms", () => {
    const Users = JIT.validator(User);
    const result = Users.safeParse(ada);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(ada);
  });

  it("should freeze successful parse output only for readonly schemas", () => {
    const MutableUser = JIT.object({ id: JIT.number() });
    const ReadonlyUser = MutableUser.readonly();
    const validate = JIT.validator(ReadonlyUser);
    const parsed = validate.parse({ id: 1 });
    const safe = validate.safeParse({ id: 2 });
    const failedInput = { id: "nope" };
    const failed = validate.safeParse(failedInput);

    expect(Object.isFrozen(parsed)).toBe(true);
    expect(safe.success).toBe(true);
    if (safe.success) expect(Object.isFrozen(safe.data)).toBe(true);
    expect(failed.success).toBe(false);
    expect(Object.isFrozen(failedInput)).toBe(false);
    expect(Compiler.emitValidatorSource(MutableUser.schema)).not.toContain("Object.freeze");
    expect(Compiler.emitValidatorSource(ReadonlyUser.schema)).toContain("Object.freeze");

    expectTypeOf<JIT.infer<typeof MutableUser>>().toEqualTypeOf<{ id: number }>();
    expectTypeOf<JIT.infer<typeof ReadonlyUser>>().toEqualTypeOf<Readonly<{ id: number }>>();
  });

  it("should apply defaults, trims, and pipes to parse output", () => {
    const Signup = JIT.object({
      email: JIT.string().trim().lowercase().email(),
      plan: JIT.string().default("free"),
      code: JIT.string().pipe((value) => value.toUpperCase()),
    });
    const validate = JIT.validator(Signup);
    const result = validate.safeParse({ email: "  Ada@Math.org ", plan: undefined, code: "abc" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ email: "ada@math.org", plan: "free", code: "ABC" });
    }
  });

  it("should run refinements after base validation and report custom issues", () => {
    const Even = JIT.number()
      .int()
      .refine((value) => value % 2 === 0);
    const validate = JIT.validator(Even);

    expect(validate.is(4)).toBe(true);
    expect(validate.is(3)).toBe(false);
    expect(validate.is("x")).toBe(false);

    const failed = validate.safeParse(3);

    expect(failed.success).toBe(false);
    if (!failed.success) expect(failed.issues[0].code).toBe("custom");
  });

  it("should throw JITValidationError with issues on parse", () => {
    const Users = JIT.validator(User);

    expect(Users.parse(ada)).toBe(ada);

    try {
      Users.parse({ ...ada, email: "broken" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(Errors.JITValidationError);
      expect(error).toBeInstanceOf(Errors.JITError);

      const validationError = error as Errors.JITValidationError;

      expect(validationError.code).toBe("VALIDATION_FAILED");
      expect(validationError.issues).toHaveLength(1);
      expect(validationError.issues[0].path).toBe("email");
      expect(validationError.message).toContain("email");
    }
  });

  it("should validate nested collections, optionals, and discriminated unions", () => {
    const Event = JIT.discriminatedUnion("kind", [
      JIT.object({ kind: JIT.literal("click"), x: JIT.number(), y: JIT.number() }),
      JIT.object({ kind: JIT.literal("key"), key: JIT.string().min(1) }),
    ]);
    const Payload = JIT.object({
      events: JIT.array(Event).nonEmpty(),
      session: JIT.optional(JIT.string().uuid()),
      meta: JIT.map(JIT.string(), JIT.number()),
    });
    const validate = JIT.validator(Payload);

    expect(
      validate.is({
        events: [
          { kind: "click", x: 1, y: 2 },
          { kind: "key", key: "Enter" },
        ],
        session: undefined,
        meta: new Map([["a", 1]]),
      })
    ).toBe(true);

    const bad = validate.safeParse({
      events: [{ kind: "scroll", delta: 3 }],
      session: "not-a-uuid",
      meta: new Map([["a", "x"]]),
    });

    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.issues.map((issue) => issue.code)).toEqual(["invalid_union", "invalid_format", "expected_number"]);
      expect(bad.issues[2].path).toBe("meta[value]");
    }
  });

  it("should run inner checks and refines of union options (deep union)", () => {
    const Handle = JIT.union(
      JIT.string().min(3).max(20),
      JIT.number()
        .int()
        .positive()
        .refine((value) => value % 2 === 0)
    );
    const validate = JIT.validator(Handle);

    expect(validate.is("ada")).toBe(true);
    expect(validate.is(4)).toBe(true);
    expect(validate.is("ab")).toBe(false);
    expect(validate.is(3)).toBe(false);
    expect(validate.is(-2)).toBe(false);
    expect(validate.is(1.5)).toBe(false);

    const bad = validate.safeParse("ab");

    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.issues[0].code).toBe("invalid_union");
  });

  it("should deep-validate object options inside unions", () => {
    const Contact = JIT.union(JIT.object({ email: JIT.string().email() }), JIT.object({ phone: JIT.string().min(8) }));
    const validate = JIT.validator(Contact);

    expect(validate.is({ email: "ada@math.org" })).toBe(true);
    expect(validate.is({ phone: "11999998888" })).toBe(true);
    expect(validate.is({ email: "broken" })).toBe(false);
    expect(validate.is({ phone: "123" })).toBe(false);
    expect(validate.is({})).toBe(false);
  });

  it("should keep trivial union options inline without predicate calls", () => {
    const source = Compiler.emitValidatorSource(User.schema);

    // literal-only unions stay as inline comparisons, no hoisted helpers.
    expect(source).not.toContain("function iu");
    expect(source).not.toContain("function pu");
  });

  it("should apply transforms from the matched union branch in parse", () => {
    const Input = JIT.object({
      value: JIT.union(JIT.string().trim().min(1), JIT.number().int()),
    });
    const validate = JIT.validator(Input);
    const parsedString = validate.safeParse({ value: "  ada  " });
    const parsedNumber = validate.safeParse({ value: 7 });

    expect(parsedString.success).toBe(true);
    if (parsedString.success) expect(parsedString.data.value).toBe("ada");

    expect(parsedNumber.success).toBe(true);
    if (parsedNumber.success) expect(parsedNumber.data.value).toBe(7);
  });

  it("should propagate transforms through discriminated union branches", () => {
    const Event = JIT.discriminatedUnion("kind", [
      JIT.object({ kind: JIT.literal("msg"), text: JIT.string().trim().min(1) }),
      JIT.object({ kind: JIT.literal("ping") }),
    ]);
    const validate = JIT.validator(Event);
    const result = validate.safeParse({ kind: "msg", text: "  hi  " });

    expect(result.success).toBe(true);
    if (result.success && result.data.kind === "msg") expect(result.data.text).toBe("hi");
  });

  it("should rebuild tuple, set, map, and record outputs under transforms", () => {
    const Payload = JIT.object({
      pair: JIT.tuple(JIT.string().trim(), JIT.number()),
      tags: JIT.set(JIT.string().lowercase()),
      meta: JIT.map(JIT.string().trim(), JIT.number()),
      counts: JIT.record(
        JIT.string(),
        JIT.number().pipe((value) => value * 2)
      ),
    });
    const validate = JIT.validator(Payload);
    const input = {
      pair: ["  Ada  ", 1] as [string, number],
      tags: new Set(["MATH", "Poetry"]),
      meta: new Map([[" key ", 7]]),
      counts: { a: 2, b: 3 },
    };
    const result = validate.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pair).toEqual(["Ada", 1]);
      expect(result.data.tags).toEqual(new Set(["math", "poetry"]));
      expect(result.data.meta).toEqual(new Map([["key", 7]]));
      expect(result.data.counts).toEqual({ a: 4, b: 6 });
      // The input containers stay untouched — structural sharing only when
      // nothing transforms.
      expect(input.tags).toEqual(new Set(["MATH", "Poetry"]));
      expect(input.pair[0]).toBe("  Ada  ");
    }
  });

  it("should keep untransformed collections by reference", () => {
    const Plain = JIT.object({
      tags: JIT.set(JIT.string()),
      meta: JIT.map(JIT.string(), JIT.number()),
      pair: JIT.tuple(JIT.string(), JIT.number()),
    });
    const validate = JIT.validator(Plain);
    const input = {
      tags: new Set(["a"]),
      meta: new Map([["k", 1]]),
      pair: ["x", 2] as [string, number],
    };
    const result = validate.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(input);
  });

  it("should enforce strict objects and validate int schemas", () => {
    const Strict = JIT.object({ id: JIT.number() }).strict();
    const validate = JIT.validator(Strict);
    const source = Compiler.emitValidatorSource(Strict.schema);

    expect(validate.is({ id: 1 })).toBe(true);
    expect(validate.is({ id: 1, extra: true })).toBe(false);
    expect(source).toContain("Object.keys");

    const result = validate.safeParse({ id: 1, extra: true });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0].path).toBe("extra");
      expect(result.issues[0].code).toBe("unknown_key");
    }
  });

  it("should preserve loose object extras while rebuilding transformed known fields", () => {
    const Loose = JIT.object({ name: JIT.string().trim() }).loose();
    const validate = JIT.validator(Loose);
    const input = { name: "  Ada  ", extra: 1 };
    const result = validate.safeParse(input);
    const source = Compiler.emitValidatorSource(Loose.schema);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "Ada", extra: 1 });
      expect(result.data).not.toBe(input);
    }
    expect(source).toContain("Object.assign");
    expect(source).not.toContain(".map(");
    expect(source).not.toContain(".forEach(");
  });

  it("should validate and transform unknown keys through catchall schemas", () => {
    const WithExtras = JIT.object({ id: JIT.number() }).catchall(JIT.string().trim());
    const validate = JIT.validator(WithExtras);
    const result = validate.safeParse({ id: 1, tag: "  ok  " });
    const failed = validate.safeParse({ id: 1, tag: 7 });

    expect(validate.is({ id: 1, tag: "ok" })).toBe(true);
    expect(validate.is({ id: 1, tag: 7 })).toBe(false);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ id: 1, tag: "ok" });

    expect(failed.success).toBe(false);
    if (!failed.success) {
      expect(failed.issues[0].path).toBe("tag");
      expect(failed.issues[0].code).toBe("expected_string");
    }
  });

  it("should report custom messages from checks and refines", () => {
    const Signup = JIT.object({
      name: JIT.string().min(2, "nome muito curto"),
      email: JIT.string().email("e-mail inválido"),
      handle: JIT.string().regex(/^[a-z0-9_]+$/, "apenas minúsculas, números e _"),
      age: JIT.number().int("idade deve ser inteira").positive("idade deve ser positiva"),
      invite: JIT.string().refine((value) => value.startsWith("inv_"), "convite deve começar com inv_"),
    });
    const validate = JIT.validator(Signup);
    const result = validate.safeParse({
      name: "A",
      email: "nope",
      handle: "Não!",
      age: -1.5,
      invite: "x",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const byPath = new Map(result.issues.map((issue) => [`${issue.path}:${issue.code}`, issue.message]));

      expect(byPath.get("name:too_small")).toBe("nome muito curto");
      expect(byPath.get("email:invalid_format")).toBe("e-mail inválido");
      expect(byPath.get("handle:invalid_format")).toBe("apenas minúsculas, números e _");
      expect(byPath.get("age:not_integer")).toBe("idade deve ser inteira");
      expect(byPath.get("age:not_positive")).toBe("idade deve ser positiva");
      expect(byPath.get("invite:custom")).toBe("convite deve começar com inv_");
    }
  });

  it("should keep default messages when no custom message is given", () => {
    const Plain = JIT.object({ name: JIT.string().min(2) });
    const result = JIT.validator(Plain).safeParse({ name: "A" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues[0].message).toBe("expected at least 2 characters");
  });

  it("should validate promise wrappers as thenables", () => {
    const Job = JIT.object({ result: JIT.string().promise() });
    const validate = JIT.validator(Job);

    expect(validate.is({ result: Promise.resolve("ok") })).toBe(true);
    expect(validate.is({ result: "not a promise" })).toBe(false);

    const bad = validate.safeParse({ result: 7 });

    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.issues[0].expected).toBe("Promise");
  });

  it("should apply transforms inside intersections on parse", () => {
    const Person = JIT.object({ name: JIT.string().trim() });
    const Audit = JIT.object({ createdBy: JIT.string().lowercase() });
    const Full = JIT.intersection(Person, Audit);
    const validate = JIT.validator(Full);
    const result = validate.safeParse({ name: "  Ada  ", createdBy: "ROOT" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "Ada", createdBy: "root" });
    }

    // Reference is preserved when nothing inside the intersection rebuilds.
    const Static = JIT.intersection(JIT.object({ a: JIT.number() }), JIT.object({ b: JIT.number() }));
    const value = { a: 1, b: 2 };
    const kept = JIT.validator(Static).safeParse(value);

    expect(kept.success).toBe(true);
    if (kept.success) expect(kept.data).toBe(value);
  });

  it("should validate schemas built with merge, pick, omit, and partial", () => {
    const Base = JIT.object({
      id: JIT.number().int().positive(),
      name: JIT.string().min(2, "nome muito curto"),
      secret: JIT.string(),
    });
    const Public = Base.omit(["secret"]).merge(JIT.object({ tag: JIT.string() }));
    const validate = JIT.validator(Public);

    expect(validate.is({ id: 1, name: "Ada", tag: "x" })).toBe(true);
    expect(validate.is({ id: 1, name: "Ada", secret: "s", tag: "x" })).toBe(true);

    const bad = validate.safeParse({ id: 1, name: "A", tag: "x" });

    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.issues[0].message).toBe("nome muito curto");
  });

  it("should share one cached validator per schema", () => {
    expect(JIT.validator(User)).toBe(JIT.validator(User));
    expect(JIT.validator(User, { cache: false })).not.toBe(JIT.validator(User));
    Compiler.clearCompileCache();
  });

  it("should keep binding values external to the source", () => {
    const Secret = JIT.object({
      token: JIT.string().regex(/^tok_[a-z0-9]{8}$/),
      attempts: JIT.number().default(3),
    });
    const source = Compiler.emitValidatorSource(Secret.schema);

    expect(source).not.toContain("tok_");
    expect(source).toContain("__v");
  });
});
