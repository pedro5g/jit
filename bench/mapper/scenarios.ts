import { JIT } from "@jit-compiler/jit";
import { registerScenario } from "../shared/scenario.js";

const GENERIC_BIAS = "handwritten generic baseline, not a published library";

interface SourceUser {
  readonly id: number;
  readonly first: string;
  readonly last: string;
  readonly emailAddress: string;
  readonly passwordHash: string;
  readonly profile: { readonly age: number; readonly score: number; readonly internalFlag: boolean };
}

const SourceUserSchema = JIT.object({
  id: JIT.number(),
  first: JIT.string(),
  last: JIT.string(),
  emailAddress: JIT.string(),
  passwordHash: JIT.string(),
  profile: JIT.object({ age: JIT.number(), score: JIT.number(), internalFlag: JIT.boolean() }),
});

const UserDTOSchema = JIT.object({
  id: JIT.number(),
  fullName: JIT.string(),
  email: JIT.string(),
  profile: JIT.object({ age: JIT.number(), score: JIT.number() }),
});

function createSourceUsers(length: number): SourceUser[] {
  const out = new Array<SourceUser>(length);

  for (let i = 0; i < length; i++) {
    out[i] = {
      id: i,
      first: `First${i}`,
      last: `Last${i}`,
      emailAddress: `user${i}@mail.com`,
      passwordHash: "hash",
      profile: { age: 20 + (i % 40), score: i % 100, internalFlag: i % 2 === 0 },
    };
  }

  return out;
}

/** Reflective field-config mapper in the style of class-transformer/AutoMapper. */
function createReflectiveMapper<TSource extends Record<string, unknown>>(config: {
  readonly fields: Readonly<Record<string, string | ((source: TSource) => unknown)>>;
}) {
  return (source: TSource): Record<string, unknown> => {
    const out: Record<string, unknown> = {};

    for (const key of Object.keys(config.fields)) {
      const rule = config.fields[key];

      out[key] = typeof rule === "function" ? rule(source) : source[rule as keyof TSource];
    }

    return out;
  };
}

export function registerMapperScenarios(): void {
  const users = createSourceUsers(10_000);
  const one = users[0];

  const toDTO = JIT.mapper(SourceUserSchema, UserDTOSchema, {
    fullName: (user) => `${user.first} ${user.last}`,
    email: { from: "emailAddress" },
  });

  const handwritten = (user: SourceUser) => ({
    id: user.id,
    fullName: `${user.first} ${user.last}`,
    email: user.emailAddress,
    profile: { age: user.profile.age, score: user.profile.score },
  });

  const reflective = createReflectiveMapper<SourceUser>({
    fields: {
      id: "id",
      fullName: (user) => `${user.first} ${user.last}`,
      email: "emailAddress",
      profile: (user) => ({ age: user.profile.age, score: user.profile.score }),
    },
  });

  registerScenario({
    op: "mapper map",
    name: "single user",
    args: [one],
    jit: toDTO.map,
    competitors: [
      { name: "handwritten mapper", fn: handwritten, biased: GENERIC_BIAS },
      { name: "reflective field-config mapper", fn: reflective },
    ],
  });

  registerScenario({
    op: "mapper many",
    name: "users 10000",
    args: [users],
    jit: toDTO.many,
    competitors: [
      {
        name: "native map + handwritten",
        fn: (value: SourceUser[]) => value.map(handwritten),
        biased: GENERIC_BIAS,
      },
      {
        name: "native map + reflective mapper",
        fn: (value: SourceUser[]) => value.map(reflective),
      },
    ],
  });
}
