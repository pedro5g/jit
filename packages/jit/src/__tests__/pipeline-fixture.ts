import type { JIT } from "../index.js";

type PipelineKit = Pick<typeof JIT, "array" | "enum" | "json" | "number" | "object" | "string">;

export function createSecurityPipeline(kit: PipelineKit) {
  const User = kit.object({
    id: kit.number(),
    role: kit.enum(["admin", "member"]),
    name: kit.string(),
    email: kit.string().pii("mask"),
    note: kit.string().sanitize(),
  });

  return kit.json
    .parse(kit.array(User))
    .validate()
    .transform(User, { name: (name) => name.trim().toUpperCase() })
    .update({ name: "PUBLIC" })
    .sanitize()
    .mask()
    .filter((query) => query.eq("role", "admin"))
    .select("id", "name", "email", "note")
    .to.json();
}
