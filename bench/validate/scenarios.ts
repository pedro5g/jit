import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AOT, JIT } from "@jit-compiler/jit";
import { z } from "zod";
import { registerScenario } from "../shared/scenario.js";
import {
  assertSimple as typiaAssertSimple,
  assertUser as typiaAssertUser,
  isSimple as typiaIsSimple,
  isUser as typiaIsUser,
  validateSimple as typiaValidateSimple,
  validateUser as typiaValidateUser,
} from "./typia-gen/user.js";

const SimpleSchema = JIT.object({ id: JIT.number().int32(), name: JIT.string() });
const UserSchema = JIT.object({
  id: JIT.number().int32().positive(),
  name: JIT.string().min(2).max(64),
  email: JIT.string().email(),
  active: JIT.boolean(),
  tags: JIT.array(JIT.string()).max(8),
  profile: JIT.object({
    age: JIT.number().int32().min(0).max(150),
    score: JIT.number(),
  }),
});

const zodSimple = z.object({ id: z.number().int(), name: z.string() });
const zodUser = z.object({
  id: z.number().int().positive(),
  name: z.string().min(2).max(64),
  email: z.string().email(),
  active: z.boolean(),
  tags: z.array(z.string()).max(8),
  profile: z.object({ age: z.number().int().min(0).max(150), score: z.number() }),
});

const validSimple = { id: 42, name: "Ada" };
const invalidSimple = { id: 2 ** 31, name: 7 };
const validUser = {
  id: 42,
  name: "Ada Lovelace",
  email: "ada@math.org",
  active: true,
  tags: ["math", "pioneer"],
  profile: { age: 36, score: 99.5 },
};
const invalidUser = {
  id: -1,
  name: "A",
  email: "not-an-email",
  active: "yes",
  tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
  profile: { age: 200, score: "high" },
};

interface AotModule {
  readonly Simple_is: (value: unknown) => boolean;
  readonly Simple_parse: (value: unknown) => unknown;
  readonly Simple_safeParse: (value: unknown) => unknown;
  readonly User_is: (value: unknown) => boolean;
  readonly User_parse: (value: unknown) => unknown;
  readonly User_safeParse: (value: unknown) => unknown;
}

async function loadAot(): Promise<AotModule> {
  const outDir = fileURLToPath(new URL("./.generated/", import.meta.url));

  AOT.generate({
    artifacts: {
      Simple_is: JIT.validate.is(SimpleSchema),
      Simple_parse: JIT.validate.parse(SimpleSchema),
      Simple_safeParse: JIT.validate.safeParse(SimpleSchema),
      User_is: JIT.validate.is(UserSchema),
      User_parse: JIT.validate.parse(UserSchema),
      User_safeParse: JIT.validate.safeParse(UserSchema),
    },
    outDir,
  });
  return (await import(pathToFileURL(join(outDir, "index.js")).href)) as AotModule;
}

export async function registerValidateScenarios(): Promise<void> {
  const aot = await loadAot();

  registerValidationCase(
    "simple object",
    validSimple,
    invalidSimple,
    {
      is: aot.Simple_is,
      parse: aot.Simple_parse,
      safeParse: aot.Simple_safeParse,
    },
    {
      is: typiaIsSimple,
      parse: typiaAssertSimple,
      safeParse: typiaValidateSimple,
    },
    zodSimple
  );
  registerValidationCase(
    "nested constrained object",
    validUser,
    invalidUser,
    {
      is: aot.User_is,
      parse: aot.User_parse,
      safeParse: aot.User_safeParse,
    },
    {
      is: typiaIsUser,
      parse: typiaAssertUser,
      safeParse: typiaValidateUser,
    },
    zodUser
  );
}

interface ValidationFunctions {
  readonly is: (value: unknown) => unknown;
  readonly parse: (value: unknown) => unknown;
  readonly safeParse: (value: unknown) => unknown;
}

