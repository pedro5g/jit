# Queries, Mappers, And High-Volume Flows

JIT can compile common data-flow work over arrays: validation, filtering,
projection, grouping, uniqueness, ordering, DTO mapping, and JSON output. The
main performance idea is loop fusion: do all compatible work in one generated
pipeline instead of creating intermediate arrays at each step.

## Query API

```ts
const User = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  role: JIT.enum(["admin", "member", "blocked"] as const),
  active: JIT.boolean(),
  score: JIT.number(),
});

const Users = JIT.array(User);

const findAdmins = JIT.query(Users)
  .filter((q) => q.and(q.eq("role", "admin"), q.eq("active", true), q.gt("score", 500)))
  .select("id", "name", "score")
  .compile();
```

With parameters:

```ts
const findByRole = JIT.query(Users)
  .params({ role: JIT.string() })
  .filter((q, params) => q.eq("role", params.role))
  .compile();

findByRole(users, { role: "admin" });
```

Build-time constants can be embedded:

```ts
JIT.query(Users)
  .filter((q) => q.eq("role", JIT.const("admin")))
  .compile();
```

## Mapper API

```ts
const UserEntity = JIT.object({
  id: JIT.number(),
  firstName: JIT.string(),
  lastName: JIT.string(),
  email: JIT.string().email(),
});

const PublicUser = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
});

const toPublicUser = JIT.mapper(UserEntity, PublicUser, {
  name: (user) => `${user.firstName} ${user.lastName}`,
});

toPublicUser.map(user);
toPublicUser.many(users);
```

When mapping can be described with built-in transforms, prefer
`JIT.transform(...)` because it is easier to re-emit in AOT:

```ts
const normalizeUser = JIT.transform(UserEntity)
  .select("id", "email")
  .map("email", (field) => field.trim().lowercase())
  .compile();
```

## Aggregating With AOT

Queries and mappers can be attached as extras to a grouped object:

```ts
export const User = JIT.compile(UserSchema, {
  is: JIT.validate(UserSchema).is().compile(),
  findAdmins: JIT.query(JIT.array(UserSchema))
    .filter((q) => q.eq("role", "admin"))
    .compile(),
  toPublic: JIT.mapper(UserSchema, PublicUser),
});
```

Generated output exposes:

```ts
import { User } from "@jit/generated";

User.is(input);
User.findAdmins(users);
User.toPublic.many(users);
```

Extras with serializable bindings can be re-emitted AOT. Extras that close
over opaque callbacks are skipped with a clear reason instead of being
miscompiled.

## High-Volume Flow Pattern

A high-volume endpoint often does this:

1. validate unknown rows;
2. filter rows;
3. project fields;
4. serialize JSON.

The naive version often allocates several arrays:

```ts
const valid = input.flatMap((value) => {
  const parsed = schema.safeParse(value);
  return parsed.success ? [parsed.data] : [];
});

const output = JSON.stringify(
  valid
    .filter((user) => user.role === "admin")
    .map((user) => ({ id: user.id, name: user.name }))
);
```

The JIT version compiles each stage and keeps the hot loops direct:

```ts
const isUser = JIT.validate(User).is().compile();
const selectAdmins = JIT.query(Users)
  .filter((q) => q.eq("role", "admin"))
  .select("id", "name")
  .compile();
const stringifyPublicUsers = JIT.json(PublicUsers).stringify().compile();
```

## Why It Is Faster

Query and mapper plans are static:

- selected keys are known;
- comparison operators are known;
- grouping/unique keys are known;
- projections are known;
- mapper output shape is known.

The compiler emits one direct function instead of calling generic
`filter`, `map`, and `reduce` callbacks. This reduces callback overhead,
keeps shapes stable, and gives the engine a smaller hot loop to optimize.

## Why It Uses Less Memory

Loop fusion avoids intermediate arrays. Generated queries write into the final
output array with indexed assignment. Mappers know the target shape and create
only the output object, not a reflective field map per row.

For large data sets, fewer intermediate arrays usually matters as much as raw
CPU. Less allocation means less GC pressure and more stable latency.

## Best Practices

- Compile queries and mappers once.
- Prefer `.select(...)` over mapping whole objects and deleting fields.
- Use params for runtime values and `JIT.const(...)` for build-time constants.
- Prefer built-in transform expressions when you want AOT-safe mappers.
- Use grouped AOT exports for domain modules that naturally travel together.
- Benchmark full flows, not only single-row microbenchmarks.
