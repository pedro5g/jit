/**
 * The schema every landing demo is built around. Generated sources below were
 * captured from the real compiler (`JIT.*(User).compile().source`) — keep them
 * in sync with the library output when the emitters change.
 */
export const userSchemaSource = `import { JIT } from "@pedro5g/jit/runtime";

const User = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2),
  email: JIT.string().email(),
  role: JIT.union(JIT.literal("admin"), JIT.literal("user")),
  tags: JIT.array(JIT.string()).max(8),
});

type User = JIT.Infer<typeof User>;`;

export const heroUsageSource = `const Users = JIT.validator(User);

Users.is(input);        // pure boolean guard
Users.parse(input);     // throws with every issue
Users.safeParse(input); // { success, data | issues }`;

export const heroGeneratedExcerpt = `// Users.is — generated source (excerpt)
function is(value) {
  let v1 = value;
  if (v1 === null || typeof v1 !== "object" || Array.isArray(v1)) {
    return false;
  }
  let v3 = v1.id;
  if (typeof v3 !== "number") {
    return false;
  }
  if (!Number.isInteger(v3)) {
    return false;
  }
  if (v3 <= 0) {
    return false;
  }
  let v5 = v1.name;
  if (typeof v5 !== "string") {
    return false;
  }
  // …email, role, tags: same straight-line checks
  return true;
}`;