function registerValidationCase(
  name: string,
  valid: unknown,
  invalid: unknown,
  jit: ValidationFunctions,
  typia: ValidationFunctions,
  zodSchema: z.ZodType
): void {
  registerScenario({
    op: "AOT is",
    name: `${name} / valid`,
    args: [valid],
    jit: jit.is,
    competitors: [
      { name: "Typia generated is", fn: typia.is },
      { name: "Zod safeParse.success", fn: (value: unknown) => zodSchema.safeParse(value).success },
    ],
  });
  registerScenario({
    op: "AOT is",
    name: `${name} / invalid`,
    args: [invalid],
    jit: jit.is,
    competitors: [
      { name: "Typia generated is", fn: typia.is },
      { name: "Zod safeParse.success", fn: (value: unknown) => zodSchema.safeParse(value).success },
    ],
  });
  registerScenario({
    op: "AOT parse",
    name: `${name} / valid`,
    args: [valid],
    jit: jit.parse,
    competitors: [
      { name: "Typia generated assert", fn: typia.parse },
      { name: "Zod parse", fn: (value: unknown) => zodSchema.parse(value) },
    ],
  });
  registerScenario({
    op: "AOT safeParse",
    name: `${name} / valid`,
    args: [valid],
    jit: jit.safeParse,
    competitors: [
      { name: "Typia generated validate", fn: typia.safeParse },
      { name: "Zod safeParse", fn: (value: unknown) => zodSchema.safeParse(value) },
    ],
  });
  registerScenario({
    op: "AOT safeParse",
    name: `${name} / invalid`,
    args: [invalid],
    jit: jit.safeParse,
    competitors: [
      { name: "Typia generated validate", fn: typia.safeParse },
      { name: "Zod safeParse", fn: (value: unknown) => zodSchema.safeParse(value) },
    ],
  });
}

/**
 * What diagnostics cost, and what they must not cost.
 *
 * Collect-all does more work than fail-fast on invalid input — that is the
 * trade a caller makes when they ask for every failure. What must stay true is
 * the other half: a schema carrying custom messages must not make the boolean
 * path or the valid path slower, because neither ever reads a message.
 */
