import { JIT } from "@jit/compiler/runtime";

export const UserSchema = JIT.object({
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

export const UserListSchema = JIT.array(UserSchema);

export const PublicUserSchema = JIT.object({
  id: JIT.number().int32(),
  name: JIT.string(),
  role: JIT.union(JIT.literal("admin"), JIT.literal("member")),
});

export const EventSchema = JIT.object({
  id: JIT.number().int32().positive(),
  userId: JIT.number().int32().positive(),
  kind: JIT.union(JIT.literal("login"), JIT.literal("purchase")),
  active: JIT.boolean(),
  score: JIT.number().float32(),
  region: JIT.string().min(2).max(2),
  at: JIT.iso.datetime(),
});
