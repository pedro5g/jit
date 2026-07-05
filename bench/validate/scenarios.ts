import { JIT } from "jit";
import { z } from "zod";
import { registerScenario } from "../shared/scenario.js";

const GENERIC_BIAS = "handwritten generic baseline, not a published library";

const UserSchema = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2).max(64),
  email: JIT.string().email(),
  active: JIT.boolean(),
  tags: JIT.array(JIT.string()).max(8),
  profile: JIT.object({
    age: JIT.number().int().min(0).max(150),
    score: JIT.number(),
  }),
});

const zodUser = z.object({
  id: z.number().int().positive(),
  name: z.string().min(2).max(64),
  email: z.string().email(),
  active: z.boolean(),
  tags: z.array(z.string()).max(8),
  profile: z.object({
    age: z.number().int().min(0).max(150),
    score: z.number(),
  }),
});

interface BenchUser {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly active: boolean;
  readonly tags: readonly string[];
  readonly profile: { readonly age: number; readonly score: number };
}

const validUser: BenchUser = {
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

function handwrittenIs(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const user = value as BenchUser;
  if (typeof user.id !== "number" || !Number.isInteger(user.id) || user.id <= 0) return false;
  if (typeof user.name !== "string" || user.name.length < 2 || user.name.length > 64) return false;
  if (typeof user.email !== "string" || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(user.email))
    return false;
  if (typeof user.active !== "boolean") return false;
  if (!Array.isArray(user.tags) || user.tags.length > 8) return false;
  for (let i = 0; i < user.tags.length; i++) {
    if (typeof user.tags[i] !== "string") return false;
  }
  const profile = user.profile;
  if (profile === null || typeof profile !== "object") return false;
  if (typeof profile.age !== "number" || !Number.isInteger(profile.age) || profile.age < 0 || profile.age > 150)
    return false;
  if (typeof profile.score !== "number") return false;
  return true;
}

export function registerValidateScenarios(): void {
  const validate = JIT.validator(UserSchema);

  registerScenario({
    op: "validate is",
    name: "valid user",
    args: [validUser],
    jit: validate.is,
    competitors: [
      { name: "handwritten guard", fn: handwrittenIs, biased: GENERIC_BIAS },
      { name: "zod safeParse.success", fn: (value: unknown) => zodUser.safeParse(value).success },
    ],
  });

  registerScenario({
    op: "validate is",
    name: "invalid user",
    args: [invalidUser],
    jit: validate.is,
    competitors: [
      { name: "handwritten guard", fn: handwrittenIs, biased: GENERIC_BIAS },
      { name: "zod safeParse.success", fn: (value: unknown) => zodUser.safeParse(value).success },
    ],
  });

  registerScenario({
    op: "validate safeParse",
    name: "valid user",
    args: [validUser],
    jit: validate.safeParse,
    competitors: [{ name: "zod safeParse", fn: (value: unknown) => zodUser.safeParse(value) }],
  });

  registerScenario({
    op: "validate safeParse",
    name: "invalid user (7 issues)",
    args: [invalidUser],
    jit: validate.safeParse,
    competitors: [{ name: "zod safeParse", fn: (value: unknown) => zodUser.safeParse(value) }],
  });
}
