import { JIT } from "@jit-compiler/jit";
import { zx } from "@traversable/zod";
import fc from "fast-check";
import { z } from "zod";
import { fastEqual, lodashIsEqual } from "../shared/competitors.js";
import { registerScenario } from "../shared/scenario.js";

const GeneratedUser = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  role: JIT.string(),
  profile: JIT.object({
    age: JIT.number(),
    email: JIT.string(),
    active: JIT.boolean(),
  }),
});
const GeneratedUsers = JIT.array(GeneratedUser);
const equal = JIT.compileEqual(GeneratedUsers.schema);

const TraversableUser = z.object({
  id: z.number(),
  name: z.string(),
  role: z.string(),
  profile: z.object({
    age: z.number(),
    email: z.string(),
    active: z.boolean(),
  }),
});
const traversableEqual = zx.deepEqual(z.array(TraversableUser));

type GeneratedUser = typeof GeneratedUser.schema._type;

const generatedUser = fc.record({
  id: fc.integer({ min: 1, max: 10_000 }),
  name: fc.string({ minLength: 1, maxLength: 24 }),
  role: fc.constantFrom("admin", "user", "blocked"),
  profile: fc.record({
    age: fc.integer({ min: 1, max: 120 }),
    email: fc.emailAddress(),
    active: fc.boolean(),
  }),
});

// Fixed seed keeps the sampled data identical across runs so results stay
// comparable between benchmark sessions.
const sampled = fc.sample(fc.array(generatedUser, { minLength: 128, maxLength: 128 }), {
  numRuns: 1,
  seed: 20260704,
})[0] as GeneratedUser[];

// fast-check occasionally emits null-prototype objects as edge cases, which
// makes constructor-checking competitors (fast-deep-equal) bail out early and
// report a bogus win. JSON round-trip normalizes everything to plain objects.
const left = JSON.parse(JSON.stringify(sampled)) as GeneratedUser[];
const right = left.map((user) => ({
  id: user.id,
  name: user.name,
  role: user.role,
  profile: {
    age: user.profile.age,
    email: user.profile.email,
    active: user.profile.active,
  },
}));
const earlyFail = right.map((user, index) => (index === 0 ? { ...user, id: user.id + 1 } : user));

export function registerGeneratedObjects(): void {
  registerScenario({
    op: "equal",
    name: "fast-check generated users[128]",
    args: [left, right],
    jit: equal,
    competitors: [
      { name: "fast-deep-equal", fn: fastEqual },
      { name: "lodash.isEqual", fn: lodashIsEqual },
      { name: "traversable/zod deepEqual", fn: traversableEqual },
    ],
  });

  registerScenario({
    op: "equal",
    name: "fast-check generated users[128] early fail",
    args: [left, earlyFail],
    jit: equal,
    competitors: [
      { name: "fast-deep-equal", fn: fastEqual },
      { name: "lodash.isEqual", fn: lodashIsEqual },
      { name: "traversable/zod deepEqual", fn: traversableEqual },
    ],
  });
}