export async function registerDiagnosticsScenarios(): Promise<void> {
  const Plain = JIT.object({
    name: JIT.string().min(2).max(64),
    email: JIT.string().email(),
    age: JIT.number().int32().min(0).max(150),
    nickname: JIT.string().min(2),
    city: JIT.string().min(2),
  });
  const WithMessages = JIT.object({
    name: JIT.string().min(2, "Name must contain at least two characters").max(64, "Name is too long"),
    email: JIT.string().email({ message: "That email address does not look valid" }),
    age: JIT.number()
      .int32("Age must be a 32-bit integer")
      .min(0, "Age cannot be negative")
      .max(150, "Age is too large"),
    nickname: JIT.string().min(2, "Nickname must contain at least two characters"),
    city: JIT.string().min(2, "City must contain at least two characters"),
  });
  const valid = { name: "Ada", email: "ada@example.com", age: 36, nickname: "ada", city: "London" };
  const oneInvalid = { ...valid, email: "nope" };
  const fiveInvalid = { name: "", email: "nope", age: -1, nickname: "", city: "" };

  const isPlain = JIT.validate.is(Plain);
  const isWithMessages = JIT.validate.is(WithMessages);
  const safeParsePlain = JIT.validate.safeParse(Plain);
  const safeParseWithMessages = JIT.validate.safeParse(WithMessages);
  const parsePlain = JIT.validate.parse(Plain);
  const limitedPlain = JIT.validate.safeParse(Plain, { maxIssues: 2 });
  const diagnosticsOutDir = fileURLToPath(new URL("./.generated/diagnostics/", import.meta.url));

  AOT.generate({
    artifacts: {
      Plain_is: isPlain,
      Plain_safeParse: safeParsePlain,
      Plain_parse: parsePlain,
      Messages_is: isWithMessages,
      Messages_safeParse: safeParseWithMessages,
      Plain_limited: limitedPlain,
    },
    outDir: diagnosticsOutDir,
  });
  const aot = (await import(pathToFileURL(join(diagnosticsOutDir, "index.js")).href)) as {
    readonly Plain_is: typeof isPlain;
    readonly Plain_safeParse: typeof safeParsePlain;
    readonly Plain_parse: typeof parsePlain;
    readonly Messages_is: typeof isWithMessages;
    readonly Messages_safeParse: typeof safeParseWithMessages;
    readonly Plain_limited: typeof limitedPlain;
  };

  const handwrittenIs = (value: typeof valid) =>
    typeof value === "object" &&
    value !== null &&
    typeof value.name === "string" &&
    value.name.length >= 2 &&
    value.name.length <= 64 &&
    typeof value.email === "string" &&
    value.email.includes("@") &&
    typeof value.age === "number" &&
    value.age >= 0 &&
    value.age <= 150 &&
    typeof value.nickname === "string" &&
    value.nickname.length >= 2 &&
    typeof value.city === "string" &&
    value.city.length >= 2;
  const handwrittenSafeParse = (value: typeof valid) => {
    const issues: Array<{ path: readonly PropertyKey[]; code: string; expected: string; message: string }> = [];

    if (typeof value.name !== "string")
      issues.push({ path: ["name"], code: "expected_string", expected: "string", message: "expected string" });
    else {
      if (value.name.length < 2)
        issues.push({
          path: ["name"],
          code: "too_small",
          expected: "length >= 2",
          message: "expected at least 2 characters",
        });
      if (value.name.length > 64)
        issues.push({
          path: ["name"],
          code: "too_big",
          expected: "length <= 64",
          message: "expected at most 64 characters",
        });
    }
    if (typeof value.email !== "string")
      issues.push({ path: ["email"], code: "expected_string", expected: "string", message: "expected string" });
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))
      issues.push({ path: ["email"], code: "invalid_format", expected: "email", message: "expected a valid email" });
    if (typeof value.age !== "number")
      issues.push({ path: ["age"], code: "expected_number", expected: "number", message: "expected number" });
    else {
      if (!Number.isInteger(value.age))
        issues.push({ path: ["age"], code: "not_integer", expected: "integer", message: "expected an integer" });
      if (value.age < 0)
        issues.push({
          path: ["age"],
          code: "too_small",
          expected: ">= 0",
          message: "expected a value greater than or equal to 0",
        });
      if (value.age > 150)
        issues.push({
          path: ["age"],
          code: "too_big",
          expected: "<= 150",
          message: "expected a value less than or equal to 150",
        });
    }
    for (const field of ["nickname", "city"] as const) {
      const item = value[field];
      if (typeof item !== "string")
        issues.push({ path: [field], code: "expected_string", expected: "string", message: "expected string" });
      else if (item.length < 2)
        issues.push({
          path: [field],
          code: "too_small",
          expected: "length >= 2",
          message: "expected at least 2 characters",
        });
    }
    return issues.length === 0 ? { success: true as const, data: value } : { success: false as const, issues };
  };

  registerScenario({
    op: "diagnostics is",
    name: "valid, no custom messages",
    args: [valid],
    jit: isPlain,
    competitors: [
      { name: "handwritten", fn: handwrittenIs, biased: "hardcodes one shape and a looser email test" },
      { name: "JIT AOT", fn: aot.Plain_is },
      { name: "custom messages in the schema", fn: isWithMessages },
      { name: "custom messages AOT", fn: aot.Messages_is },
    ],
  });

  registerScenario({
    op: "diagnostics is",
    name: "invalid, no custom messages",
    args: [fiveInvalid],
    jit: isPlain,
    competitors: [{ name: "custom messages in the schema", fn: isWithMessages }],
  });

  registerScenario({
    op: "diagnostics safeParse",
    name: "valid",
    args: [valid],
    jit: safeParsePlain,
    competitors: [
      { name: "handwritten optimized", fn: handwrittenSafeParse },
      { name: "JIT AOT", fn: aot.Plain_safeParse },
      { name: "custom messages in the schema", fn: safeParseWithMessages },
      { name: "custom messages AOT", fn: aot.Messages_safeParse },
      { name: "is", fn: isPlain, biased: "answers a boolean and builds no issue" },
    ],
  });

  registerScenario({
    op: "diagnostics safeParse",
    name: "one failure",
    args: [oneInvalid],
    jit: safeParsePlain,
    competitors: [
      { name: "handwritten optimized", fn: handwrittenSafeParse },
      { name: "JIT AOT", fn: aot.Plain_safeParse },
      { name: "custom messages in the schema", fn: safeParseWithMessages },
      { name: "custom messages AOT", fn: aot.Messages_safeParse },
      { name: "is", fn: isPlain, biased: "stops at the first failure and builds no issue" },
    ],
  });

  registerScenario({
    op: "diagnostics safeParse",
    name: "five failures",
    args: [fiveInvalid],
    jit: safeParsePlain,
    competitors: [
      { name: "handwritten optimized", fn: handwrittenSafeParse },
      { name: "JIT AOT", fn: aot.Plain_safeParse },
      { name: "custom messages in the schema", fn: safeParseWithMessages },
      { name: "custom messages AOT", fn: aot.Messages_safeParse },
      { name: "is", fn: isPlain, biased: "stops at the first failure and builds no issue" },
    ],
  });

  registerScenario({
    op: "diagnostics parse",
    name: "valid",
    args: [valid],
    jit: parsePlain,
    competitors: [{ name: "safeParse", fn: safeParsePlain }],
  });

  registerScenario({
    op: "diagnostics parse",
    name: "five failures",
    args: [fiveInvalid],
    jit: ((value: unknown) => {
      try {
        return parsePlain(value as never);
      } catch (error) {
        return error;
      }
    }) as (...args: never[]) => unknown,
    competitors: [
      {
        name: "JIT AOT",
        fn: ((value: unknown) => {
          try {
            return aot.Plain_parse(value as never);
          } catch (error) {
            return error;
          }
        }) as (...args: never[]) => unknown,
      },
      { name: "safeParse", fn: safeParsePlain, biased: "returns the issues instead of building a stack trace" },
    ],
  });

  registerScenario({
    op: "diagnostics safeParse",
    name: "five failures, maxIssues 2",
    args: [fiveInvalid],
    jit: limitedPlain,
    competitors: [
      { name: "JIT AOT", fn: aot.Plain_limited },
      { name: "collect all", fn: safeParsePlain, biased: "constructs three additional issues" },
    ],
  });

  /**
   * A prototype method installed by `.extends()` against a hand-written one.
   *
   * The claim is parity: there is no dispatcher between the call and the body,
   * so after warm-up the two should be the same call.
   */
  const Shape = JIT.object({ id: JIT.string(), name: JIT.string() });
  const Extended = JIT.class(Shape).extends({
    displayName() {
      return this.name.toUpperCase();
    },
  });
  class Handwritten {
    constructor(
      readonly id: string,
      readonly name: string
    ) {}

    displayName(): string {
      return this.name.toUpperCase();
    }
  }
  const extended = new Extended({ id: "u_1", name: "Ada" });
  const handwritten = new Handwritten("u_1", "Ada");

  registerScenario({
    op: "class extension",
    name: "prototype method call",
    args: [extended],
    jit: ((instance: typeof extended) => instance.displayName()) as (...args: never[]) => unknown,
    competitors: [{ name: "handwritten class method", fn: () => handwritten.displayName() }],
  });
}
