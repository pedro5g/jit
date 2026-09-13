import { JIT } from "../../../index.js";

export const UserSchema = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  email: JIT.string(),
  role: JIT.enum(["admin", "member"]),
  active: JIT.boolean(),
  score: JIT.number(),
  tags: JIT.array(JIT.string()),
  profile: JIT.object({ bio: JIT.string().nullable() }).optional(),
});

export const UserListSchema = JIT.array(UserSchema);
export const PublicUserSchema = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  email: JIT.string(),
});
export const UserEntity = JIT.ddd.entity(UserSchema, { id: "id" });
export const ChangeNameEvent = JIT.ddd.domainEvent("user.name-changed", {
  version: 1,
  payload: JIT.object({ oldName: JIT.string(), newName: JIT.string() }),
});

export type User = JIT.Typeof<typeof UserSchema>;
export type UserList = JIT.Typeof<typeof UserListSchema>;
export type PublicUser = JIT.Typeof<typeof PublicUserSchema>;
export type EntityUser = JIT.Typeof<typeof UserEntity>;
export type DomainState = JIT.DomainState<typeof UserSchema, "id">;
export type UserEvent = JIT.Typeof<typeof ChangeNameEvent>;
