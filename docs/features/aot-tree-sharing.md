# AOT Generation And Tree Sharing

AOT turns compiled JIT artifacts into standalone JavaScript files. The final
generated package contains only the functions the developer explicitly exports
or groups with `{ ... }`.

This is the main front-end story: the application bundle should not include the
schema DSL, compiler, emitters, query builders, or runtime engine. It should
include only the low-level validation/stringify/query functions it imports.

## Runtime Define File

Create `*.jit.ts` declaration files with the define entrypoint:

```ts
import { JIT } from "@jit-compiler/jit/define";

export const UserSchema = JIT.object({
  id: JIT.number().int().positive(),
  name: JIT.string().min(2),
  email: JIT.string().email(),
});

export const isUser = JIT.validate.is(UserSchema);
export const parseUser = JIT.validate.parse(UserSchema);
export const stringifyUser = JIT.json.stringify(UserSchema);
```

After `jit generate`, standalone exports stay flat:

```ts
import { isUser } from "./generated/index.js";

isUser(input);
```

If the developer wants an aggregated object, group explicit functions:

```ts
const selected = {
  is: JIT.validate.is(UserSchema),
  parse: JIT.validate.parse(UserSchema),
};

export const User = selected;
```

The generated import is then:

```ts
import { User } from "./generated/index.js";

User.is(input);
User.parse(input);
```

## What Gets Generated

Standalone exports preserve the exact export name:

```ts
export const isUser = JIT.validate.is(User);
```

emits:

```ts
export { isUser };
```

Grouped exports emit only the grouped object:

```ts
export const User = {
  is,
  parse,
};
```

emits:

```ts
export { User };
```

It does not also emit `User_is` or `User_parse` as public exports. Internal
bindings may exist inside the generated file, but bundlers can drop them when
the grouped object itself is not imported.

## Why Tree Sharing Matters

Tree sharing/tree-shaking is not a cosmetic optimization. In a browser app,
shipping a generic schema library means paying for:

- schema builders;
- parser/validator interpreters;
- error helpers;
- codecs and serializers the page may never use;
- query and mapper utilities;
- all transitive dependencies.

AOT avoids that. The generated module is plain JS, has `sideEffects: false`,
and has zero imports from `jit`. When the app imports only `isUser`, a bundler
can keep only that validator. Tests prove that unused `parse`, `stringify`,
codec, namespace objects, and the validation error class are removed from the
final bundle.

## Why It Is Faster

AOT is faster at startup because there is no runtime compilation:

- no schema walk in the browser;
- no `new Function` at app startup;
- no compiler module graph to load;
- no reflection over a schema object on every validation call.

The generated function is already the hot path:

```ts
if (typeof value.id !== "number") return false;
if (!Number.isInteger(value.id)) return false;
```

That direct shape is friendlier to V8/JSC/SpiderMonkey than a generic
interpreter that switches on schema node kinds at runtime.

## Why It Uses Less Memory

The generated package avoids memory pressure in two places:

- no engine modules are imported into the production process;
- the hot operation avoids intermediate interpreter frames and generic issue
  objects unless the chosen function needs them.

For example, `is()` does not need `JITValidationError`, so the class is not
emitted. `parse()` does need it, so AOT emits a tiny local error class only
when `parse` or `fromJSON` is selected.

Cache helpers are also conditional:

- `__hashCache` appears only for hash operations or hash-short-circuit equality;
- `__indexCache` appears only for indexed equality;
- neither helper appears in a plain `is()` build.

## Best Practices

- Export flat functions when the app imports operations independently.
- Use grouped objects when the code naturally calls `User.is`, `User.parse`,
  or `User.stringify` together.
- A schema on its own declares a type, not a runtime function. Declare the
  artifacts you want, either standalone or on an artifact object.
- Turn on `output.perFile` when different routes import unrelated schemas: each
  declaration file becomes its own module plus an `index` barrel.
- Run `pnpm clean:artifacts` after local builds if zshy leaves ignored build
  output beside source files.
