import { JIT } from "@jit-compiler/jit/define";

/**
 * A declaration file is the manifest: every schema names a generated type,
 * every artifact becomes a generated function, and an object of artifacts
 * becomes one frozen object. Nothing here runs — `jit generate` lowers it.
 */
const User = JIT.object({
  id: JIT.number().int32().positive(),
  name: JIT.string().trim().min(3).max(80),
  email: JIT.string().email().pii("mask"),
  role: JIT.union(JIT.literal("admin"), JIT.literal("member")),
  active: JIT.boolean(),
  score: JIT.number().float32().min(0).max(100),
  tags: JIT.array(JIT.string().min(2)).min(1).max(8),
  createdAt: JIT.iso.datetime(),
  profile: JIT.object({
    bio: JIT.string().sanitize().nullable(),
  }).optional(),
});

const UserList = JIT.array(User);

const PublicUser = JIT.object({
  id: JIT.number().int32(),
  name: JIT.string(),
  role: JIT.union(JIT.literal("admin"), JIT.literal("member")),
});

export const Users = {
  is: JIT.validate.is(User),
  parse: JIT.validate.parse(User),
  safeParse: JIT.validate.safeParse(User),
  equal: JIT.compare.equal(User),
  clone: JIT.clone(User),
  diff: JIT.compare.diff(User),
  hash: JIT.compare.hash(User),
  stringify: JIT.json.stringify(User),
  fromJSON: JIT.json.parse(User).validate(),
  mask: JIT.security.mask(User),
  sanitize: JIT.security.sanitize(User),
  codec: JIT.binary.codec(User),
  mock: JIT.mock(User),
};

/** The interchange document; static data, inlined by the generator. */
export const UserJsonSchema = JIT.jsonSchema(User);

export const toPublicUser = JIT.map(User, PublicUser);

export const findActiveAdmins = JIT.query(UserList)
  .filter((query) => query.and(query.eq("role", "admin"), query.eq("active", true)))
  .select("id", "name", "score");

export const iterateActiveUsers = JIT.query(UserList)
  .filter((query) => query.eq("active", true))
  .select("id", "name")
  .take(10)
  .to.iterator();

export const visitActiveUsers = JIT.query(UserList)
  .filter((query) => query.eq("active", true))
  .select("id")
  .to.visitor();
