# jit

Describe a data structure once and compile specialized JavaScript operations
over it.

```ts
import { JIT } from "jit";

const User = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
  tags: JIT.array(JIT.string()),
});

const equal = JIT.equal(User.schema);
const clone = JIT.compileClone(User.schema);

equal(
  { id: 1, name: "Ada", tags: ["compiler"] },
  { id: 1, name: "Ada", tags: ["compiler"] },
); // true

clone({ id: 1, name: "Ada", tags: ["compiler"] }); // deep copy
```

JIT compiles operations from schemas instead of interpreting schemas on every
call. Current compiler entry points include equality, clone, hash, diff,
immutable update, pipeline wrappers, query, watch, and object operations such as
merge, pick, omit, transform, normalize, groupBy, sortBy, and uniqueBy.

## Schema Builders

```ts
const User = JIT.object({
  id: JIT.number(),
  name: JIT.string(),
})
  .partial()
  .required()
  .readonly();

User.schema; // stable AST shape: { type, _type, def, annotations }
```

`_type` is `null` at runtime and carries the inferred TypeScript output type at
compile time.

## Equality

Use schema-aware equality:

```ts
const equalUser = JIT.compileEqual(User.schema);

equalUser(left, right);
```

`JIT.equal(schema)` is the ergonomic alias for `JIT.compileEqual(schema)`.
