import { JIT } from "@jit-compiler/jit/define";

const UserSchema = JIT.object({
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
const UserListSchema = JIT.array(UserSchema);
const PublicUserSchema = JIT.object({
  id: JIT.number().int32(),
  name: JIT.string(),
  role: JIT.union(JIT.literal("admin"), JIT.literal("member")),
});
const selected = JIT.compile(UserSchema, [
  "equal",
  "clone",
  "diff",
  "hash",
  "stringify",
  "fromJSON",
  "mask",
  "sanitize",
  "codec",
] as const);
const is = JIT.validate(UserSchema).is().compile();
const parse = JIT.validate(UserSchema).parse().compile();
const safeParse = JIT.validate(UserSchema).safeParse().compile();
const findActiveAdmins = JIT.query(UserListSchema)
  .filter((query) => query.and(query.eq("role", "admin"), query.eq("active", true)))
  .select("id", "name", "score")
  .compile();
const toPublicUser = JIT.mapper(UserSchema, PublicUserSchema).get("map");

export const User = JIT.compile(UserSchema, {
  is,
  parse,
  safeParse,
  equal: selected.equal,
  clone: selected.clone,
  diff: selected.diff,
  hash: selected.hash,
  stringify: selected.stringify,
  fromJSON: selected.fromJSON,
  mask: selected.mask,
  sanitize: selected.sanitize,
  codec: selected.codec,
  findActiveAdmins,
  toPublicUser,
});

export const iterateActiveUsers = JIT.query(UserListSchema)
  .filter((query) => query.eq("active", true))
  .select("id", "name")
  .take(10)
  .compileIterator();

export const visitActiveUsers = JIT.query(UserListSchema)
  .filter((query) => query.eq("active", true))
  .select("id")
  .compileVisitor();
